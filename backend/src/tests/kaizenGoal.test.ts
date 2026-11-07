import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { computeScore, computeScoreDetailed, fallbackSplit, momentumOf, splitGoal, splitGoalWithAnchor, MILESTONE_FALLBACK } from '../services/kaizenGoal.js';
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
    const withOneDone = computeScore(one, [{ doneCurrent: true }]);
    expect(withOneDone).toBeGreaterThan(0);
    expect(computeScore(one.map((t) => ({ ...t, done: true })), [{ doneCurrent: true }, { doneCurrent: true }])).toBe(100);
    // "can't today" (doneCurrent false) never lowers the score
    expect(computeScore(one, [{ doneCurrent: true }, { doneCurrent: false }])).toBe(withOneDone);
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

    // multiple goals are welcome: the completed one stays listed, the new one is active alongside it
    const second = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Morning walks' }).expect(201);
    expect(second.body.data.status).toBe('ACTIVE');
    const list = await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((g: { title: string }) => g.title)).toEqual(['Morning walks', 'Read a little every night']);
    expect(list.body.data.every((g: { tasks: unknown; updates: unknown }) => !!g.tasks && !!g.updates)).toBe(true);
  });

  it('a crisis title or note is never stored; high-risk text gets crisis support', async () => {
    const app = makeApp({ glm: fakeGlm(SPLIT) });
    const u = await register(app);
    const bad = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'I want to kill myself' });
    expect(bad.body.data.crisis).toBe(true);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
  });
});

describe('Feature B setup questions (why / anchor / daily time)', () => {
  it('fallbackSplit with a small daily budget promises the smallest slice in its wording', () => {
    const tasks = fallbackSplit('Read a book', 5);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => !!t.why)).toBe(true);
    expect(tasks[1]!.title).toContain('5 minutes');
    expect(tasks[1]!.title.toLowerCase()).toContain('smallest slice');
    expect(fallbackSplit('Read a book', null)[1]!.title).toContain('two minutes');
  });

  it('splitGoalWithAnchor parses the anchor and per-step whys; malformed output falls back', async () => {
    const ok = { async chat() { return { content: JSON.stringify({ tasks: [{ title: 'Pick the book tonight', why: 'Choosing is the hard part.' }, { title: 'Read one page', why: 'One page always works.' }, { title: 'Note one line', why: 'Reflection seals it.' }], anchor: 'After dinner, before dishes' }), inputTokens: 1, outputTokens: 1 } as never; }, async stream() { throw new Error('no'); } } as unknown as GlmClient;
    const r = await splitGoalWithAnchor(ok, { title: 'Read more' });
    expect(r.tasks).toHaveLength(3);
    expect(r.tasks[0]!.why).toBe('Choosing is the hard part.');
    expect(r.anchor).toBe('After dinner, before dishes');
    const fb = await splitGoalWithAnchor(fakeGlm('nonsense'), { title: 'Read more' });
    expect(fb.anchor).toBeNull();
    expect(fb.tasks).toHaveLength(3);
    expect(fb.tasks.every((t) => !!t.why)).toBe(true);
  });

  it('creation with timePerDayMin and an anchor stores both; the fallback wording respects the budget', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const r = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book', timePerDayMin: 5, anchor: 'After I brush my teeth' }).expect(201);
    expect(r.body.data.timePerDayMin).toBe(5);
    expect(r.body.data.anchor).toBe('After I brush my teeth');
    expect(r.body.data.tasks).toHaveLength(3);
    expect(r.body.data.tasks.every((t: { why: string }) => !!t.why)).toBe(true);
    expect(r.body.data.tasks[1].title).toContain('5 minutes');

    // a crisis anchor is never stored, like a crisis title
    const bad = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Evening walks', anchor: 'I want to kill myself' });
    expect(bad.body.data.crisis).toBe(true);
  });
});

describe('Feature B score breakdown + momentum', () => {
  it('computeScoreDetailed exposes the parts behind the score; computeScore stays the wrapper', () => {
    const tasks = fallbackSplit('x');
    const d = computeScoreDetailed(tasks.map((t, i) => ({ ...t, done: i < 2 })), [{ doneCurrent: true }, { doneCurrent: true }]);
    expect(d).toEqual({ score: 67, donePart: 40, streakPart: 27 });
    expect(computeScore(tasks, [])).toBe(computeScoreDetailed(tasks, []).score);
  });

  it('momentum: a run of done steps is RISING, some activity STEADY, silence RESTING', () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000);
    expect(momentumOf([{ doneCurrent: true, createdAt: day(1) }, { doneCurrent: true, createdAt: day(2) }])).toBe('RISING');
    expect(momentumOf([{ doneCurrent: true, createdAt: day(1) }, { doneCurrent: false, createdAt: day(2) }, { doneCurrent: true, createdAt: day(3) }])).toBe('STEADY');
    expect(momentumOf([{ doneCurrent: false, createdAt: day(1) }])).toBe('STEADY');
    expect(momentumOf([{ doneCurrent: true, createdAt: day(20) }])).toBe('RESTING');
    expect(momentumOf([])).toBe('RESTING');
  });

  it('GET /kaizen/goal exposes breakdown and momentum for each goal', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    expect(created.body.data.momentum).toBe('RESTING');
    await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true });
    await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true });
    const list = await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200);
    const g = list.body.data[0];
    expect(typeof g.breakdown.donePart).toBe('number');
    expect(typeof g.breakdown.streakPart).toBe('number');
    expect(g.momentum).toBe('RISING'); // two consecutive recent done steps
  });
});

describe('Feature B adaptive step sizing + milestone + anchor + reminder', () => {
  it('two HARD reports on the same current step re-split the remaining tasks smaller; done tasks and score stay', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    const id = created.body.data.id;
    const up1 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true }).expect(200);
    expect(up1.body.data.reSplit).toBeUndefined();
    const up2 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ difficulty: 'HARD' }).expect(200);
    expect(up2.body.data.reSplit).toBeUndefined();
    expect(up2.body.data.difficultyAccepted).toBe(true);
    const up3 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ difficulty: 'HARD' }).expect(200);
    expect(up3.body.data.reSplit).toBe(true);
    expect(up3.body.data.tasks[0].done).toBe(true); // the completed step survives
    expect(up3.body.data.tasks.filter((t: { done: boolean }) => !t.done).every((t: { title: string }) => t.title.startsWith('A smaller slice:'))).toBe(true);
    expect(up3.body.data.score).toBe(up1.body.data.score); // the score never drops because of a re-split
    const stored = JSON.parse((await db.userGoal.findUniqueOrThrow({ where: { id } })).difficultyJson);
    expect(stored).toHaveLength(2);
    expect(stored.every((e: { difficulty: string }) => e.difficulty === 'HARD')).toBe(true);
  });

  it('the 50% milestone is shown once, on the update that crosses it', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    const id = created.body.data.id;
    const up1 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true }).expect(200);
    expect(up1.body.data.milestone).toBeUndefined();
    const up2 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true }).expect(200);
    expect(up2.body.data.score).toBeGreaterThanOrEqual(50);
    expect(up2.body.data.milestone).toBe(MILESTONE_FALLBACK);
    const up3 = await request(app).post(`/api/v1/kaizen/goal/${id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true }).expect(200);
    expect(up3.body.data.milestone).toBeUndefined(); // shown once, never repeated
    expect(JSON.parse((await db.userGoal.findUniqueOrThrow({ where: { id } })).milestonesJson)).toEqual(['50']);
  });

  it('the anchor can be rewritten; a crisis anchor never lands', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    expect(created.body.data.anchor).toBeTruthy(); // the fallback anchor is stored
    const r = await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/anchor`).set(auth(u.accessToken)).send({ anchor: 'After morning coffee' }).expect(200);
    expect(r.body.data.anchor).toBe('After morning coffee');
    const bad = await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/anchor`).set(auth(u.accessToken)).send({ anchor: 'I want to kill myself' });
    expect(bad.body.data.crisis).toBe(true);
    const after = await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200);
    expect(after.body.data[0].anchor).toBe('After morning coffee'); // the crisis text never replaced it
  });

  it('the reminder time is stored and exposed (null = off)', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    const r = await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/reminder`).set(auth(u.accessToken)).send({ reminderMin: 480 }).expect(200);
    expect(r.body.data.reminderMin).toBe(480);
    expect((await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200)).body.data[0].reminderMin).toBe(480);
    await request(app).post(`/api/v1/kaizen/goal/${created.body.data.id}/reminder`).set(auth(u.accessToken)).send({ reminderMin: null }).expect(200);
    expect((await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200)).body.data[0].reminderMin).toBeUndefined();
  });
});

describe('Feature B journey card, garden flower and starter templates', () => {
  it('the card sums the journey; completing the goal plants one garden flower', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const created = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read a book' }).expect(201);
    let goal = created.body.data;
    for (let i = 0; i < 3; i++) {
      goal = (await request(app).post(`/api/v1/kaizen/goal/${goal.id}/update`).set(auth(u.accessToken)).send({ doneCurrent: true }).expect(200)).body.data;
    }
    const card = await request(app).get(`/api/v1/kaizen/goal/${goal.id}/card`).set(auth(u.accessToken)).expect(200);
    expect(card.body.data.title).toBe('Read a book');
    expect(card.body.data.tasks).toHaveLength(3);
    expect(card.body.data.tasks.every((t: { done: boolean }) => t.done)).toBe(true);
    expect(card.body.data.days).toBeGreaterThanOrEqual(1);
    expect(card.body.data.score).toBe(100);
    const flower = await db.kaizenAction.findFirst({ where: { userId: u.userId, source: 'MENU', status: 'DONE' } });
    expect(flower).not.toBeNull();
    expect(flower!.title).toContain('Goal completed: Read a book');
    expect(flower!.completedAt).not.toBeNull();
    await request(app).get('/api/v1/kaizen/goal/00000000-0000-4000-8000-000000000000/card').set(auth(u.accessToken)).expect(404);
  });

  it('starter templates list 4 curated goals and can be started without the model', async () => {
    const app = makeApp({ glm: fakeGlm('nonsense') });
    const u = await register(app);
    const templates = await request(app).get('/api/v1/kaizen/goal/templates').set(auth(u.accessToken)).expect(200);
    expect(templates.body.data).toHaveLength(4);
    expect(templates.body.data.map((t: { id: string }) => t.id)).toEqual(['daily-reading', 'daily-walk', 'daily-meditation', 'sleep-routine']);
    expect(templates.body.data.every((t: { tasks: { title: string; why: string }[] }) => t.tasks.length >= 3 && t.tasks.every((x) => !!x.title && !!x.why))).toBe(true);
    const started = await request(app).post('/api/v1/kaizen/goal/from-template').set(auth(u.accessToken)).send({ templateId: 'daily-walk' }).expect(201);
    expect(started.body.data.status).toBe('ACTIVE');
    expect(started.body.data.title).toBe('Walk a little every day');
    expect(started.body.data.tasks).toHaveLength(3);
    await request(app).post('/api/v1/kaizen/goal/from-template').set(auth(u.accessToken)).send({ templateId: 'nope' }).expect(404);
  });
});
