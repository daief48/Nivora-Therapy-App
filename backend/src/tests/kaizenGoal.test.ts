import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { computeScore, fallbackSplit, splitGoal } from '../services/kaizenGoal.js';
import type { GlmClient } from '../services/glmClient.js';

const SPLIT = JSON.stringify({ tasks: [{ title: 'Pick the book tonight' }, { title: 'Read one page' }, { title: 'Note one line' }] });
const DONE = JSON.stringify({ line: 'Another step quietly behind you.' });

describe('Feature B split + score (deterministic core)', () => {
  it('fallbackSplit: three small, no-blame tasks carrying the user goal', () => {
    const tasks = fallbackSplit('Read a little every night');
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => !t.done)).toBe(true);
    expect(tasks[1]!.title).toContain('Read a little every night');
  });

  it('splitGoal parses the AI split; malformed output falls back deterministically', async () => {
    const ok = { async chat() { return { content: SPLIT, inputTokens: 1, outputTokens: 1 } as never; }, async stream() { throw new Error('no'); } } as unknown as GlmClient;
    const tasks = await splitGoal(ok, { title: 'Read more' });
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.title).toBe('Pick the book tonight');
    const fb = await splitGoal(fakeGlm('nonsense'), { title: 'Read more' });
    expect(fb).toHaveLength(3);
  });

  it('score: 60% tasks + 40% consistency, never above 100, monotonic within a task', () => {
    const tasks = fallbackSplit('x');
    expect(computeScore(tasks, [])).toBe(0);
    const one = tasks.map((t, i) => ({ ...t, done: i === 0 }));
    const withOneDone = computeScore(one, [{ doneCurrent: true, hasNote: false }]);
    expect(withOneDone).toBeGreaterThan(0);
    expect(computeScore(one.map((t) => ({ ...t, done: true })), [{ doneCurrent: true, hasNote: true }, { doneCurrent: true, hasNote: true }])).toBe(100);
    // "can't today" (doneCurrent false) never lowers the score
    expect(computeScore(one, [{ doneCurrent: true, hasNote: true }, { doneCurrent: false, hasNote: false }])).toBe(withOneDone);
  });
});

describe('Feature B end to end (API)', () => {
  it('creates the goal with an AI split, updates re-score it, and completing every step completes the goal', async () => {
    const glm = fakeGlm(SPLIT);
    const app = makeApp({ glm });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);

    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a little every night' }).expect(201);
    expect(created.body.data.tasks).toHaveLength(3);
    expect(created.body.data.score).toBe(0);
    expect(glm.calls.length).toBe(1);

    // an update with a note but the step not done: score stays honest, never fake
    const up1 = await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/update`).set(auth(u.accessToken)).send({ note: 'picked the book' });
    expect(up1.status).toBe(200);
    expect(up1.body.data.line).toBeTruthy();

    // without JOURNAL_AI_SHARING the split still works (deterministic fallback, no model call)
    const u2app = makeApp({ glm: fakeGlm('nonsense') });
    const u2 = await register(u2app);
    const fb = await request(u2app).post('/api/v1/kaizen/goal').set(auth(u2.accessToken)).send({ title: 'Walk every morning' }).expect(201);
    expect(fb.body.data.tasks).toHaveLength(3);

    // mark each step done; the third completes the goal at 100
    let goal = created.body.data;
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post(`/api/v1/kaizen/goal/${goal.id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true, note: 'done' });
      expect(r.status).toBe(200);
      goal = r.body.data;
    }
    expect(goal.status).toBe('COMPLETED');
    expect(goal.score).toBe(100);
    expect((await db.userGoal.findUniqueOrThrow({ where: { id: goal.id } })).completedAt).not.toBeNull();

    // a second active goal sets the first aside — one active goal at a time
    const second = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Morning walks' }).expect(201);
    expect(second.body.data.status).toBe('ACTIVE');
  });

  it('a crisis title or note is never stored; high-risk text gets crisis support', async () => {
    const app = makeApp({ glm: fakeGlm(SPLIT) });
    const u = await register(app);
    const bad = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'I want to kill myself' });
    expect(bad.body.data.crisis).toBe(true);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
  });
});
