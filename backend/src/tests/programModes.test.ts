import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createRelay, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';
import { createLogger } from '../utils/logger.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

// Sitting modes: a sitting is done in TEXT, VOICE or VIDEO (server side VIDEO = VOICE). Always inside a program sitting.
const app = makeApp();
const appWith = (over: Record<string, string>) => createApp({
  config: { ...config, ALLOW_STANDALONE_SESSIONS: '0', ...over }, db, logger: createLogger('silent'), glm: fakeGlm(),
  limits: { global: 10_000, auth: 10_000, messages: 10_000 },
});
const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
afterEach(() => { vi.useRealTimers(); });

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

type U = Awaited<ReturnType<typeof register>>;
const mk = async () => { const u = await register(app); await db.user.update({ where: { id: u.userId }, data: { timezone: 'UTC' } }); return u; };
const newProgram = async (u: U, a: any = app) => {
  const r = await request(a).post('/api/v1/session-programs').set(auth(u.accessToken)).send({ title: 'Calmer evenings', plannedDays: 3, dailyMinutes: 30, kind: 'SLEEP' });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; availableModes: string[] };
};
const start = (u: U, pid: string, body: Record<string, unknown> = {}, a: any = app) => request(a).post(`/api/v1/session-programs/${pid}/sittings`).set(auth(u.accessToken)).send(body);
const setMode = (u: U, pid: string, sid: string, mode: string, a: any = app) => request(a).post(`/api/v1/session-programs/${pid}/sittings/${sid}/mode`).set(auth(u.accessToken)).send({ mode });
const typeOf = async (sid: string) => (await db.therapySession.findUniqueOrThrow({ where: { id: sid } })).sessionType;

describe('start a sitting in a mode', () => {
  it('TEXT is the default; VOICE and VIDEO are stored as a VOICE session; the response echoes mode and sessionType', async () => {
    const u = await mk();
    const cases: [Record<string, unknown>, string, string][] = [[{}, 'TEXT', 'TEXT'], [{ mode: 'VOICE' }, 'VOICE', 'VOICE'], [{ mode: 'VIDEO' }, 'VIDEO', 'VOICE'], [{ mode: 'TEXT' }, 'TEXT', 'TEXT']];
    for (const [body, mode, sessionType] of cases) {
      const p = await newProgram(u);
      const r = await start(u, p.id, body);
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ mode, sessionType });
      expect(await typeOf(r.body.data.sittingId)).toBe(sessionType);
    }
    expect((await start(u, (await newProgram(u)).id, { mode: 'HOLOGRAM' })).status).toBe(400);
  });

  it('POST /sessions with programId and sessionType VOICE starts a voice sitting', async () => {
    const u = await mk();
    const p = await newProgram(u);
    const r = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p.id, sessionType: 'VOICE' });
    expect(r.status).toBe(201);
    expect(r.body.data.sessionType).toBe('VOICE');
  });

  it('MODE_DISABLED when the flag is off; VIDEO needs VOICE too; nothing is created', async () => {
    const u = await mk();
    const noVoice = appWith({ VOICE_ENABLED: '0', VIDEO_ENABLED: '1' });
    const noVideo = appWith({ VOICE_ENABLED: '1', VIDEO_ENABLED: '0' });
    const p = await newProgram(u);
    for (const [a, mode] of [[noVoice, 'VOICE'], [noVoice, 'VIDEO'], [noVideo, 'VIDEO']] as const) {
      const r = await start(u, p.id, { mode }, a);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('MODE_DISABLED');
    }
    expect(await db.therapySession.count({ where: { programId: p.id } })).toBe(0);
    expect((await start(u, p.id, { mode: 'VOICE' }, noVideo)).status).toBe(201); // voice still fine when only video is off
  });

  it('is owner only', async () => {
    const a = await mk(); const b = await mk();
    const p = await newProgram(a);
    expect((await start(b, p.id, { mode: 'VOICE' })).status).toBe(404);
  });
});

describe('availableModes', () => {
  it('is on every program view and follows the flags; TEXT is always there', async () => {
    const u = await mk();
    const p = await newProgram(u);
    expect(p.availableModes).toEqual(['TEXT', 'VOICE', 'VIDEO']);
    const det = await request(app).get(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken));
    expect(det.body.data.availableModes).toEqual(['TEXT', 'VOICE', 'VIDEO']);
    const cases: [Record<string, string>, string[]][] = [
      [{ VOICE_ENABLED: '0', VIDEO_ENABLED: '1' }, ['TEXT']],
      [{ VOICE_ENABLED: '0', VIDEO_ENABLED: '0' }, ['TEXT']],
      [{ VOICE_ENABLED: '1', VIDEO_ENABLED: '0' }, ['TEXT', 'VOICE']],
    ];
    for (const [flags, expected] of cases) {
      const a = appWith(flags);
      const list = await request(a).get('/api/v1/session-programs').set(auth(u.accessToken));
      expect(list.body.data.find((x: any) => x.id === p.id).availableModes).toEqual(expected);
      expect((await request(a).get(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken))).body.data.availableModes).toEqual(expected);
    }
  });
});

describe('switch mode mid-sitting', () => {
  it('switches an active sitting, rejects ended (409), others (404) and disabled modes', async () => {
    const u = await mk(); const other = await mk();
    const p = await newProgram(u);
    const sid = (await start(u, p.id)).body.data.sittingId as string;
    const v = await setMode(u, p.id, sid, 'VIDEO');
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ sittingId: sid, mode: 'VIDEO', sessionType: 'VOICE' });
    expect(await typeOf(sid)).toBe('VOICE');
    expect((await setMode(u, p.id, sid, 'TEXT')).body.data.sessionType).toBe('TEXT');
    expect(await typeOf(sid)).toBe('TEXT');

    expect((await setMode(other, p.id, sid, 'VOICE')).status).toBe(404);
    const op = await newProgram(other);
    expect((await setMode(other, op.id, sid, 'VOICE')).status).toBe(404); // a's sitting under b's program
    expect((await setMode(u, p.id, '00000000-0000-4000-8000-000000000000', 'VOICE')).status).toBe(404);
    expect((await setMode(u, p.id, sid, 'HOLOGRAM')).status).toBe(400);
    expect(await typeOf(sid)).toBe('TEXT');

    const noVoice = appWith({ VOICE_ENABLED: '0' });
    const dis = await setMode(u, p.id, sid, 'VOICE', noVoice);
    expect(dis.status).toBe(400);
    expect(dis.body.error.code).toBe('MODE_DISABLED');
    expect((await setMode(u, p.id, sid, 'TEXT', noVoice)).status).toBe(200); // text is always allowed

    await request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send({});
    expect((await setMode(u, p.id, sid, 'VOICE')).status).toBe(409);
  });

  it('the next reply uses the new style (spoken replies are short and go through the voice path)', async () => {
    const u = await mk();
    const p = await newProgram(u);
    const first = await start(u, p.id, { mode: 'VOICE' });
    const sid = first.body.data.sittingId as string;
    const row0 = await db.therapySession.findUniqueOrThrow({ where: { id: sid } });
    const glm = fakeGlm('Sounds heavy. What part of the evening feels hardest?');
    const a = createApp({ config: { ...config }, db, logger: createLogger('silent'), glm, limits: { global: 10_000, auth: 10_000, messages: 10_000 } });
    const r = await request(a).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'Evenings are rough for me lately' });
    expect(r.status).toBe(201);
    const seen = (from: number, s: string) => glm.calls.slice(from).some((c) => c.some((m) => m.content.includes(s))); // utility calls may share the fake
    expect(seen(0, 'Spoken: 1-3 short sentences')).toBe(true);
    expect(seen(0, 'Chat: 1-4 short sentences')).toBe(false);
    const n = glm.calls.length;
    const sw = await setMode(u, p.id, sid, 'TEXT');
    expect(sw.body.data.endsAt).toBe(first.body.data.endsAt); // switching never resets or extends the time box
    await request(a).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'Thinking about tomorrow makes it worse' });
    expect(seen(n, 'Chat: 1-4 short sentences')).toBe(true);
    expect(seen(n, 'Spoken: 1-3 short sentences')).toBe(false);
    const row1 = await db.therapySession.findUniqueOrThrow({ where: { id: sid } });
    expect(row1.sessionType).toBe('TEXT');
    expect(row1.startedAt.getTime()).toBe(row0.startedAt.getTime());
    expect(row1.plannedMinutes).toBe(row0.plannedMinutes);
    const st = await request(a).get(`/api/v1/sessions/${sid}/state`).set(auth(u.accessToken));
    expect(st.body.data.endsAt).toBe(first.body.data.endsAt);
  });
});

// ---- the voice relay path ----
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); };
const transcript = (t: string) => ({ type: 'conversation.item.input_audio_transcription.completed', transcript: t });

function relayFor(a: ReturnType<typeof makeApp>, userId: string, over: Partial<RelayDeps> = {}) {
  const dd = a.locals.deps;
  const out: ServerMsg[] = [];
  const relay = createRelay({
    send: (m) => out.push(m),
    authenticate: async (t) => (t === 'good' ? { userId } : null),
    openSession: async (uid, sid) => { try { const s = await dd.conversation.ownedSession(uid, sid); return s.status === 'ACTIVE' ? { language: s.language, programId: s.programId } : null; } catch { return null; } },
    connectUpstream: async () => ({ send: () => {}, close: () => {} }),
    converse: async (i) => (await dd.conversation.send({ userId: i.userId, sessionId: i.sessionId, text: i.text, signal: i.signal, onDelta: i.onDelta })).message.content,
    crisis: async (i) => (await dd.conversation.send({ userId: i.userId, sessionId: i.sessionId, text: i.text })).message.content,
    ...over,
  });
  const hello = (sessionId: string) => relay.onClient(JSON.stringify({ type: 'hello', token: 'good', sessionId }));
  return { relay, out, hello };
}

describe('voice relay: program only and time box', () => {
  it('refuses a hello for a session without a program (PROGRAM_REQUIRED) unless standalone sessions are allowed; sitting sessions work', async () => {
    const u = await mk();
    const standalone = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE' })).body.data.id as string; // test env allows standalone
    const refused = relayFor(app, u.userId, { allowStandalone: false });
    await refused.hello(standalone);
    expect(refused.out.find((m) => m.type === 'error')).toMatchObject({ code: 'PROGRAM_REQUIRED' });
    expect(refused.out.some((m) => m.type === 'ready')).toBe(false);
    expect(refused.relay.state).toBe('closed');

    const allowed = relayFor(app, u.userId, { allowStandalone: true });
    await allowed.hello(standalone);
    expect(allowed.out.some((m) => m.type === 'ready')).toBe(true);
    allowed.relay.close();

    const p = await newProgram(u);
    const sid = (await start(u, p.id, { mode: 'VOICE' })).body.data.sittingId as string;
    const ok = relayFor(app, u.userId, { allowStandalone: false });
    await ok.hello(sid);
    expect(ok.out.some((m) => m.type === 'ready')).toBe(true);
    ok.relay.close();
  });

  it('sends the SITTING_TIME_UP error frame once the sitting is out of time, says nothing more and does not crash', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-10-01T09:00:00Z');
    const sid = (await start(u, p.id, { mode: 'VOICE' })).body.data.sittingId as string;
    const t = relayFor(app, u.userId, { allowStandalone: false });
    await t.hello(sid);
    at('2025-10-01T09:30:05Z');
    t.relay.onUpstream(transcript('One more thing about my week'));
    await until(() => t.out.some((m) => m.type === 'error'));
    expect(t.out.find((m) => m.type === 'error')).toMatchObject({ type: 'error', code: 'SITTING_TIME_UP' });
    expect(t.out.some((m) => m.type === 'audio' || m.type === 'assistant_text_delta' || m.type === 'assistant_done')).toBe(false);
    expect(t.relay.state).toBe('listening');
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: sid } })).status).toBe('ENDED');
    t.relay.close();
  });

  it('does not hard-stop a person in distress after the time box', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-10-02T09:00:00Z');
    const sid = (await start(u, p.id, { mode: 'VOICE' })).body.data.sittingId as string;
    await db.therapySession.update({ where: { id: sid }, data: { riskFlag: 'ELEVATED' } });
    const t = relayFor(app, u.userId);
    await t.hello(sid);
    at('2025-10-02T11:00:00Z');
    t.relay.onUpstream(transcript('I just need to talk a little longer please'));
    await until(() => t.out.some((m) => m.type === 'error' || m.type === 'assistant_text_delta'));
    expect(t.out.some((m) => m.type === 'error')).toBe(false);
    expect(t.out.some((m) => m.type === 'assistant_text_delta')).toBe(true);
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: sid } })).status).toBe('ACTIVE');
    t.relay.close();
  });
});
