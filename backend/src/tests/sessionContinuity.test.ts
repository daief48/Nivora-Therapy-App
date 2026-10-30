import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { CONTEXT_CHAR_BUDGET, cut, fitSections } from '../services/sessionContext.js';
import { bumpTheme, EMPTY_NOTE, savePlan, type PlanContent } from '../services/therapyData.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const PLAN: PlanContent = { goals: [{ id: 'g1', title: 'Sleep better' }], focusAreas: ['sleep'], approach: 'ACT', pace: 'GENTLE', tone: 'WARM', language: 'en', whatHelps: 'evening walks' };
const optIn = (userId: string) => db.userProfile.update({ where: { userId }, data: { preferencesJson: { continuityOptIn: true } } });
const say = (app: any, t: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(t)).send({ text });

async function seedHistory(userId: string, n = 1) {
  for (let i = 0; i < n; i++) {
    const old = await db.therapySession.create({ data: { userId, status: 'ENDED', endedAt: new Date(), finalizedAt: new Date(), moodBefore: 4, moodAfter: 6 } });
    await db.sessionNote.create({
      data: { sessionId: old.id, userId, encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary: `Talked about the PHYSICS exam on Friday ${i}`, unresolved: ['exam worry'], homework: ['walk'] })) },
    });
  }
  await db.homework.create({ data: { userId, titleEncrypted: cipher.encrypt('Write one worry down'), status: 'ASSIGNED' } });
  await bumpTheme(db, cipher, userId, 'exam stress');
  await savePlan(db, cipher, userId, PLAN);
}

async function setup(opts: { optedIn: boolean; remember?: boolean; body?: Record<string, unknown> }) {
  const glm = fakeGlm();
  const app = makeApp({ glm });
  const u = await register(app);
  if (opts.optedIn) await optIn(u.userId);
  await seedHistory(u.userId, 2);
  const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ rememberThis: opts.remember ?? true, lengthMin: 30, moodBefore: 5, ...opts.body });
  expect(s.status).toBe(201);
  return { glm, app, u, sid: s.body.data.id as string };
}

describe('layered session prompt', () => {
  it('includes phase, plan, notes, homework, themes and the callback rule when opted in', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: true });
    expect((await say(app, u.accessToken, sid, 'Hi, I am a bit tired')).status).toBe(201);
    const sys = glm.calls[0]![0]!.content;
    expect(sys).toMatch(/AI mental wellness and sleep companion/);
    expect(sys).toMatch(/SAFETY \(overrides/);
    expect(sys).toMatch(/SESSION PHASE \(OPENING\)/);
    expect(sys).toMatch(/TREATMENT PLAN/);
    expect(sys).toMatch(/Sleep better/);
    expect(sys).toMatch(/PHYSICS exam on Friday/);
    expect(sys).toMatch(/Write one worry down/);
    expect(sys).toMatch(/exam stress/);
    expect(sys).toMatch(/USING EARLIER SESSIONS/);
    expect(sys).toMatch(/Name the user likes to be called: Test/);
  });
  it('uses no continuity data without opt-in', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: false });
    await say(app, u.accessToken, sid, 'Hello');
    const sys = glm.calls[0]![0]!.content;
    expect(sys).toMatch(/SESSION PHASE/);
    for (const x of ['TREATMENT PLAN', 'PHYSICS', 'Write one worry down', 'exam stress', 'EARLIER SESSION NOTES']) expect(sys).not.toContain(x);
  });
  it('uses no continuity data when rememberThis is false', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: true, remember: false });
    await say(app, u.accessToken, sid, 'Hello');
    const sys = glm.calls[0]![0]!.content;
    for (const x of ['TREATMENT PLAN', 'PHYSICS', 'Write one worry down', 'exam stress']) expect(sys).not.toContain(x);
  });
  it('plain sessions (no length / mood / intake) keep the legacy prompt shape', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({});
    await say(app, u.accessToken, s.body.data.id, 'Hello');
    const sys = glm.calls[0]![0]!.content;
    expect(sys).not.toMatch(/SESSION PHASE|SAFETY \(overrides/);
    expect(sys).toMatch(/Name the user likes to be called: Test/);
  });
  it('keeps the added context inside the character budget', () => {
    const big = 'x '.repeat(1500);
    const parts = fitSections([{ text: 'a'.repeat(900), max: 900 }, { text: big, max: 2400 }, { text: big, max: 2400 }, { text: big, max: 1200 }]);
    expect(parts.filter(Boolean).join('\n\n').length).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET);
    expect(parts[0]).toHaveLength(900); // highest priority survives
    expect(cut('word '.repeat(100), 50).length).toBeLessThanOrEqual(50);
  });
  it('persists phase and lastActivityAt on every message', async () => {
    const { app, u, sid } = await setup({ optedIn: true });
    const before = await db.therapySession.findUnique({ where: { id: sid } });
    for (const t of ['one', 'two', 'three']) await say(app, u.accessToken, sid, t);
    const after = await db.therapySession.findUnique({ where: { id: sid } });
    expect(after!.phase).toBe('AGENDA');
    expect(after!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before!.lastActivityAt.getTime());
  });
});

describe('safety within guided sessions', () => {
  it('crisis text never reaches the model, is not stored, and flags the session', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: true });
    const res = await say(app, u.accessToken, sid, 'I want to kill myself tonight');
    expect(res.status).toBe(201);
    expect(res.body.data.safety.crisis).toBe(true);
    expect(glm.calls).toHaveLength(0);
    const msgs = await db.sessionMessage.findMany({ where: { sessionId: sid } });
    expect(msgs.every((m) => m.role === 'assistant')).toBe(true);
    expect((await db.therapySession.findUnique({ where: { id: sid } }))!.riskFlag).toBe('HIGH');
  });
});

describe('guided session endpoints', () => {
  it('lobby reflects opt-in state, recap, homework and plan goals', async () => {
    const { app, u } = await setup({ optedIn: true });
    const r = await request(app).get('/api/v1/sessions/lobby').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ needsIntake: false, continuityOptIn: true, suggestedLengthMin: 15, guidedAck: false });
    expect(r.body.data.lastSessionRecap).toMatch(/PHYSICS/);
    expect(r.body.data.openHomework[0].title).toBe('Write one worry down');
    expect(r.body.data.planGoals[0]).toMatchObject({ id: 'g1', title: 'Sleep better' });
  });
  it('lobby shows nothing personal without opt-in', async () => {
    const { app, u } = await setup({ optedIn: false });
    const r = await request(app).get('/api/v1/sessions/lobby').set(auth(u.accessToken));
    expect(r.body.data).toMatchObject({ needsIntake: false, lastSessionRecap: null, openHomework: [], planGoals: [], continuityOptIn: false });
  });
  it('lobby asks for an intake when opted in without a plan', async () => {
    const app = makeApp();
    const u = await register(app);
    await optIn(u.userId);
    expect((await request(app).get('/api/v1/sessions/lobby').set(auth(u.accessToken))).body.data.needsIntake).toBe(true);
  });
  it('state returns the engine output and is owner-only', async () => {
    const { app, u, sid } = await setup({ optedIn: true, body: { isIntake: true } });
    const r = await request(app).get(`/api/v1/sessions/${sid}/state`).set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ phase: 'OPENING', phaseHint: 'hintOpening', isIntake: true, moodBefore: 5 });
    expect(typeof r.body.data.nextStep).toBe('string');
    const other = await register(app);
    expect((await request(app).get(`/api/v1/sessions/${sid}/state`).set(auth(other.accessToken))).status).toBe(404);
  });
  it('rejects invalid create options', async () => {
    const app = makeApp();
    const u = await register(app);
    expect((await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ lengthMin: 20 })).status).toBe(400);
    expect((await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ moodBefore: 11 })).status).toBe(400);
  });
  it('end returns noteReady and builds a plan after an intake', async () => {
    const glm = fakeGlm(JSON.stringify({ goals: [{ title: 'Calmer mornings' }], approach: 'MIXED', pace: 'GENTLE', tone: 'WARM' }));
    const app = makeApp({ glm });
    const u = await register(app);
    await optIn(u.userId);
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ isIntake: true });
    const sid = s.body.data.id as string;
    await say(app, u.accessToken, sid, 'I want calmer mornings');
    await say(app, u.accessToken, sid, 'Mostly work stress');
    const e = await request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send({});
    expect(e.status).toBe(200);
    expect(e.body.data).toMatchObject({ status: 'ENDED', summaryCreated: false });
    expect(typeof e.body.data.noteReady).toBe('boolean');
    const plan = await request(app).get('/api/v1/therapy/plan').set(auth(u.accessToken));
    expect(plan.body.data.plan?.goals[0].title).toBe('Calmer mornings');
  });
  it('legacy end body still works', async () => {
    const app = makeApp();
    const u = await register(app);
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({});
    const e = await request(app).post(`/api/v1/sessions/${s.body.data.id}/end`).set(auth(u.accessToken)).send({ summarize: false });
    expect(e.status).toBe(200);
    expect(e.body.data.status).toBe('ENDED');
  });
});

// ---- memory hygiene: nothing from earlier sessions without consent, in any language, including after language switches ----
describe('memory hygiene (prompt contents)', () => {
  const FORBIDDEN = ['PHYSICS', 'Write one worry down', 'exam stress', 'Sleep better', 'EARLIER SESSION NOTES', 'TREATMENT PLAN', 'HOMEWORK STATUS', 'RECURRING THEMES', 'USING EARLIER SESSIONS', 'SUMMARYWORD'];
  const HELLO: Record<string, string> = { en: 'Hello, how are you', bn: 'হ্যালো, কেমন আছেন', hi: 'नमस्ते, आप कैसे हैं', ne: 'नमस्ते, तपाईं कसरी हुनुहुन्छ' };

  async function seedMemoryAndSummary(userId: string) {
    await db.memory.create({ data: { userId, encryptedContent: cipher.encrypt('MARIGOLD is my cat') } });
    const old = await db.therapySession.findFirstOrThrow({ where: { userId, status: 'ENDED' } });
    await db.sessionSummary.create({ data: { sessionId: old.id, encryptedSummary: cipher.encrypt('SUMMARYWORD we talked about the exam') } });
  }
  const everything = (glm: { calls: { content: string }[][] }) => glm.calls.flat().map((m) => m.content).join('\n');

  for (const lang of ['en', 'bn', 'hi', 'ne']) {
    it(`${lang}: rememberThis=false keeps notes, plan, homework, themes, summaries and saved memories out of every prompt`, async () => {
      const { glm, app, u, sid } = await setup({ optedIn: true, remember: false, body: { language: lang } });
      await seedMemoryAndSummary(u.userId);
      expect((await say(app, u.accessToken, sid, HELLO[lang]!)).status).toBe(201);
      expect((await say(app, u.accessToken, sid, HELLO[lang]!)).status).toBe(201);
      const all = everything(glm);
      for (const x of [...FORBIDDEN, 'MARIGOLD']) expect(all, x).not.toContain(x);
    });

    it(`${lang}: continuity off (no opt-in) keeps notes, plan, homework, themes and summaries out; explicit memories stay`, async () => {
      const { glm, app, u, sid } = await setup({ optedIn: false, remember: true, body: { language: lang } });
      await seedMemoryAndSummary(u.userId);
      await say(app, u.accessToken, sid, HELLO[lang]!);
      const all = everything(glm);
      for (const x of FORBIDDEN) expect(all, x).not.toContain(x);
      expect(all).toContain('MARIGOLD');
    });
  }

  it('auto sessions stay clean across language switches', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: true, remember: false, body: { language: 'auto' } });
    await seedMemoryAndSummary(u.userId);
    for (const t of [HELLO.bn!, HELLO.hi!, HELLO.ne!, HELLO.en!, 'okay']) await say(app, u.accessToken, sid, t);
    expect(glm.calls.length).toBe(5);
    const all = everything(glm);
    for (const x of [...FORBIDDEN, 'MARIGOLD']) expect(all, x).not.toContain(x);
  });

  it('positive control: with opt-in and rememberThis the same data is used', async () => {
    const { glm, app, u, sid } = await setup({ optedIn: true, remember: true, body: { language: 'en' } });
    await seedMemoryAndSummary(u.userId);
    await say(app, u.accessToken, sid, HELLO.en!);
    const all = everything(glm);
    for (const x of ['PHYSICS', 'Write one worry down', 'exam stress', 'SUMMARYWORD', 'MARIGOLD']) expect(all, x).toContain(x);
  });

  it('withoutEarlierSessionMaterial only removes the memory / summary blocks', async () => {
    const { withoutEarlierSessionMaterial } = await import('../services/sessionContext.js');
    const w = 'WELLNESS CONTEXT (x):\nLast sleep: 7 h\nThings the user asked you to remember:\n- cat\nShort summaries of earlier conversations:\nold';
    expect(withoutEarlierSessionMaterial(w, { memories: true, summaries: true })).toBe(w);
    expect(withoutEarlierSessionMaterial(w, { memories: true, summaries: false })).toBe('WELLNESS CONTEXT (x):\nLast sleep: 7 h\nThings the user asked you to remember:\n- cat');
    expect(withoutEarlierSessionMaterial(w, { memories: false, summaries: false })).toBe('WELLNESS CONTEXT (x):\nLast sleep: 7 h');
    expect(withoutEarlierSessionMaterial('WELLNESS CONTEXT (x):\nThings the user asked you to remember:\n- cat', { memories: false, summaries: false })).toBe('');
  });
});
