import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { assessTaskCondition, shouldReconsider, taskPromptLine } from '../services/kaizenTask.js';
import { createCipher } from '../utils/crypto.js';
import { loadEnv } from '../config/env.js';

const cipher = createCipher(loadEnv().DATA_ENCRYPTION_KEYS);

const TASK_JSON = JSON.stringify({ content: 'Take two slow breaths before checking your phone.', reason: 'Stress has been high; one calm pause helps.' });

async function seedSession(userId: string, over: Record<string, unknown> = {}) {
  return db.therapySession.create({ data: { userId, sessionType: 'TEXT', language: 'en', lengthMin: 15, moodBefore: 6, ...over } });
}
const endSession = (app: any, token: string, sid: string) => request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(token)).send({ force: true });

describe('Kaizen task condition rules (deterministic)', () => {
  it('needs support at score >= 2: a soft signal alone never creates a task', () => {
    expect(assessTaskCondition({ moodBefore: 6, moodAfter: 3, highStress: false, sleepLow: false, stalled: false }).score).toBeGreaterThanOrEqual(2);
    expect(assessTaskCondition({ moodBefore: 6, moodAfter: 5, highStress: false, sleepLow: false, stalled: false }).signals.length).toBe(1);
    expect(assessTaskCondition({ moodBefore: 6, moodAfter: 5, highStress: false, sleepLow: false, stalled: false }).score).toBe(1);
    expect(assessTaskCondition({ moodBefore: 5, moodAfter: 5, highStress: false, sleepLow: false, stalled: false }).score).toBe(0);
  });

  it('a task standing still for 3+ sessions asks for reconsideration', () => {
    expect(shouldReconsider({ stillCount: 0 })).toBe(false);
    expect(shouldReconsider({ stillCount: 2 })).toBe(false);
    expect(shouldReconsider({ stillCount: 3 })).toBe(true);
  });

  it('the session prompt carries the current task as one private line', () => {
    const line = taskPromptLine(
      { contentEnc: cipher.encrypt('Take two slow breaths.'), status: 'ACTIVE', stateNoteEnc: cipher.encrypt('Still standing.') },
      (x) => cipher.decrypt(x),
    );
    expect(line).toContain('Take two slow breaths.');
    expect(line).toContain('Still standing.');
    expect(line).toContain('no deadline');
  });
});

describe('Feature A end to end (API)', () => {
  it('a struggling condition gets ONE task after the session ends; the next session with it active gives none', async () => {
    const app = makeApp({ glm: fakeGlm(TASK_JSON) });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);

    const s1 = await seedSession(u.userId, { moodAfter: 3 }); // LOW_MOOD_AFTER
    await endSession(app, u.accessToken, s1.id);
    const list = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(list.body.data.task).toBeTruthy();
    expect(list.body.data.task.content).toContain('breaths');
    expect(list.body.data.task.status).toBe('ACTIVE');

    // The next session while the task is ACTIVE gives no second task.
    const s2 = await seedSession(u.userId, { moodAfter: 3 });
    await endSession(app, u.accessToken, s2.id);
    const again = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(again.body.data.task.id).toBe(list.body.data.task.id); // same, still the one task
    const all = await db.kaizenTask.count({ where: { userId: u.userId } });
    expect(all).toBe(1);
  });

  it('every session updates the state: progressing clears standing-still, still counts up, DONE completes', async () => {
    const app = makeApp({ glm: fakeGlm('') });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    const s1 = await seedSession(u.userId, { moodAfter: 3 });
    await endSession(app, u.accessToken, s1.id); // fallback state note (glm reply not JSON -> STILL)
    let task = await db.kaizenTask.findFirstOrThrow({ where: { userId: u.userId } });
    expect(task.status).toBe('ACTIVE');
    expect(task.stillCount).toBe(0); // the first session created it; state updates start with the next one

    // The next session with a model that reads it as STILL counts one standing-still session.
    const appStill = makeApp({ glm: fakeGlm('') });
    const sStill = await seedSession(u.userId, {});
    await request(appStill).post(`/api/v1/sessions/${sStill.id}/end`).set(auth(u.accessToken)).send({ force: true }).expect(200);
    task = await db.kaizenTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.stillCount).toBe(1);

    await db.sessionSummary.create({ data: { sessionId: s1.id, encryptedSummary: cipher.encrypt('SUMMARY: they moved on the task today and felt lighter') } });
    // A fresh app whose model reads the session as PROGRESSING.
    const app2 = makeApp({ glm: fakeGlm(JSON.stringify({ state: 'PROGRESSING', note: 'They made a start — that counts.' })) });
    const s2 = await seedSession(u.userId, {});
    await request(app2).post(`/api/v1/sessions/${s2.id}/end`).set(auth(u.accessToken)).send({ force: true }).expect(200);
    task = await db.kaizenTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.stillCount).toBe(0);
    expect(task.stateNoteEnc && cipher.decrypt(task.stateNoteEnc)).toContain('start');

    const app3 = makeApp({ glm: fakeGlm(JSON.stringify({ state: 'DONE', note: 'They finished it, quietly.' })) });
    const s3 = await seedSession(u.userId, {});
    await request(app3).post(`/api/v1/sessions/${s3.id}/end`).set(auth(u.accessToken)).send({ force: true }).expect(200);
    task = await db.kaizenTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.status).toBe('DONE');
  });

  it('the user can complete the task (encrypted note) or say "can\'t today" with no penalty', async () => {
    const app = makeApp({ glm: fakeGlm(TASK_JSON) });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    const s = await seedSession(u.userId, { moodAfter: 3 });
    await endSession(app, u.accessToken, s.id);
    const task = await db.kaizenTask.findFirstOrThrow({ where: { userId: u.userId, status: 'ACTIVE' } });

    const react = await request(app).post(`/api/v1/kaizen/task/${task.id}/react`).set(auth(u.accessToken)).send({ note: 'too heavy today' });
    expect(react.status).toBe(200);
    expect(react.body.data.status).toBe('ACTIVE'); // no penalty, task stays

    const done = await request(app).post(`/api/v1/kaizen/task/${task.id}/complete`).set(auth(u.accessToken)).send({ note: 'did it before bed' });
    expect(done.body.data.status).toBe('DONE');
    expect(cipher.decrypt((await db.kaizenTask.findUniqueOrThrow({ where: { id: task.id } }))!.stateNoteEnc!)).toBe('did it before bed');
  });

  it('risk mode suppresses everything: no task is created and GET shows only support', async () => {
    const app = makeApp({ glm: fakeGlm(TASK_JSON) });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    await db.checkIn.create({ data: { userId: u.userId, kind: 'EVENING', mood: 2, stress: 9, energy: 2 } }); // LOW_CHECKIN risk signal
    const s = await seedSession(u.userId, { moodAfter: 3 });
    await endSession(app, u.accessToken, s.id).expect(200);
    expect(await db.kaizenTask.count({ where: { userId: u.userId } })).toBe(0);
    const list = await request(app).get('/api/v1/kaizen/task').set(auth(u.accessToken)).expect(200);
    expect(list.body.data.riskMode).toBe(true);
    expect(list.body.data.task).toBeNull();
  });

  it('a stable or improving condition offers nothing at all', async () => {
    const app = makeApp({ glm: fakeGlm(TASK_JSON) });
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    const s = await seedSession(u.userId, { moodBefore: 4, moodAfter: 8 }); // clearly improved
    await endSession(app, u.accessToken, s.id).expect(200);
    expect(await db.kaizenTask.count({ where: { userId: u.userId } })).toBe(0);
  });
});
