import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { finalizeSession } from '../services/sessionSummarizer.js';
import { runIdleSweep } from '../services/jobs.js';
import { bumpTheme, getActivePlan, savePlan, type PlanContent } from '../services/therapyData.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const app = makeApp();
const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const GOOD = JSON.stringify({
  summary: 'You talked about work stress and tried a breathing exercise.', progressNote: 'You feel a little calmer.', agenda: ['Work stress'],
  themes: ['Work Stress', 'sleep'], techniques: ['Slow breathing'], keyInsights: ['I can pause before replying'], unresolved: [], homework: ['Take a 5 minute walk', 'Write one worry down'],
});
const PLAN: PlanContent = { goals: [{ id: 'g1', title: 'Sleep better' }], focusAreas: ['sleep'], approach: 'CBT', pace: 'GENTLE', tone: 'WARM', language: 'en' };

async function mkSession(userId: string, data: Record<string, unknown> = {}, msgs = 4) {
  const s = await db.therapySession.create({ data: { userId, ...data } });
  for (let i = 0; i < msgs; i++) await db.sessionMessage.create({ data: { sessionId: s.id, role: i % 2 ? 'assistant' : 'user', encryptedContent: cipher.encrypt(`message ${i}`) } });
  return s;
}
const optIn = (userId: string) => db.userProfile.update({ where: { userId }, data: { preferencesJson: { continuityOptIn: true, other: 'keep' } } });

describe('plan versioning', () => {
  it('PUT creates new versions, GET returns history', async () => {
    const u = await register(app);
    expect((await request(app).get('/api/v1/therapy/plan').set(auth(u.accessToken))).body.data.plan).toBeNull();
    await request(app).put('/api/v1/therapy/plan').set(auth(u.accessToken)).send(PLAN);
    const v2 = await request(app).put('/api/v1/therapy/plan').set(auth(u.accessToken)).send({ ...PLAN, tone: 'DIRECT' });
    expect(v2.body.data.version).toBe(2);
    const g = await request(app).get('/api/v1/therapy/plan').set(auth(u.accessToken));
    expect(g.body.data.plan.tone).toBe('DIRECT');
    expect(g.body.data.history.map((h: any) => h.version)).toEqual([2, 1]);
    expect((await getActivePlan(db, cipher, u.userId))?.version).toBe(2);
    expect((await request(app).put('/api/v1/therapy/plan').set(auth(u.accessToken)).send({ ...PLAN, approach: 'X' })).status).toBe(400);
    expect(await savePlan(db, cipher, u.userId, PLAN)).toBe(3);
  });
});

describe('finalizeSession', () => {
  it('writes note, legacy summary, homework and themes (opted in), and is idempotent', async () => {
    const u = await register(app); await optIn(u.userId);
    const s = await mkSession(u.userId);
    const glm = fakeGlm(GOOD);
    await finalizeSession({ db, glm, cipher }, s.id, 'IDLE');
    await finalizeSession({ db, glm, cipher }, s.id, 'IDLE');
    expect(glm.calls).toHaveLength(1);
    const row = await db.therapySession.findUnique({ where: { id: s.id } });
    expect(row?.status).toBe('ENDED'); expect(row?.finalizedAt).not.toBeNull();
    expect(await db.sessionSummary.count({ where: { sessionId: s.id } })).toBe(1);
    expect(await db.homework.count({ where: { sessionId: s.id } })).toBe(2);
    const themes = await request(app).get('/api/v1/therapy/themes').set(auth(u.accessToken));
    expect(themes.body.data.map((t: any) => t.label).sort()).toEqual(['Work Stress', 'sleep']);
    const list = await request(app).get('/api/v1/therapy/sessions').set(auth(u.accessToken));
    expect(list.body.data[0]).toMatchObject({ sessionId: s.id, finalized: true, homeworkCount: 2 });
    expect(list.body.data[0].summary).toContain('work stress');
  });

  it('does not bump themes without opt-in but still writes the note', async () => {
    const u = await register(app);
    const s = await mkSession(u.userId);
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, s.id, 'USER_END');
    expect(await db.sessionNote.count({ where: { sessionId: s.id } })).toBe(1);
    expect(await db.themeTracker.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('falls back to a minimal note on invalid JSON', async () => {
    const u = await register(app);
    const s = await mkSession(u.userId);
    await finalizeSession({ db, glm: fakeGlm('not json at all'), cipher }, s.id, 'USER_END');
    const d = await request(app).get(`/api/v1/therapy/sessions/${s.id}`).set(auth(u.accessToken));
    expect(d.body.data.note.summary).toContain('2 messages');
    expect(d.body.data.note.themes).toEqual([]);
    expect(d.body.data.messageCount).toBe(4);
  });

  it('crisis session gets an empty note and never reaches the model', async () => {
    const u = await register(app);
    const s = await mkSession(u.userId);
    await db.safetyEvent.create({ data: { userId: u.userId, sessionId: s.id, severity: 'HIGH', actionTaken: 'CRISIS_RESPONSE' } });
    const glm = fakeGlm(GOOD);
    await finalizeSession({ db, glm, cipher }, s.id, 'USER_END');
    expect(glm.calls).toHaveLength(0);
    const row = await db.therapySession.findUnique({ where: { id: s.id } });
    expect(row?.riskFlag).toBe('HIGH');
    const d = await request(app).get(`/api/v1/therapy/sessions/${s.id}`).set(auth(u.accessToken));
    expect(d.body.data.note.summary).toBe('');
    expect(await db.homework.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it('rememberThis=false keeps nothing', async () => {
    const u = await register(app); await optIn(u.userId);
    const s = await mkSession(u.userId, { rememberThis: false });
    const glm = fakeGlm(GOOD);
    await finalizeSession({ db, glm, cipher }, s.id, 'USER_END');
    expect(glm.calls).toHaveLength(0);
    expect(await db.sessionNote.count({ where: { sessionId: s.id } })).toBe(0);
    expect(await db.sessionSummary.count({ where: { sessionId: s.id } })).toBe(0);
    expect((await db.therapySession.findUnique({ where: { id: s.id } }))?.finalizedAt).not.toBeNull();
  });

  it('idle sweep finalizes only stale sessions', async () => {
    const u = await register(app);
    const stale = await mkSession(u.userId, { lastActivityAt: new Date(Date.now() - 60 * 60_000) });
    const fresh = await mkSession(u.userId);
    await runIdleSweep({ db, glm: fakeGlm(GOOD), cipher }, new Date());
    expect((await db.therapySession.findUnique({ where: { id: stale.id } }))?.finalizedAt).not.toBeNull();
    expect((await db.therapySession.findUnique({ where: { id: fresh.id } }))?.finalizedAt).toBeNull();
  });
});

describe('homework, mood, note edit', () => {
  it('completes homework, sets mood, edits note', async () => {
    const u = await register(app);
    const s = await mkSession(u.userId);
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, s.id, 'USER_END');
    const hw = await request(app).get('/api/v1/therapy/homework?status=ASSIGNED').set(auth(u.accessToken));
    expect(hw.body.data).toHaveLength(2);
    expect(hw.body.data[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const done = await request(app).post(`/api/v1/therapy/homework/${hw.body.data[0].id}/complete`).set(auth(u.accessToken)).send({ status: 'DONE', feedback: 'helped' });
    expect(done.body.data.status).toBe('DONE');
    expect((await request(app).get('/api/v1/therapy/homework?status=DONE').set(auth(u.accessToken))).body.data[0].feedback).toBe('helped');
    const m = await request(app).post(`/api/v1/therapy/sessions/${s.id}/mood`).set(auth(u.accessToken)).send({ moodAfter: 7 });
    expect(m.body.data.moodAfter).toBe(7);
    expect((await request(app).post(`/api/v1/therapy/sessions/${s.id}/mood`).set(auth(u.accessToken)).send({ moodAfter: 11 })).status).toBe(400);
    const e = await request(app).patch(`/api/v1/therapy/sessions/${s.id}/note`).set(auth(u.accessToken)).send({ summary: 'Edited by me' });
    expect(e.body.data.note.summary).toBe('Edited by me');
  });
});

describe('schedule, preferences', () => {
  it('stores schedule and merges preferences without dropping keys', async () => {
    const u = await register(app);
    expect((await request(app).get('/api/v1/therapy/schedule').set(auth(u.accessToken))).body.data).toBeNull();
    const sc = await request(app).put('/api/v1/therapy/schedule').set(auth(u.accessToken)).send({ weekdays: [3, 1, 1], timeMin: 1230, lengthMin: 30, remindersOn: true });
    expect(sc.body.data.weekdays).toEqual([1, 3]);
    expect((await request(app).put('/api/v1/therapy/schedule').set(auth(u.accessToken)).send({ weekdays: [1], timeMin: 1230, lengthMin: 20, remindersOn: true })).status).toBe(400);
    expect((await request(app).get('/api/v1/therapy/preferences').set(auth(u.accessToken))).body.data).toEqual({ continuityOptIn: false, qualityReviewOptIn: false, guidedAck: false });
    await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: { reminders: 'x' } } });
    const p = await request(app).put('/api/v1/therapy/preferences').set(auth(u.accessToken)).send({ continuityOptIn: true });
    expect(p.body.data.continuityOptIn).toBe(true);
    const prof = await db.userProfile.findUnique({ where: { userId: u.userId } });
    expect(prof?.preferencesJson).toMatchObject({ reminders: 'x', continuityOptIn: true });
  });
});

describe('delete, export, isolation', () => {
  it('deleting a session cascades and decrements themes', async () => {
    const u = await register(app); await optIn(u.userId);
    const a = await mkSession(u.userId), b = await mkSession(u.userId);
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, a.id, 'USER_END');
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, b.id, 'USER_END');
    expect((await request(app).get('/api/v1/therapy/themes').set(auth(u.accessToken))).body.data[0].count).toBe(2);
    expect((await request(app).delete(`/api/v1/therapy/sessions/${a.id}`).set(auth(u.accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/therapy/themes').set(auth(u.accessToken))).body.data[0].count).toBe(1);
    expect(await db.sessionNote.count({ where: { sessionId: a.id } })).toBe(0);
    expect(await db.homework.count({ where: { sessionId: a.id } })).toBe(0);
    expect(await db.sessionMessage.count({ where: { sessionId: a.id } })).toBe(0);
    await request(app).delete(`/api/v1/therapy/sessions/${b.id}`).set(auth(u.accessToken));
    expect(await db.themeTracker.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('exports everything decrypted and DELETE /data wipes it but keeps sessions', async () => {
    const u = await register(app); await optIn(u.userId);
    const s = await mkSession(u.userId, { lengthMin: 30, moodBefore: 4 });
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, s.id, 'USER_END');
    await request(app).put('/api/v1/therapy/plan').set(auth(u.accessToken)).send(PLAN);
    await bumpTheme(db, cipher, u.userId, 'extra');
    const ex = await request(app).get('/api/v1/therapy/export').set(auth(u.accessToken));
    expect(ex.headers['content-disposition']).toContain('attachment');
    expect(ex.body.data.plans[0].plan.goals[0].title).toBe('Sleep better');
    expect(ex.body.data.sessions[0].note.summary).toContain('work stress');
    expect(ex.body.data.homework).toHaveLength(2);
    expect((await request(app).delete('/api/v1/therapy/data').set(auth(u.accessToken))).status).toBe(204);
    expect(await db.sessionNote.count({ where: { userId: u.userId } })).toBe(0);
    expect(await db.treatmentPlan.count({ where: { userId: u.userId } })).toBe(0);
    expect(await db.homework.count({ where: { userId: u.userId } })).toBe(0);
    expect(await db.themeTracker.count({ where: { userId: u.userId } })).toBe(0);
    const row = await db.therapySession.findUnique({ where: { id: s.id } });
    expect(row).toMatchObject({ lengthMin: 0, moodBefore: null });
    expect((await request(app).delete('/api/v1/therapy/data?includeSessions=true').set(auth(u.accessToken))).status).toBe(204);
    expect(await db.therapySession.count({ where: { userId: u.userId } })).toBe(0);
  });

  it("other users' data is 404, not 403", async () => {
    const a = await register(app), b = await register(app);
    const s = await mkSession(a.userId);
    await finalizeSession({ db, glm: fakeGlm(GOOD), cipher }, s.id, 'USER_END');
    const hw = await db.homework.findFirst({ where: { sessionId: s.id } });
    const h = auth(b.accessToken);
    expect((await request(app).get(`/api/v1/therapy/sessions/${s.id}`).set(h)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/therapy/sessions/${s.id}/note`).set(h).send({ summary: 'x' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/therapy/sessions/${s.id}/mood`).set(h).send({ moodBefore: 3 })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/therapy/sessions/${s.id}`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/v1/therapy/homework/${hw!.id}/complete`).set(h).send({ status: 'DONE' })).status).toBe(404);
    expect((await request(app).get('/api/v1/therapy/sessions').set(h)).body.data).toHaveLength(0);
  });
});
