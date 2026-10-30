import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { listMemories, packSessionMemory } from '../services/memoryService.js';
import { SAFETY_LAYER } from '../services/systemPrompt.js';
import { bumpTheme, getActivePlan, EMPTY_NOTE } from '../services/therapyData.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const optIn = (userId: string, extra: Record<string, unknown> = {}) =>
  db.userProfile.update({ where: { userId }, data: { preferencesJson: { continuityOptIn: true, ...extra } } });
const say = (app: any, t: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(t)).send({ text });
const newSession = async (app: any, t: string, body: Record<string, unknown> = {}) => {
  const s = await request(app).post('/api/v1/sessions').set(auth(t)).send(body);
  expect(s.status).toBe(201);
  return s.body.data.id as string;
};
const end = (app: any, t: string, id: string) => request(app).post(`/api/v1/sessions/${id}/end`).set(auth(t)).send({});
const systemOf = (glm: { calls: { content: string }[][] }, n: number) => glm.calls[n]![0]!.content;

const COMBINED = JSON.stringify({
  goals: [{ title: 'Calmer evenings' }], approach: 'MIXED', pace: 'GENTLE', tone: 'WARM',
  facts: [{ kind: 'PERSON', text: 'My sister Rima lives in Dhaka.' }],
});

async function seedNote(userId: string, summary: string, ageDays: number, extra: Record<string, unknown> = {}) {
  const at = new Date(Date.now() - ageDays * 86_400_000);
  const s = await db.therapySession.create({ data: { userId, status: 'ENDED', endedAt: at, startedAt: at, finalizedAt: at } });
  await db.sessionNote.create({ data: { sessionId: s.id, userId, createdAt: at, encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary, ...extra })) } });
  return s;
}
const seedFact = (userId: string, text: string, kind = 'FACT') =>
  db.memory.create({ data: { userId, source: 'SESSION', encryptedContent: packSessionMemory(cipher, { t: text, k: kind as any }) } });

describe('register with rememberSessions', () => {
  it('stores continuityOptIn only when asked', async () => {
    const app = makeApp();
    const a = await register(app, { rememberSessions: true });
    const b = await register(app);
    const c = await register(app, { rememberSessions: false });
    const prefs = async (t: string) => (await request(app).get('/api/v1/therapy/preferences').set(auth(t))).body.data.continuityOptIn;
    expect(await prefs(a.accessToken)).toBe(true);
    expect(await prefs(b.accessToken)).toBe(false);
    expect(await prefs(c.accessToken)).toBe(false);
  });
});

describe('always-on guided structure for opted-in users', () => {
  it('a plain chat (no lobby, no length) is guided: phase, safety layer', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app, { rememberSessions: true });
    const sid = await newSession(app, u.accessToken);
    expect((await say(app, u.accessToken, sid, 'Hello there')).status).toBe(201);
    expect(systemOf(glm, 0)).toContain('SESSION PHASE');
    expect(systemOf(glm, 0)).toContain(SAFETY_LAYER);
  });

  it('users with continuity off keep the legacy plain prompt', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'Hello there');
    expect(systemOf(glm, 0)).not.toContain('SESSION PHASE');
  });

  it('ending a plain chat leaves a note, session memories and a starting plan (after 3 user messages), idempotently', async () => {
    const glm = fakeGlm(COMBINED);
    const app = makeApp({ glm });
    const u = await register(app, { rememberSessions: true });
    const sid = await newSession(app, u.accessToken);
    for (const t of ['My sister Rima lives in Dhaka', 'I study physics at university', 'Evening walks help me relax']) expect((await say(app, u.accessToken, sid, t)).status).toBe(201);
    expect((await end(app, u.accessToken, sid)).status).toBe(200);
    expect(await db.sessionNote.count({ where: { sessionId: sid } })).toBe(1);
    const plan = await getActivePlan(db, cipher, u.userId);
    expect(plan?.version).toBe(1);
    expect(plan?.plan.goals[0]!.title).toBe('Calmer evenings');
    const mem = await request(app).get('/api/v1/memories?source=SESSION').set(auth(u.accessToken));
    expect(mem.body.data).toHaveLength(1);
    expect(mem.body.data[0]).toMatchObject({ text: 'My sister Rima lives in Dhaka.', kind: 'PERSON', source: 'SESSION' });

    // a second session: same fact is not duplicated and the existing plan is kept
    const sid2 = await newSession(app, u.accessToken);
    for (const t of ['One', 'Two', 'Three']) await say(app, u.accessToken, sid2, t);
    await end(app, u.accessToken, sid2);
    expect((await getActivePlan(db, cipher, u.userId))?.version).toBe(1);
    expect(await listMemories(db, cipher, u.userId, { source: 'SESSION' })).toHaveLength(1);
  });

  it('short chats (under 3 user messages) build no plan and no memories', async () => {
    const glm = fakeGlm(COMBINED);
    const app = makeApp({ glm });
    const u = await register(app, { rememberSessions: true });
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'Hi');
    await say(app, u.accessToken, sid, 'Just checking in');
    await end(app, u.accessToken, sid);
    expect(await getActivePlan(db, cipher, u.userId)).toBeNull();
    expect(await listMemories(db, cipher, u.userId, { source: 'SESSION' })).toHaveLength(0);
  });

  it('users with continuity off get no memories or plan from plain chats', async () => {
    const glm = fakeGlm(COMBINED);
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    for (const t of ['One', 'Two', 'Three']) await say(app, u.accessToken, sid, t);
    await end(app, u.accessToken, sid);
    expect(await getActivePlan(db, cipher, u.userId)).toBeNull();
    expect(await listMemories(db, cipher, u.userId, { source: 'SESSION' })).toHaveLength(0);
  });
});

describe('relevance-based recall', () => {
  async function opted() {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app, { rememberSessions: true });
    // three recent generic notes are always present; the old ones only show up when relevant
    await seedNote(u.userId, 'Talked about the sleep routine', 1);
    await seedNote(u.userId, 'Talked about weekend plans', 2);
    await seedNote(u.userId, 'Talked about a busy week', 3);
    await seedNote(u.userId, 'We discussed the ZEBRAXQ presentation nerves', 40);
    await seedFact(u.userId, 'My cat is called MARIGOLDQ', 'PERSON');
    return { glm, app, u };
  }

  it('an old note and a session fact enter the prompt only when the user mentions them', async () => {
    const { glm, app, u } = await opted();
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'Hello, how are you');
    expect(systemOf(glm, 0)).not.toContain('ZEBRAXQ');
    expect(systemOf(glm, 0)).not.toContain('MARIGOLDQ');
    expect(systemOf(glm, 0)).toContain('Talked about the sleep routine'); // the newest note is always there
    await say(app, u.accessToken, sid, 'Do you remember the ZEBRAXQ thing?');
    expect(systemOf(glm, 1)).toContain('ZEBRAXQ');
    expect(systemOf(glm, 1)).not.toContain('MARIGOLDQ');
    expect(systemOf(glm, 1)).toMatch(/WHAT YOU REMEMBER ABOUT THEM/);
    expect(systemOf(glm, 1)).toMatch(/sparingly/);
    await say(app, u.accessToken, sid, 'My cat MARIGOLDQ was sick today');
    expect(systemOf(glm, 2)).toContain('MARIGOLDQ');
  });

  it('pins the life summary and what helps without any keyword match', async () => {
    const { glm, app, u } = await opted();
    await seedFact(u.userId, 'Their life so far: a physics student in Dhaka, LIFESUMX', 'SUMMARY');
    await seedFact(u.userId, 'Evening walks help them relax HELPSX', 'HELPS');
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'Hello');
    expect(systemOf(glm, 0)).toContain('LIFESUMX');
    expect(systemOf(glm, 0)).toContain('HELPSX');
  });

  it('keeps the whole addition within the character budget with many notes and facts', async () => {
    const { glm, app, u } = await opted();
    for (let i = 0; i < 14; i++) await seedNote(u.userId, `Note ${i} about topic${i} `.repeat(30), 5 + i);
    for (let i = 0; i < 40; i++) await seedFact(u.userId, `Fact ${i} about hobby${i} and plenty of extra words to make it long enough`);
    const sid = await newSession(app, u.accessToken);
    await say(app, u.accessToken, sid, 'topic9 hobby3 topic11 hobby30 topic12 hobby7 topic13');
    const sys = systemOf(glm, 0);
    expect(sys.length).toBeLessThan(6000 + 6000); // persona + language directive + capped context
    expect(sys.match(/hobby\d+/g)!.length).toBeLessThanOrEqual(12);
  });
});

describe('no leakage without consent (system prompt, en / bn / hi / ne)', () => {
  const HELLO: Record<string, string> = {
    en: 'Hello, tell me about MARIGOLDQ and ZEBRAXQ', bn: 'হ্যালো, MARIGOLDQ আর ZEBRAXQ নিয়ে বলো',
    hi: 'नमस्ते, MARIGOLDQ और ZEBRAXQ के बारे में बताओ', ne: 'नमस्ते, MARIGOLDQ र ZEBRAXQ बारे भन्नुहोस्',
  };
  const SECRET = ['MARIGOLDQ', 'ZEBRAXQ', 'LIFESUMX', 'HELPSX', 'WHAT YOU REMEMBER ABOUT THEM', 'EARLIER SESSION NOTES'];
  async function arrange(mode: 'off' | 'remember-false' | 'memory-off' | 'on', lang: string) {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    if (mode !== 'off') await optIn(u.userId, mode === 'memory-off' ? { memoryEnabled: false } : {});
    await seedNote(u.userId, 'We discussed the ZEBRAXQ presentation nerves', 40);
    await seedFact(u.userId, 'My cat is called MARIGOLDQ', 'PERSON');
    await seedFact(u.userId, 'Their life so far: LIFESUMX', 'SUMMARY');
    await seedFact(u.userId, 'Walks help HELPSX', 'HELPS');
    const sid = await newSession(app, u.accessToken, { language: lang, rememberThis: mode !== 'remember-false' });
    expect((await say(app, u.accessToken, sid, HELLO[lang]!)).status).toBe(201);
    return glm.calls.flat().filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  }
  for (const lang of ['en', 'bn', 'hi', 'ne']) {
    for (const mode of ['off', 'remember-false', 'memory-off'] as const) {
      it(`${lang}: ${mode} keeps notes, session memories, life summary and what-helps out of the prompt`, async () => {
        const sys = await arrange(mode, lang);
        for (const x of SECRET) expect(sys, x).not.toContain(x);
      });
    }
    it(`${lang}: positive control with continuity on`, async () => {
      const sys = await arrange('on', lang);
      for (const x of ['MARIGOLDQ', 'ZEBRAXQ', 'LIFESUMX', 'HELPSX']) expect(sys, x).toContain(x);
    });
  }
});

describe('memory endpoints', () => {
  it('lists with kind, filters by source, edits and deletes', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    const created = await request(app).post('/api/v1/memories').set(auth(t)).send({ text: 'I like tea' });
    expect(created.status).toBe(201);
    await seedFact(u.userId, 'My sister Rima lives in Dhaka', 'PERSON');

    const all = await request(app).get('/api/v1/memories').set(auth(t));
    expect(all.body.data).toHaveLength(2);
    const sess = (await request(app).get('/api/v1/memories?source=SESSION').set(auth(t))).body.data;
    expect(sess).toHaveLength(1);
    expect(sess[0]).toMatchObject({ text: 'My sister Rima lives in Dhaka', kind: 'PERSON', source: 'SESSION', updated: false });
    expect(sess[0].createdAt).toBeTruthy();
    const usr = (await request(app).get('/api/v1/memories?source=USER').set(auth(t))).body.data;
    expect(usr).toHaveLength(1);
    expect(usr[0].text).toBe('I like tea');
    expect((await request(app).get('/api/v1/memories?source=bogus').set(auth(t))).status).toBe(400);

    const patched = await request(app).patch(`/api/v1/memories/${sess[0].id}`).set(auth(t)).send({ text: 'My sister Rima lives in Sylhet' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ text: 'My sister Rima lives in Sylhet', kind: 'PERSON', updated: true });
    const again = (await request(app).get('/api/v1/memories?source=SESSION').set(auth(t))).body.data;
    expect(again[0].text).toBe('My sister Rima lives in Sylhet');
    expect((await request(app).patch(`/api/v1/memories/${created.body.data.id}`).set(auth(t)).send({ text: 'I like coffee' })).body.data.text).toBe('I like coffee');
    expect((await request(app).patch(`/api/v1/memories/${sess[0].id}`).set(auth(t)).send({ text: '' })).status).toBe(400);

    await request(app).delete(`/api/v1/memories/${sess[0].id}`).set(auth(t)).expect(204);
    await request(app).delete(`/api/v1/memories/${sess[0].id}`).set(auth(t)).expect(404);
    expect((await request(app).get('/api/v1/memories').set(auth(t))).body.data).toHaveLength(1);
  });

  it('DELETE ?source=SESSION forgets only session-derived memories; plain DELETE still clears everything', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await request(app).post('/api/v1/memories').set(auth(t)).send({ text: 'I like tea' });
    await seedFact(u.userId, 'Fact one about gardening');
    await seedFact(u.userId, 'Fact two about cycling');
    await request(app).delete('/api/v1/memories?source=SESSION').set(auth(t)).expect(204);
    const left = (await request(app).get('/api/v1/memories').set(auth(t))).body.data;
    expect(left.map((m: any) => m.text)).toEqual(['I like tea']);
    await request(app).delete('/api/v1/memories').set(auth(t)).expect(204);
    expect((await request(app).get('/api/v1/memories').set(auth(t))).body.data).toHaveLength(0);
  });

  it('session-derived memories do not use up the 50 memories the user can add', async () => {
    const app = makeApp();
    const u = await register(app);
    await db.memory.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({ userId: u.userId, source: 'SESSION', encryptedContent: packSessionMemory(cipher, { t: `Fact ${i}`, k: 'FACT' }) })),
    });
    expect((await request(app).post('/api/v1/memories').set(auth(u.accessToken)).send({ text: 'Mine' })).status).toBe(201);
  });

  it('is isolated per user (404 for others, no leakage in lists, overview or export)', async () => {
    const app = makeApp();
    const a = await register(app), b = await register(app);
    const fa = await seedFact(a.userId, 'Alice only secret AAAQ', 'PERSON');
    await seedFact(b.userId, 'Bob only secret BBBQ', 'PERSON');
    expect((await request(app).patch(`/api/v1/memories/${fa.id}`).set(auth(b.accessToken)).send({ text: 'hacked' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/memories/${fa.id}`).set(auth(b.accessToken))).status).toBe(404);
    for (const path of ['/api/v1/memories', '/api/v1/memories?source=SESSION', '/api/v1/therapy/memory-overview', '/api/v1/therapy/export']) {
      const r = await request(app).get(path).set(auth(b.accessToken));
      expect(r.status, path).toBe(200);
      expect(JSON.stringify(r.body), path).not.toContain('AAAQ');
      expect(JSON.stringify(r.body), path).toContain('BBBQ');
    }
    await request(app).delete('/api/v1/memories?source=SESSION').set(auth(b.accessToken)).expect(204);
    expect(await listMemories(db, cipher, a.userId)).toHaveLength(1); // untouched
    expect((await db.memory.findUniqueOrThrow({ where: { id: fa.id } })).encryptedContent).not.toContain('Alice');
    expect((await request(app).get('/api/v1/memories').set({})).status).toBe(401);
  });

  it('memory-overview returns pinned items, recent facts, themes and counts', async () => {
    const app = makeApp();
    const u = await register(app);
    await request(app).post('/api/v1/memories').set(auth(u.accessToken)).send({ text: 'I like tea' });
    await seedFact(u.userId, 'Their life so far: a student', 'SUMMARY');
    await seedFact(u.userId, 'Walks help them relax', 'HELPS');
    await seedFact(u.userId, 'My sister Rima lives in Dhaka', 'PERSON');
    await seedNote(u.userId, 'x', 3, { themes: ['exams'] });
    await bumpTheme(db, cipher, u.userId, 'exams');
    const r = await request(app).get('/api/v1/therapy/memory-overview').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.pinned.map((p: any) => p.kind).sort()).toEqual(['HELPS', 'SUMMARY']);
    expect(d.recent.map((p: any) => p.text).sort()).toEqual(['I like tea', 'My sister Rima lives in Dhaka']);
    expect(d.themes[0]).toMatchObject({ label: 'exams', count: 1 });
    expect(d.counts).toMatchObject({ user: 1, session: 3, notes: 1 });
  });
});
