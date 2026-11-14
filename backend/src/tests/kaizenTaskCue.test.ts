import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { feltBackoff, phraseTask, shouldReconsider, taskPromptLine, TASK_SIGNAL_TASKS } from '../services/kaizenTask.js';
import { goalTasksColumns, readGoalTasks } from '../services/kaizenGoal.js';
import { createCipher } from '../utils/crypto.js';
import { loadEnv } from '../config/env.js';

const cipher = createCipher(loadEnv().DATA_ENCRYPTION_KEYS);
const app = makeApp();
const mkTask = (userId: string, over: Record<string, unknown> = {}) =>
  db.kaizenTask.create({ data: { userId, contentEnc: cipher.encrypt('Take two slow breaths.'), reasonEnc: cipher.encrypt('Stress.'), ...over } });

describe('task cue', () => {
  it('sets, shows in taskView + prompt line + export (decrypted), stored encrypted', async () => {
    const u = await register(app);
    const t = await mkTask(u.userId);
    const cue = 'দাঁত ব্রাশ করার পর';
    const res = await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(u.accessToken)).send({ cue, time: '07:30' }).expect(200);
    expect(res.body.data).toMatchObject({ cue, cueTime: '07:30' });
    const row = await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.cueEnc).not.toContain('ব্রাশ');
    expect(taskPromptLine(row, (x) => cipher.decrypt(x))).toContain(cue);
    expect(taskPromptLine(row, (x) => cipher.decrypt(x))).toContain('never as an instruction');
    const get = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(get.body.data.task.cue).toBe(cue);
    const ex = await request(app).post('/api/v1/privacy/export').set(auth(u.accessToken)).expect(200);
    expect(ex.body.data.kaizenTasks[0]).toMatchObject({ cue, cueTime: '07:30' });
    await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(u.accessToken)).send({ cue: '' }).expect(200);
    expect((await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } })).cueEnc).toBeNull();
  });

  it('validates input and ownership', async () => {
    const u = await register(app), o = await register(app);
    const t = await mkTask(u.userId);
    await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(u.accessToken)).send({ cue: 'x'.repeat(121) }).expect(400);
    await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(u.accessToken)).send({ cue: 'ok', time: '25:00' }).expect(400);
    await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(o.accessToken)).send({ cue: 'ok' }).expect(404);
  });

  it('crisis cue returns the crisis payload and stores nothing', async () => {
    const u = await register(app);
    const t = await mkTask(u.userId);
    const res = await request(app).post(`/api/v1/kaizen/task/${t.id}/cue`).set(auth(u.accessToken)).send({ cue: 'I want to end my life' }).expect(200);
    expect(res.body.data.cue).toBeUndefined();
    const row = await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.cueEnc).toBeNull();
    expect(JSON.stringify(row)).not.toContain('end my life');
  });

  it('suggestedCue: AI value used, curated en/bn fallback otherwise', async () => {
    const ai = await phraseTask(fakeGlm(JSON.stringify({ content: 'Breathe twice.', reason: 'Calm helps.', suggestedCue: 'after my morning tea' })), { signals: ['HIGH_STRESS'] });
    expect(ai.suggestedCue).toBe('after my morning tea');
    const en = await phraseTask(fakeGlm('nope'), { signals: ['SLEEP_LOW'] });
    expect(en.suggestedCue).toBe(TASK_SIGNAL_TASKS.SLEEP_LOW!.cue.en);
    const bn = await phraseTask(fakeGlm(new Error('x')), { signals: ['SLEEP_LOW'], locale: 'bn' });
    expect(bn.suggestedCue).toBe(TASK_SIGNAL_TASKS.SLEEP_LOW!.cue.bn);
    expect(bn.suggestedCue).toMatch(/[ঀ-৿]/);
    const u = await register(app);
    const t = await mkTask(u.userId, { suggestedCueEnc: cipher.encrypt('after lunch') });
    const get = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(get.body.data.task.suggestedCue).toBe('after lunch');
    expect(t.id).toBe(get.body.data.task.id);
  });
});

describe('outcome feedback and backoff', () => {
  it('complete stores felt, rejects bad values, exports it', async () => {
    const u = await register(app);
    const t = await mkTask(u.userId);
    await request(app).post(`/api/v1/kaizen/task/${t.id}/complete`).set(auth(u.accessToken)).send({ felt: 'AWFUL' }).expect(400);
    const r = await request(app).post(`/api/v1/kaizen/task/${t.id}/complete`).set(auth(u.accessToken)).send({ felt: 'BETTER' }).expect(200);
    expect(r.body.data.felt).toBe('BETTER');
    const ex = await request(app).post('/api/v1/privacy/export').set(auth(u.accessToken)).expect(200);
    expect(ex.body.data.kaizenTasks[0].felt).toBe('BETTER');
  });

  it('feltBackoff / shouldReconsider are deterministic', () => {
    expect(feltBackoff(['WORSE', 'WORSE'])).toBe(true);
    expect(feltBackoff(['WORSE', 'SAME'])).toBe(false);
    expect(feltBackoff(['WORSE', null])).toBe(false);
    expect(feltBackoff(['WORSE'])).toBe(false);
    expect(shouldReconsider({ stillCount: 0 }, ['WORSE', 'WORSE'])).toBe(true);
    expect(shouldReconsider({ stillCount: 0 })).toBe(false);
  });

  it('two WORSE in a row: GET flags backoff and the next task is the small curated one', async () => {
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    for (const [i, felt] of ['WORSE', 'WORSE'].entries()) await mkTask(u.userId, { status: 'DONE', felt, completedAt: new Date(Date.now() - (2 - i) * 60_000) });
    const get = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(get.body.data.backoff).toBe(true);
    const a2 = makeApp({ glm: fakeGlm('') });
    const s = await db.therapySession.create({ data: { userId: u.userId, sessionType: 'TEXT', language: 'en', lengthMin: 15, moodBefore: 6, moodAfter: 3 } });
    await request(a2).post(`/api/v1/sessions/${s.id}/end`).set(auth(u.accessToken)).send({ force: true });
    const next = await db.kaizenTask.findFirstOrThrow({ where: { userId: u.userId, status: 'ACTIVE' } });
    expect(cipher.decrypt(next.contentEnc)).toContain('Nothing more is needed');
  });

  it('a BETTER in between ends the backoff', async () => {
    const u = await register(app);
    await mkTask(u.userId, { status: 'DONE', felt: 'WORSE', completedAt: new Date(Date.now() - 120_000) });
    await mkTask(u.userId, { status: 'DONE', felt: 'BETTER', completedAt: new Date(Date.now() - 60_000) });
    const get = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(get.body.data.backoff).toBe(false);
  });
});

describe('encrypted goal tasks', () => {
  const tasks = [{ id: 'a', title: 'পড়া', done: false }];
  it('readGoalTasks prefers tasksEnc, falls back to legacy, survives garbage', () => {
    const dec = (x: string) => cipher.decrypt(x);
    const cols = goalTasksColumns(tasks, (x) => cipher.encrypt(x));
    expect(cols.tasksJson).toBeNull();
    expect(cols.tasksEnc).not.toContain('পড়া');
    expect(readGoalTasks(cols, dec)).toEqual(tasks);
    expect(readGoalTasks({ tasksJson: JSON.stringify(tasks) }, dec)).toEqual(tasks);
    expect(readGoalTasks({ tasksEnc: cols.tasksEnc, tasksJson: '[]' }, dec)).toEqual(tasks);
    expect(readGoalTasks({ tasksJson: 'not json' }, dec)).toEqual([]);
    expect(readGoalTasks({}, dec)).toEqual([]);
  });

  it('new goals are stored encrypted; legacy rows still render and export', async () => {
    const u = await register(app);
    const made = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read more' }).expect(201);
    const row = await db.userGoal.findUniqueOrThrow({ where: { id: made.body.data.id } });
    expect(row.tasksJson).toBeNull();
    expect(row.tasksEnc).toBeTruthy();
    expect(made.body.data.tasks.length).toBeGreaterThan(0);
    await db.userGoal.create({ data: { userId: u.userId, titleEnc: cipher.encrypt('Legacy'), tasksJson: JSON.stringify(tasks), status: 'ABANDONED' } });
    const list = await request(app).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200);
    expect(JSON.stringify(list.body.data)).toContain('পড়া');
    const ex = await request(app).post('/api/v1/privacy/export').set(auth(u.accessToken)).expect(200);
    expect(JSON.stringify(ex.body.data.userGoals)).toContain('পড়া');
    expect(ex.body.data.userGoals.every((g: any) => Array.isArray(g.tasks) && g.tasks.length)).toBe(true);
  });
});
