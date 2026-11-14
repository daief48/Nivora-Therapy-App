import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { guardInput } from '../services/crisisResponse.js';
import { recentFelt, feltBackoff, taskPromptLine } from '../services/kaizenTask.js';
import { readGoalTasks, readGoalTasksStrict, goalTasksColumns } from '../services/kaizenGoal.js';
import { addKaizenStep } from '../services/kaizenExtras.js';
import { createCipher } from '../utils/crypto.js';
import { loadEnv } from '../config/env.js';

const cipher = createCipher(loadEnv().DATA_ENCRYPTION_KEYS);
const down = makeApp({ glm: fakeGlm(new Error('classifier down')) });
const fine = makeApp({ glm: fakeGlm('{"severity":"NONE"}') });
// Spanish: outside the rule coverage, so the model classifier is consulted (and is "down" in the outage app).
const TXT = 'Quiero aprender a cocinar mejor cada semana';
const mkTask = (userId: string, over: Record<string, unknown> = {}) =>
  db.kaizenTask.create({ data: { userId, contentEnc: cipher.encrypt('Take two slow breaths.'), reasonEnc: cipher.encrypt('Stress.'), ...over } });
const post = (app: any, path: string, token: string, body: unknown) => request(app).post(`/api/v1${path}`).set(auth(token)).send(body as object);

describe('classifier outage: optional free text is not persisted', () => {
  it('task complete: completes, drops the note, flags textSkipped; works normally when the classifier is fine', async () => {
    const u = await register(down);
    const t = await mkTask(u.userId);
    const res = await post(down, `/kaizen/task/${t.id}/complete`, u.accessToken, { note: TXT, felt: 'BETTER' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'DONE', felt: 'BETTER', textSkipped: true, stateNote: null });
    expect((await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } })).stateNoteEnc).toBeNull();

    const u2 = await register(fine);
    const t2 = await mkTask(u2.userId);
    const ok = await post(fine, `/kaizen/task/${t2.id}/complete`, u2.accessToken, { note: TXT }).expect(200);
    expect(ok.body.data.stateNote).toBe(TXT);
    expect(ok.body.data.textSkipped).toBeUndefined();
  });

  it('task react: the quiet record is kept, the words are not', async () => {
    const u = await register(down);
    const t = await mkTask(u.userId);
    const res = await post(down, `/kaizen/task/${t.id}/react`, u.accessToken, { note: TXT }).expect(200);
    expect(res.body.data.textSkipped).toBe(true);
    expect(res.body.data.stateNote).not.toContain('cocinar');
    expect(JSON.stringify(await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } }))).not.toBe('');
    const u2 = await register(fine);
    const t2 = await mkTask(u2.userId);
    expect((await post(fine, `/kaizen/task/${t2.id}/react`, u2.accessToken, { note: TXT }).expect(200)).body.data.stateNote).toBe(TXT);
  });

  it('task cue: 200 saved:false, nothing stored; a cleared cue and a fine classifier still work', async () => {
    const u = await register(down);
    const t = await mkTask(u.userId);
    const res = await post(down, `/kaizen/task/${t.id}/cue`, u.accessToken, { cue: TXT, time: '07:30' }).expect(200);
    expect(res.body.data).toEqual({ saved: false, reason: 'SAFETY_CHECK_UNAVAILABLE' });
    const row = await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.cueEnc).toBeNull();
    expect(row.cueTime).toBeNull();
    const u2 = await register(fine);
    const t2 = await mkTask(u2.userId);
    expect((await post(fine, `/kaizen/task/${t2.id}/cue`, u2.accessToken, { cue: TXT }).expect(200)).body.data.cue).toBe(TXT);
  });

  it('goal anchor: saved:false and unchanged; goal create / edit: 503 SAFETY_CHECK_UNAVAILABLE and nothing stored', async () => {
    const u = await register(down);
    const g = await db.userGoal.create({ data: { userId: u.userId, titleEnc: cipher.encrypt('Read'), ...goalTasksColumns([{ id: 't1', title: 'a', done: false }], (x) => cipher.encrypt(x)), anchorEnc: cipher.encrypt('after tea'), score: 0 } });
    const a = await post(down, `/kaizen/goal/${g.id}/anchor`, u.accessToken, { anchor: TXT }).expect(200);
    expect(a.body.data).toEqual({ saved: false, reason: 'SAFETY_CHECK_UNAVAILABLE' });
    expect(cipher.decrypt((await db.userGoal.findUniqueOrThrow({ where: { id: g.id } })).anchorEnc!)).toBe('after tea');
    const before = await db.userGoal.count({ where: { userId: u.userId } });
    const c = await post(down, '/kaizen/goal', u.accessToken, { title: TXT }).expect(503);
    expect(c.body.error.code).toBe('SAFETY_CHECK_UNAVAILABLE');
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(before);
    await post(down, `/kaizen/goal/${g.id}/edit`, u.accessToken, { title: TXT }).expect(503);
    expect(cipher.decrypt((await db.userGoal.findUniqueOrThrow({ where: { id: g.id } })).titleEnc)).toBe('Read');
  });

  it('goal update: progress lands, note dropped, textSkipped', async () => {
    const u = await register(down);
    const g = await db.userGoal.create({ data: { userId: u.userId, titleEnc: cipher.encrypt('Read'), ...goalTasksColumns([{ id: 't1', title: 'a', done: false }, { id: 't2', title: 'b', done: false }], (x) => cipher.encrypt(x)), score: 0 } });
    const r = await post(down, `/kaizen/goal/${g.id}/update`, u.accessToken, { note: TXT, doneCurrent: true }).expect(200);
    expect(r.body.data.textSkipped).toBe(true);
    expect(r.body.data.tasks[0].done).toBe(true);
    const ups = await db.userGoalUpdate.findMany({ where: { goalId: g.id } });
    expect(ups).toHaveLength(1);
    expect(ups[0]!.noteEnc).toBeNull();
  });

  it('action complete: step done, note dropped, textSkipped', async () => {
    const u = await register(down);
        const { action: a } = await addKaizenStep(db, u.userId, { category: 'JOURNAL', minutes: 2, source: 'MENU', title: 'Walk' });
    const r = await post(down, `/kaizen/actions/${a.id}/complete`, u.accessToken, { level: 'FULL', note: TXT }).expect(200);
    expect(r.body.data).toMatchObject({ status: 'DONE', textSkipped: true });
    expect((await db.kaizenAction.findUniqueOrThrow({ where: { id: a.id } })).noteEncrypted).toBeNull();
  });

  it('sleep note (create and edit): entry saved, note not stored, textSkipped; fine classifier stores it', async () => {
    const u = await register(down);
    const body = { bedtime: '23:00', wakeTime: '07:00', rested: 6, note: TXT, date: '2026-02-01' };
    const r = await post(down, '/sleep', u.accessToken, body).expect(201);
    expect(r.body.data.textSkipped).toBe(true);
    expect(r.body.data.note).toBeNull();
    const e = await request(down).patch(`/api/v1/sleep/${r.body.data.id}`).set(auth(u.accessToken)).send({ note: TXT, rested: 7 }).expect(200);
    expect(e.body.data).toMatchObject({ textSkipped: true, note: null, rested: 7 });
    const u2 = await register(fine);
    const ok = await post(fine, '/sleep', u2.accessToken, body).expect(201);
    expect(ok.body.data.note).toBe(TXT);
    const crisis = await request(fine).patch(`/api/v1/sleep/${ok.body.data.id}`).set(auth(u2.accessToken)).send({ note: 'I want to kill myself' }).expect(200);
    expect(crisis.body.data.crisis).toBe(true);
    expect((await request(fine).get('/api/v1/sleep').set(auth(u2.accessToken))).body.data.entries[0].note).toBe(TXT);
  });

  it('program create / patch and standalone session goal: 503 and nothing stored; fine classifier works', async () => {
    const u = await register(down);
    const body = { title: TXT, goal: TXT, plannedDays: 7, dailyMinutes: 30 };
    const r = await post(down, '/session-programs', u.accessToken, body).expect(503);
    expect(r.body.error.code).toBe('SAFETY_CHECK_UNAVAILABLE');
    expect(await db.sessionProgram.count({ where: { userId: u.userId } })).toBe(0);
    const s = await post(down, '/sessions', u.accessToken, { language: 'en', goal: TXT }).expect(503);
    expect(s.body.error.code).toBe('SAFETY_CHECK_UNAVAILABLE');
    expect(await db.therapySession.count({ where: { userId: u.userId } })).toBe(0);

    const u2 = await register(fine);
    const p = await post(fine, '/session-programs', u2.accessToken, body).expect(201);
    await post(fine, '/sessions', u2.accessToken, { language: 'en', goal: TXT }).expect(201);
  });

  it('program patch during an outage keeps the stored title and goal', async () => {
    const u = await register(fine);
    const p = await post(fine, '/session-programs', u.accessToken, { title: 'Calm', goal: 'Sleep', plannedDays: 7, dailyMinutes: 30 }).expect(201);
    // same user, outage app (same DB, same auth secret)
    const r = await request(down).patch(`/api/v1/session-programs/${p.body.data.id}`).set(auth(u.accessToken)).send({ goal: TXT }).expect(503);
    expect(r.body.error.code).toBe('SAFETY_CHECK_UNAVAILABLE');
    const row = await db.sessionProgram.findUniqueOrThrow({ where: { id: p.body.data.id } });
    expect(cipher.decrypt(row.goalEncrypted!)).toBe('Sleep');
  });

  it('telemetry hook: the outage emits a content-free risk_classifier_unknown event for opted-in users', async () => {
    const u = await register(down);
    await db.userProfile.update({ where: { userId: u.userId }, data: { analyticsOptIn: true } });
    const t = await mkTask(u.userId);
    await post(down, `/kaizen/task/${t.id}/cue`, u.accessToken, { cue: TXT }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    const ev = await db.analyticsEvent.findMany({ where: { name: 'risk_classifier_unknown' }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.propsJson).toEqual({ scope: 'kaizen', code: 'CLASSIFIER_UNKNOWN' });
  });
});

describe('prompt injection of the user\'s own words is skipped under risk', () => {
  it('taskPromptLine omits cue and state note when risk is set, keeps the task', () => {
    const row = { contentEnc: 'Breathe', status: 'ACTIVE', stateNoteEnc: 'MYNOTE', cueEnc: 'MYCUE', cueTime: '07:00' };
    const id = (x: string) => x;
    expect(taskPromptLine(row, id)).toContain('MYNOTE');
    const r = taskPromptLine(row, id, { risk: true });
    expect(r).toContain('Breathe');
    expect(r).not.toContain('MYNOTE');
    expect(r).not.toContain('MYCUE');
  });
});

describe('shared rolling window', () => {
  it('a crisis split across two different features within the window is caught', async () => {
    const u = await register(fine);
    const glm = fakeGlm('{"severity":"NONE"}');
    expect((await guardInput(db, glm, u.userId, "I don't want to", { scope: 'sleep' })).crisis).toBeNull();
    const b = await guardInput(db, glm, u.userId, 'be alive anymore', { scope: 'kaizen' });
    expect(b.crisis?.crisis).toBe(true);
  });
  it('fragments older than the window do not combine', async () => {
    const u = await register(fine);
    const glm = fakeGlm('{"severity":"NONE"}');
    const real = Date.now;
    await guardInput(db, glm, u.userId, "I don't want to", { scope: 'sleep' });
    Date.now = () => real() + 3 * 60_000;
    try { expect((await guardInput(db, glm, u.userId, 'be alive anymore', { scope: 'kaizen' })).crisis).toBeNull(); } finally { Date.now = real; }
  });
});

describe('task complete is idempotent', () => {
  it('double complete keeps completedAt, felt set once, note can follow; DROPPED is never resurrected', async () => {
    const u = await register(fine);
    const t = await mkTask(u.userId, { stillCount: 2 });
    const a = await post(fine, `/kaizen/task/${t.id}/complete`, u.accessToken, {}).expect(200);
    const first = await db.kaizenTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(first).toMatchObject({ status: 'DONE', stillCount: 0, felt: null });
    await new Promise((r) => setTimeout(r, 15));
    const b = await post(fine, `/kaizen/task/${t.id}/complete`, u.accessToken, { felt: 'WORSE', note: TXT }).expect(200);
    expect(b.body.data.felt).toBe('WORSE');
    expect(new Date(b.body.data.completedAt).getTime()).toBe(new Date(a.body.data.completedAt).getTime());
    const c = await post(fine, `/kaizen/task/${t.id}/complete`, u.accessToken, { felt: 'BETTER' }).expect(200);
    expect(c.body.data.felt).toBe('WORSE'); // already set: ignored
    expect(c.body.data.stateNote).toBe(TXT); // an omitted note leaves the stored one alone

    const d = await mkTask(u.userId, { status: 'DROPPED' });
    const r = await post(fine, `/kaizen/task/${d.id}/complete`, u.accessToken, { felt: 'BETTER' }).expect(409);
    expect(r.body.error.code).toBe('TASK_DROPPED');
    expect(await db.kaizenTask.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'DROPPED', felt: null, completedAt: null });
  });
});

describe('goal writers refuse to overwrite unreadable tasks', () => {
  const dec = (x: string) => cipher.decrypt(x);
  it('strict read returns null on corrupted tasksEnc with no tasksJson; the lenient read still falls back to []', () => {
    expect(readGoalTasksStrict({ tasksEnc: 'garbage', tasksJson: null }, dec)).toBeNull();
    expect(readGoalTasks({ tasksEnc: 'garbage', tasksJson: null }, dec)).toEqual([]);
    expect(readGoalTasksStrict({ tasksEnc: null, tasksJson: null }, dec)).toBeNull();
    expect(readGoalTasksStrict({ tasksEnc: cipher.encrypt('[]'), tasksJson: null }, dec)).toEqual([]);
    expect(readGoalTasksStrict({ tasksEnc: 'garbage', tasksJson: '[{"id":"a","title":"t","done":false}]' }, dec)).toHaveLength(1);
  });
  it('update and edit answer 409 and leave the row untouched; GET still works', async () => {
    const u = await register(fine);
    const g = await db.userGoal.create({ data: { userId: u.userId, titleEnc: cipher.encrypt('Read'), tasksEnc: 'corrupted-not-decryptable', tasksJson: null, score: 0 } });
    const r1 = await post(fine, `/kaizen/goal/${g.id}/update`, u.accessToken, { doneCurrent: true }).expect(409);
    expect(r1.body.error.code).toBe('GOAL_TASKS_UNREADABLE');
    await post(fine, `/kaizen/goal/${g.id}/edit`, u.accessToken, { title: 'Read more' }).expect(409);
    const row = await db.userGoal.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.tasksEnc).toBe('corrupted-not-decryptable');
    expect(cipher.decrypt(row.titleEnc)).toBe('Read');
    expect(await db.userGoalUpdate.count({ where: { goalId: g.id } })).toBe(0);
    const list = await request(fine).get('/api/v1/kaizen/goal').set(auth(u.accessToken)).expect(200);
    expect(list.body.data[0].tasks).toEqual([]);
  });
});

describe('felt backoff', () => {
  const done = (userId: string, felt: string | null, daysAgo: number) =>
    mkTask(userId, { status: 'DONE', felt, completedAt: new Date(Date.now() - daysAgo * 86_400_000) });
  it('WORSE answers older than 14 days do not count; tasks without felt are skipped', async () => {
    const u = await register(fine);
    await done(u.userId, 'WORSE', 20); await done(u.userId, 'WORSE', 16);
    expect(feltBackoff(await recentFelt(db, u.userId))).toBe(false);
    const v = await register(fine);
    await done(v.userId, 'WORSE', 5); await done(v.userId, null, 3); await done(v.userId, 'WORSE', 1);
    expect(await recentFelt(db, v.userId)).toEqual(['WORSE', 'WORSE']); // the null-felt task is ignored
    expect(feltBackoff(await recentFelt(db, v.userId))).toBe(true);
    const w = await register(fine);
    await done(w.userId, 'WORSE', 13); await done(w.userId, 'WORSE', 12);
    expect(feltBackoff(await recentFelt(db, w.userId))).toBe(true);
  });
  it('during backoff the task view flags backoff but standingStill stays false', async () => {
    const u = await register(fine);
    await done(u.userId, 'WORSE', 3); await done(u.userId, 'WORSE', 2);
    await mkTask(u.userId);
    const get = await request(fine).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(get.body.data.backoff).toBe(true);
    expect(get.body.data.task.backoff).toBe(true);
    expect(get.body.data.task.standingStill).toBe(false);
  });
});
