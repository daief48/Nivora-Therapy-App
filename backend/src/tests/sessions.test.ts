import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { providerError } from '../utils/errors.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

const BN_TEXT = 'আজ আমার মন খুব খারাপ, অফিসে কাজের চাপ অনেক বেশি।';

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

async function newSession(app: any, token: string, language = 'en') {
  const s = await request(app).post('/api/v1/sessions').set(auth(token)).send({ language });
  expect(s.status).toBe(201);
  return s.body.data.id as string;
}
const say = (app: any, token: string, id: string, text: string) =>
  request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(token)).send({ text });

describe('sessions & conversation', () => {
  it('sends a message, stores it encrypted, tracks usage, and returns history', async () => {
    const glm = fakeGlm('That sounds heavy. What part of today felt hardest?');
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const res = await say(app, u.accessToken, sid, 'I had a rough day at work');
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toContain('hardest');
    // system prompt is first and the AI disclosure is in it
    expect(glm.calls[0]![0]!.role).toBe('system');
    expect(glm.calls[0]![0]!.content).toMatch(/AI mental wellness and sleep companion/);
    const raw = await db.sessionMessage.findMany({ where: { sessionId: sid } });
    expect(raw).toHaveLength(2);
    expect(raw.every((m) => !m.encryptedContent.includes('rough day') && !m.encryptedContent.includes('hardest'))).toBe(true);
    const usage = await db.usageRecord.findFirst({ where: { sessionId: sid } });
    expect(usage).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    const hist = await request(app).get(`/api/v1/sessions/${sid}`).set(auth(u.accessToken));
    expect(hist.body.data.messages.map((m: any) => m.content)[0]).toBe('I had a rough day at work');
  });

  it('handles Bangla: language directive, storage round-trip', async () => {
    const glm = fakeGlm('আমি শুনছি। কোন বিষয়টা আপনাকে সবচেয়ে বেশি কষ্ট দিচ্ছে?');
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'bn' });
    const sid = await newSession(app, u.accessToken, 'bn');
    const res = await say(app, u.accessToken, sid, BN_TEXT);
    expect(res.status).toBe(201);
    expect(glm.calls[0]![0]!.content).toMatch(/Bangla/);
    const hist = await request(app).get(`/api/v1/sessions/${sid}`).set(auth(u.accessToken));
    expect(hist.body.data.messages[0].content).toBe(BN_TEXT);
  });

  it('enforces consent: no session or message after consent is withdrawn', async () => {
    const app = makeApp();
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const consents = await request(app).get('/api/v1/consents').set(auth(u.accessToken));
    const ai = consents.body.data.find((c: any) => c.consentType === 'AI_DISCLOSURE');
    await request(app).delete(`/api/v1/consents/${ai.id}`).set(auth(u.accessToken)).expect(204);
    const msg = await say(app, u.accessToken, sid, 'hello');
    expect(msg.status).toBe(403);
    expect(msg.body.error.code).toBe('CONSENT_REQUIRED');
    expect((await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({})).status).toBe(403);
    // re-granting restores access
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'AI_DISCLOSURE' }).expect(201);
    expect((await say(app, u.accessToken, sid, 'hello')).status).toBe(201);
  });

  it("prevents access to another user's session (404 on every verb)", async () => {
    const app = makeApp();
    const a = await register(app);
    const b = await register(app);
    const sid = await newSession(app, a.accessToken);
    await say(app, a.accessToken, sid, 'private thing');
    const h = auth(b.accessToken);
    expect((await request(app).get(`/api/v1/sessions/${sid}`).set(h)).status).toBe(404);
    expect((await say(app, b.accessToken, sid, 'intrude')).status).toBe(404);
    expect((await request(app).post(`/api/v1/sessions/${sid}/end`).set(h).send({})).status).toBe(404);
    expect((await request(app).get(`/api/v1/sessions/${sid}/summary`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/sessions/${sid}`).set(h)).status).toBe(404);
    expect((await request(app).get('/api/v1/sessions').set(h)).body.data).toHaveLength(0);
    expect(await db.therapySession.count({ where: { id: sid } })).toBe(1);
  });

  it('maps provider failures to safe errors and stores nothing', async () => {
    const glm = fakeGlm(providerError());
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const res = await say(app, u.accessToken, sid, 'hi there');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(await db.sessionMessage.count({ where: { sessionId: sid } })).toBe(0); // safe to retry: no duplicate user message
  });

  it('rejects empty, oversized and malformed message input', async () => {
    const app = makeApp();
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    expect((await say(app, u.accessToken, sid, '   ')).status).toBe(400);
    expect((await say(app, u.accessToken, sid, 'x'.repeat(4001))).status).toBe(400);
    expect((await request(app).post('/api/v1/sessions/not-a-uuid/messages').set(auth(u.accessToken)).send({ text: 'a' })).status).toBe(400);
  });

  it('rate limits AI messages per user', async () => {
    const app = makeApp({ limits: { messages: 2 } });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await say(app, u.accessToken, sid, 'hello')).status);
    expect(codes).toEqual([201, 201, 429]);
  });

  it('streams via SSE and ends with a done event', async () => {
    const glm = fakeGlm('x'); glm.streamParts = ['I am ', 'here ', 'with you.'];
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).set('Accept', 'text/event-stream').send({ text: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text.match(/event: delta/g)).toHaveLength(3);
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('I am here with you.');
  });

  it('streaming errors before output are plain JSON (e.g. consent)', async () => {
    const app = makeApp();
    const a = await register(app);
    const b = await register(app);
    const sid = await newSession(app, a.accessToken);
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(b.accessToken)).set('Accept', 'text/event-stream').send({ text: 'hi' });
    expect(res.status).toBe(404);
  });

  it('ends a session, creates an AI summary on request, and deletes everything', async () => {
    const glm = fakeGlm('Short supportive reply.');
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'I felt anxious about exams');
    glm.reply = '- Exam anxiety discussed';
    const end = await request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send({ summarize: true });
    expect(end.body.data.summaryCreated).toBe(true);
    const sum = await request(app).get(`/api/v1/sessions/${sid}/summary`).set(auth(u.accessToken));
    expect(sum.body.data).toMatchObject({ summary: '- Exam anxiety discussed', generatedByAi: true });
    expect((await say(app, u.accessToken, sid, 'more')).status).toBe(409); // ended sessions cannot be resumed with messages
    await request(app).delete(`/api/v1/sessions/${sid}`).set(auth(u.accessToken)).expect(204);
    expect(await db.sessionMessage.count({ where: { sessionId: sid } })).toBe(0);
    expect(await db.sessionSummary.count({ where: { sessionId: sid } })).toBe(0);
  });

  it('only shares journal entries with the AI after explicit consent', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const j = await request(app).post('/api/v1/journal').set(auth(u.accessToken)).send({ content: 'secret journal text' });
    const denied = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'see my journal', journalEntryId: j.body.data.id });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(glm.calls)).not.toContain('secret journal text');
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
    const ok = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'see my journal', journalEntryId: j.body.data.id });
    expect(ok.status).toBe(201);
    expect(JSON.stringify(glm.calls)).toContain('secret journal text');
  });

  it('replaces unsafe model output with a safe fallback', async () => {
    const app = makeApp({ glm: fakeGlm('You should stop taking your medication right away.') });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const res = await say(app, u.accessToken, sid, 'my meds make me tired');
    expect(res.body.data.message.content).not.toMatch(/stop taking/);
    expect(res.body.data.message.content).toMatch(/AI/);
  });
});

describe('always Bangla and spoken replies', () => {
  it('Bangla sessions tell the model to ALWAYS reply in Bangla, even to English input', async () => {
    const glm = fakeGlm('আমি এখানে আছি।');
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'bn' });
    const sid = await newSession(app, u.accessToken, 'bn');
    await say(app, u.accessToken, sid, 'I had a hard day');
    expect(glm.calls[0]![0]!.content).toMatch(/ALWAYS reply in Bangla/);
  });

  it('voice-call sessions get the spoken-reply rules (no markdown, short sentences); text chats do not', async () => {
    const glm = fakeGlm('ঠিক আছে।');
    const app = makeApp({ glm });
    const u = await register(app);
    const voice = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE', language: 'bn' })).body.data.id;
    await say(app, u.accessToken, voice, 'হ্যালো');
    expect(glm.calls[0]![0]!.content).toMatch(/read aloud by a voice/);
    const text = await newSession(app, u.accessToken, 'bn');
    await say(app, u.accessToken, text, 'হ্যালো');
    expect(glm.calls[1]![0]!.content).not.toMatch(/read aloud by a voice/);
  });
});
