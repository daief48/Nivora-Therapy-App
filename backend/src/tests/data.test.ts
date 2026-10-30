import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, captureLogs, db, makeApp, PASSWORD, register } from './helpers.js';

const app = makeApp();

describe('moods', () => {
  it('CRUD with encrypted notes, validation and ownership', async () => {
    const a = await register(app), b = await register(app);
    const created = await request(app).post('/api/v1/moods').set(auth(a.accessToken)).send({ moodScore: 4, stressScore: 2, note: 'felt okay after a walk' });
    expect(created.status).toBe(201);
    expect(created.body.data.source).toBe('user_reported');
    const raw = await db.moodEntry.findUnique({ where: { id: created.body.data.id } });
    expect(raw!.optionalNoteEncrypted).not.toContain('walk');
    expect((await request(app).post('/api/v1/moods').set(auth(a.accessToken)).send({ moodScore: 9 })).status).toBe(400);
    const list = await request(app).get('/api/v1/moods').set(auth(a.accessToken));
    expect(list.body.data[0].note).toBe('felt okay after a walk');
    expect((await request(app).get('/api/v1/moods').set(auth(b.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).delete(`/api/v1/moods/${created.body.data.id}`).set(auth(b.accessToken))).status).toBe(404);
    await request(app).delete(`/api/v1/moods/${created.body.data.id}`).set(auth(a.accessToken)).expect(204);
  });
});

describe('goals', () => {
  it('CRUD, check-ins, completion and ownership', async () => {
    const a = await register(app), b = await register(app);
    const g = await request(app).post('/api/v1/goals').set(auth(a.accessToken)).send({ title: 'Walk 10 minutes daily' });
    expect(g.status).toBe(201);
    const id = g.body.data.id;
    const ci = await request(app).post(`/api/v1/goals/${id}/check-ins`).set(auth(a.accessToken)).send({ progressValue: 40, note: 'two days' });
    expect(ci.status).toBe(201);
    expect((await request(app).post(`/api/v1/goals/${id}/check-ins`).set(auth(b.accessToken)).send({ progressValue: 10 })).status).toBe(404);
    expect((await request(app).patch(`/api/v1/goals/${id}`).set(auth(b.accessToken)).send({ title: 'hijack' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/goals/${id}/check-ins`).set(auth(a.accessToken)).send({ progressValue: 150 })).status).toBe(400);
    await request(app).post(`/api/v1/goals/${id}/check-ins`).set(auth(a.accessToken)).send({ progressValue: 100 }).expect(201);
    const list = await request(app).get('/api/v1/goals').set(auth(a.accessToken));
    expect(list.body.data[0].status).toBe('COMPLETED');
    expect(list.body.data[0].checkIns).toHaveLength(2);
    expect((await request(app).get('/api/v1/goals').set(auth(b.accessToken))).body.data).toHaveLength(0);
    await request(app).delete(`/api/v1/goals/${id}`).set(auth(a.accessToken)).expect(204);
  });
});

describe('journal privacy', () => {
  it('is encrypted at rest, private to the owner, searchable, editable and truly deleted', async () => {
    const a = await register(app), b = await register(app);
    const text = 'আজ আমি নিজেকে নিয়ে গর্বিত — grateful for my sister';
    const e = await request(app).post('/api/v1/journal').set(auth(a.accessToken)).send({ content: text, entryType: 'GRATITUDE' });
    expect(e.status).toBe(201);
    const id = e.body.data.id;
    const raw = await db.journalEntry.findUnique({ where: { id } });
    expect(raw!.encryptedContent).not.toContain('sister');
    expect(raw!.encryptedContent).not.toContain('গর্বিত');
    expect((await request(app).get(`/api/v1/journal/${id}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/journal/${id}`).set(auth(b.accessToken)).send({ content: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/journal/${id}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await request(app).get('/api/v1/journal').set(auth(b.accessToken))).body.data).toHaveLength(0);
    const found = await request(app).get('/api/v1/journal?search=SISTER').set(auth(a.accessToken));
    expect(found.body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/journal?search=nothing-here').set(auth(a.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/v1/journal?entryType=FREE').set(auth(a.accessToken))).body.data).toHaveLength(0);
    const edited = await request(app).patch(`/api/v1/journal/${id}`).set(auth(a.accessToken)).send({ content: 'edited' });
    expect(edited.body.data.content).toBe('edited');
    await request(app).delete(`/api/v1/journal/${id}`).set(auth(a.accessToken)).expect(204);
    expect((await request(app).get(`/api/v1/journal/${id}`).set(auth(a.accessToken))).status).toBe(404);
    expect((await db.journalEntry.findUnique({ where: { id } }))!.encryptedContent).toBe(''); // content destroyed
  });
});

describe('privacy: export and account deletion', () => {
  it('exports decrypted own data only', async () => {
    const a = await register(app), b = await register(app);
    await request(app).post('/api/v1/journal').set(auth(a.accessToken)).send({ content: 'mine-only-text' });
    await request(app).post('/api/v1/journal').set(auth(b.accessToken)).send({ content: 'other-persons-text' });
    const ex = await request(app).post('/api/v1/privacy/export').set(auth(a.accessToken));
    expect(ex.status).toBe(200);
    const s = JSON.stringify(ex.body);
    expect(s).toContain('mine-only-text');
    expect(s).not.toContain('other-persons-text');
    expect(s).not.toContain('passwordHash');
  });

  it('deletion requires the password, removes all data, and revokes access', async () => {
    const a = await register(app);
    const sid = (await request(app).post('/api/v1/sessions').set(auth(a.accessToken)).send({})).body.data.id;
    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(a.accessToken)).send({ text: 'hello' });
    await request(app).post('/api/v1/moods').set(auth(a.accessToken)).send({ moodScore: 3 });
    await request(app).post('/api/v1/journal').set(auth(a.accessToken)).send({ content: 'bye' });
    await request(app).post('/api/v1/goals').set(auth(a.accessToken)).send({ title: 'g' });
    expect((await request(app).delete('/api/v1/privacy/account').set(auth(a.accessToken)).send({ password: 'wrong-password-1' })).status).toBe(401);
    await request(app).delete('/api/v1/privacy/account').set(auth(a.accessToken)).send({ password: PASSWORD }).expect(204);
    for (const [table, where] of [
      ['user', { id: a.userId }], ['userProfile', { userId: a.userId }], ['userConsent', { userId: a.userId }], ['therapySession', { userId: a.userId }],
      ['moodEntry', { userId: a.userId }], ['journalEntry', { userId: a.userId }], ['therapyGoal', { userId: a.userId }],
      ['refreshToken', { userId: a.userId }], ['usageRecord', { userId: a.userId }],
    ] as const) {
      expect(await (db as any)[table].count({ where }), table).toBe(0);
    }
    expect(await db.sessionMessage.count({ where: { sessionId: sid } })).toBe(0);
    expect((await request(app).get('/api/v1/me').set(auth(a.accessToken))).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: a.email, password: PASSWORD })).status).toBe(401);
    expect(await db.auditLog.count({ where: { actorId: a.userId, action: 'ACCOUNT_DELETED' } })).toBe(1);
  });
});

describe('sensitive data never reaches logs', () => {
  it('does not log passwords, tokens, journal text, chat text, or query strings', async () => {
    const logs = captureLogs();
    const a = makeApp({ logStream: logs.stream });
    const u = await register(a, { password: 'UniquePassw0rd-xyz' });
    await request(a).post('/api/v1/journal').set(auth(u.accessToken)).send({ content: 'JOURNAL-SECRET-123' });
    const sid = (await request(a).post('/api/v1/sessions').set(auth(u.accessToken)).send({})).body.data.id;
    await request(a).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'CHAT-SECRET-456' });
    await request(a).get('/api/v1/journal?search=QUERY-SECRET-789').set(auth(u.accessToken));
    await request(a).post('/api/v1/auth/login').send({ email: u.email, password: 'UniquePassw0rd-xyz' });
    const text = logs.text();
    expect(text.length).toBeGreaterThan(0); // logging is actually on
    for (const secret of ['UniquePassw0rd-xyz', 'JOURNAL-SECRET-123', 'CHAT-SECRET-456', 'QUERY-SECRET-789', u.accessToken, u.refreshToken]) {
      expect(text).not.toContain(secret);
    }
  });
});
