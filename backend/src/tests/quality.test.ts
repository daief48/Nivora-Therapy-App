import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const app = makeApp();

async function optIn(userId: string, on = true) {
  const p = await db.userProfile.findUniqueOrThrow({ where: { userId } });
  await db.userProfile.update({ where: { userId }, data: { preferencesJson: { ...(p.preferencesJson as object), qualityReviewOptIn: on } } });
}
async function session(userId: string, texts: string[], extra: Record<string, unknown> = {}) {
  const s = await db.therapySession.create({ data: { userId, ...extra } });
  let i = 0;
  for (const t of texts) {
    await db.sessionMessage.create({ data: { sessionId: s.id, role: i % 2 ? 'assistant' : 'user', encryptedContent: cipher.encrypt(t), createdAt: new Date(Date.now() + i++ * 1000) } });
  }
  return s;
}
const share = (token: string, sessionId: string) => request(app).post('/api/v1/quality/samples').set(auth(token)).send({ sessionId });

describe('quality review samples', () => {
  it('requires the separate opt-in (default off)', async () => {
    const u = await register(app);
    const s = await session(u.userId, ['hello']);
    const res = await share(u.accessToken, s.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    expect(await db.qualityReviewSample.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('stores one scrubbed, encrypted sample the owner can read back', async () => {
    const u = await register(app, { displayName: 'Ayesha Rahman' });
    await optIn(u.userId);
    const s = await session(u.userId, ['Hi I am Ayesha, call me on 01712345678 or mail ayesha@example.com', 'That sounds heavy, Ayesha.']);
    const res = await share(u.accessToken, s.id);
    expect(res.status).toBe(201);
    expect(res.body.data.redactions).toBeGreaterThanOrEqual(3);

    const raw = await db.qualityReviewSample.findMany({ where: { userId: u.userId } });
    expect(raw).toHaveLength(1);
    expect(raw[0]!.encryptedContent).not.toContain('Ayesha');
    expect(raw[0]!.encryptedContent).not.toContain('01712345678');

    const list = await request(app).get('/api/v1/quality/samples').set(auth(u.accessToken));
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body.data);
    expect(text).not.toMatch(/01712345678|example\.com|Ayesha/);
    expect(list.body.data[0].messages[0].text).toContain('[number]');
    expect(text).not.toContain(s.id);
  });

  it('never samples crisis sessions or sessions marked not to be remembered', async () => {
    const u = await register(app);
    await optIn(u.userId);
    const crisis = await session(u.userId, ['I feel low']);
    await db.safetyEvent.create({ data: { userId: u.userId, sessionId: crisis.id, severity: 'HIGH', actionTaken: 'CRISIS_RESPONSE' } });
    expect((await share(u.accessToken, crisis.id)).status).toBe(400);
    const imminent = await session(u.userId, ['x']);
    await db.safetyEvent.create({ data: { userId: u.userId, sessionId: imminent.id, severity: 'IMMINENT', actionTaken: 'CRISIS_RESPONSE' } });
    expect((await share(u.accessToken, imminent.id)).status).toBe(400);
    const flagged = await session(u.userId, ['x'], { riskFlag: 'HIGH' });
    expect((await share(u.accessToken, flagged.id)).status).toBe(400);
    const forgotten = await session(u.userId, ['private'], { rememberThis: false });
    expect((await share(u.accessToken, forgotten.id)).status).toBe(400);
    expect(await db.qualityReviewSample.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('allows ELEVATED-only sessions but blocks unlogged crisis text', async () => {
    const u = await register(app);
    await optIn(u.userId);
    const ok = await session(u.userId, ['I am stressed about exams']);
    await db.safetyEvent.create({ data: { userId: u.userId, sessionId: ok.id, severity: 'ELEVATED', actionTaken: 'FOOTER' } });
    expect((await share(u.accessToken, ok.id)).status).toBe(201);
    const hidden = await session(u.userId, ['I want to kill myself tonight']);
    expect((await share(u.accessToken, hidden.id)).status).toBe(400);
  });

  it('isolates users: cannot share, list or delete another user\'s data', async () => {
    const a = await register(app); const b = await register(app);
    await optIn(a.userId); await optIn(b.userId);
    const sa = await session(a.userId, ['hello from a']);
    expect((await share(b.accessToken, sa.id)).status).toBe(404);
    const made = await share(a.accessToken, sa.id);
    expect(made.status).toBe(201);
    expect((await request(app).get('/api/v1/quality/samples').set(auth(b.accessToken))).body.data).toEqual([]);
    expect((await request(app).delete(`/api/v1/quality/samples/${made.body.data.id}`).set(auth(b.accessToken))).status).toBe(404);
    expect(await db.qualityReviewSample.count({ where: { userId: a.userId } })).toBe(1);
    expect((await request(app).delete(`/api/v1/quality/samples/${made.body.data.id}`).set(auth(a.accessToken))).status).toBe(204);
    expect(await db.qualityReviewSample.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('delete-all removes only the caller\'s samples', async () => {
    const a = await register(app); const b = await register(app);
    await optIn(a.userId); await optIn(b.userId);
    for (const u of [a, b]) { const s = await session(u.userId, ['hi']); await share(u.accessToken, s.id); }
    const res = await request(app).delete('/api/v1/quality/samples').set(auth(a.accessToken));
    expect(res.body.data.deleted).toBe(1);
    expect(await db.qualityReviewSample.count({ where: { userId: b.userId } })).toBe(1);
  });

  it('revoke deletes every sample, turns the opt-in off and keeps other preferences', async () => {
    const u = await register(app);
    const p = await db.userProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: { ...(p.preferencesJson as object), qualityReviewOptIn: true, continuityOptIn: true } } });
    for (let i = 0; i < 2; i++) { const s = await session(u.userId, ['hi']); await share(u.accessToken, s.id); }
    expect(await db.qualityReviewSample.count({ where: { userId: u.userId } })).toBe(2);
    const res = await request(app).post('/api/v1/quality/revoke').set(auth(u.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: 2, qualityReviewOptIn: false });
    expect(await db.qualityReviewSample.count({ where: { userId: u.userId } })).toBe(0);
    const after = await db.userProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(after.preferencesJson).toMatchObject({ qualityReviewOptIn: false, continuityOptIn: true });
    const s = await session(u.userId, ['hi']);
    expect((await share(u.accessToken, s.id)).status).toBe(403);
  });

  it('requires authentication and a valid session id', async () => {
    expect((await request(app).post('/api/v1/quality/samples').send({ sessionId: 'x' })).status).toBe(401);
    const u = await register(app);
    expect((await share(u.accessToken, 'not-a-uuid')).status).toBe(400);
  });
});
