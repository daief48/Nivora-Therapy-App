import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runIdleSweep } from '../services/jobs.js';
import { createRelay, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';
import { computeState } from '../services/sessionEngine.js';
import { sittingRemainingSec, touchSitting } from '../services/sittingTime.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

// Active-time sittings: a sitting is finished only after its planned minutes of ACTIVE time (or on purpose); leaving just pauses it.
// The clock is faked with vi (Date only, timers stay real) and fixed in the past so access tokens never look expired. Time is never slept.
const glm = fakeGlm();
const app = makeApp({ glm });
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
const newProgram = async (u: U, over: Record<string, unknown> = {}) => {
  const r = await request(app).post('/api/v1/session-programs').set(auth(u.accessToken)).send({ title: 'Calmer evenings', goal: 'Sleep by 11', plannedDays: 5, dailyMinutes: 40, kind: 'SLEEP', ...over });
  expect(r.status).toBe(201);
  return r.body.data as { id: string };
};
const startSit = (u: U, pid: string, body: Record<string, unknown> = {}) => request(app).post(`/api/v1/session-programs/${pid}/sittings`).set(auth(u.accessToken)).send(body);
const say = (u: U, sid: string, text = 'I had a long day and feel tired') => request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text });
const leave = (u: U, sid: string, body: Record<string, unknown> = {}) => request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send(body);
const poll = (u: U, sid: string) => request(app).get(`/api/v1/sessions/${sid}/state`).set(auth(u.accessToken));
const getProg = (u: U, pid: string) => request(app).get(`/api/v1/session-programs/${pid}`).set(auth(u.accessToken));
const row = (sid: string) => db.therapySession.findUniqueOrThrow({ where: { id: sid } });
/** Puts the sitting at exactly `usedSeconds` of active time, last seen at the (fake) current instant. */
const setUsed = (sid: string, usedSeconds: number) => db.therapySession.update({ where: { id: sid }, data: { usedSeconds, lastActivityAt: new Date() } });

describe('leaving a sitting only pauses it', () => {
  it('leaving at 10 of 40 minutes pauses: still ACTIVE, IN_PROGRESS, start resumes the same sitting, never ALREADY_DONE_TODAY', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-01T09:00:00Z');
    const first = await startSit(u, p.id);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ resumed: false, remainingSec: 2400, usedMinutes: 0 });
    const sid = first.body.data.sittingId as string;
    expect((await say(u, sid)).status).toBe(201);
    at('2025-03-01T09:10:00Z');
    await setUsed(sid, 10 * 60);

    const r = await leave(u, sid);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: sid, status: 'ACTIVE', paused: true, remainingSec: 1800, noteReady: false, summaryCreated: false });
    const after = await row(sid);
    expect(after.status).toBe('ACTIVE');
    expect(after.finalizedAt).toBeNull();
    expect(await db.sessionNote.findUnique({ where: { sessionId: sid } })).toBeNull();

    const v = (await getProg(u, p.id)).body.data;
    expect(v).toMatchObject({ todayState: 'IN_PROGRESS', activeSittingId: sid, remainingSec: 1800, usedMinutes: 10, completedSittings: 0 });
    expect(v.timeline[0]).toMatchObject({ status: 'TODAY', sittingId: sid, usedMinutes: 10, plannedMinutes: 40 });
    const list = (await request(app).get('/api/v1/session-programs').set(auth(u.accessToken))).body.data;
    expect(list[0]).toMatchObject({ todayState: 'IN_PROGRESS', remainingSec: 1800, usedMinutes: 10 });

    at('2025-03-01T09:30:00Z'); // back after 20 minutes away: the same sitting, with the time that is really left
    const again = await startSit(u, p.id);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ sittingId: sid, resumed: true, remainingSec: 1800, usedMinutes: 10, dayNumber: 1 });
    expect(again.body.data.endsAt).toBe('2025-03-01T10:00:00.000Z'); // now + remaining
    const viaSessions = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p.id });
    expect(viaSessions.status).toBe(200);
    expect(viaSessions.body.data).toMatchObject({ id: sid, resumed: true });
    expect(await db.therapySession.count({ where: { programId: p.id } })).toBe(1);
    const detail = await request(app).get(`/api/v1/session-programs/${p.id}/sittings/${sid}`).set(auth(u.accessToken));
    expect(detail.body.data).toMatchObject({ status: 'ACTIVE', usedMinutes: 10, plannedMinutes: 40 });
  });

  it('only used time counts: a 2 hour gap adds at most 60 seconds', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-02T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-03-02T11:00:00Z');
    const st = await poll(u, sid);
    expect(st.body.data.remainingSec).toBe(2400 - 60);
    expect((await row(sid)).usedSeconds).toBe(60);
    at('2025-03-02T11:00:10Z');
    await poll(u, sid);
    expect((await row(sid)).usedSeconds).toBe(70); // real, short intervals are counted exactly
    const t = await touchSitting(db, sid, new Date('2025-03-02T11:00:09Z')); // the clock going backwards counts nothing
    expect(t?.usedSeconds).toBe(70);
    expect((await row(sid)).usedSeconds).toBe(70);
  });

  it('every message and reply adds its time; the state poll is the heartbeat', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-03T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-03-03T09:00:20Z');
    await poll(u, sid);
    expect((await row(sid)).usedSeconds).toBe(20);
    at('2025-03-03T09:00:45Z');
    expect((await say(u, sid)).status).toBe(201);
    const r = await row(sid);
    expect(r.usedSeconds).toBe(45);
    expect(r.lastActivityAt.toISOString()).toBe('2025-03-03T09:00:45.000Z');
  });

  it('the full 40 active minutes: SITTING_TIME_UP, the sitting is finalized, then ALREADY_DONE_TODAY', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-04T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    at('2025-03-04T09:39:00Z');
    await setUsed(sid, 39 * 60);
    expect((await say(u, sid, 'Still working on it')).status).toBe(201);
    expect((await poll(u, sid)).body.data.remainingSec).toBe(60);
    await setUsed(sid, 40 * 60);
    expect((await poll(u, sid)).body.data.remainingSec).toBe(0);
    const late = await say(u, sid, 'One more thing about my week');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SITTING_TIME_UP');
    const done = await row(sid);
    expect(done.status).toBe('ENDED');
    expect(done.finalizedAt).not.toBeNull();
    const again = await startSit(u, p.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DONE_TODAY');
    expect((await getProg(u, p.id)).body.data).toMatchObject({ todayState: 'DONE_TODAY', completedSittings: 1, remainingSec: null, usedMinutes: null });
  });

  it('leaving once the full time is used ends and finalizes without force', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-05T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    await setUsed(sid, 40 * 60);
    const r = await leave(u, sid);
    expect(r.body.data).toMatchObject({ id: sid, status: 'ENDED' });
    expect(r.body.data.paused).toBeUndefined();
    expect((await row(sid)).finalizedAt).not.toBeNull();
    expect((await startSit(u, p.id)).body.error.code).toBe('ALREADY_DONE_TODAY');
  });

  it('force=true finishes early on purpose and counts as the day done', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-03-06T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    at('2025-03-06T09:05:00Z');
    await setUsed(sid, 5 * 60);
    const r = await leave(u, sid, { force: true });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: sid, status: 'ENDED' });
    expect(r.body.data.paused).toBeUndefined();
    const done = await row(sid);
    expect(done.status).toBe('ENDED');
    expect(done.finalizedAt).not.toBeNull();
    expect((await getProg(u, p.id)).body.data).toMatchObject({ todayState: 'DONE_TODAY', completedSittings: 1 });
    expect((await startSit(u, p.id)).body.error.code).toBe('ALREADY_DONE_TODAY');
  });

  it('a person in distress can always stop: no pause, the sitting ends and is finalized', async () => {
    const u = await mk();
    for (const flag of ['ELEVATED', 'HIGH']) {
      const p = await newProgram(u, { title: `Distress ${flag}` });
      at('2025-03-07T09:00:00Z');
      const sid = (await startSit(u, p.id)).body.data.sittingId as string;
      await say(u, sid);
      await db.therapySession.update({ where: { id: sid }, data: { riskFlag: flag, usedSeconds: 5 * 60 } });
      const r = await leave(u, sid);
      expect(r.body.data).toMatchObject({ id: sid, status: 'ENDED' });
      expect(r.body.data.paused).toBeUndefined();
      expect((await row(sid)).status).toBe('ENDED');
      expect((await row(sid)).finalizedAt).not.toBeNull();
    }
    // a safety event alone (risk flag still NONE) also lets the person stop
    const p = await newProgram(u, { title: 'Distress event' });
    at('2025-03-08T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    await db.safetyEvent.create({ data: { userId: u.userId, sessionId: sid, severity: 'HIGH', category: 'SELF_HARM', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    expect((await leave(u, sid)).body.data).toMatchObject({ status: 'ENDED' });
  });
});

describe('unfinished sittings across days', () => {
  it('an unfinished sitting survives into the next day and resumes there, in the requested mode', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-04-01T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    await setUsed(sid, 15 * 60);
    expect((await leave(u, sid)).body.data.paused).toBe(true);

    at('2025-04-02T20:00:00Z'); // the next day
    const v = (await getProg(u, p.id)).body.data;
    expect(v).toMatchObject({ todayState: 'IN_PROGRESS', activeSittingId: sid, remainingSec: 25 * 60, usedMinutes: 15 });
    const again = await startSit(u, p.id, { mode: 'VOICE' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ sittingId: sid, resumed: true, dayNumber: 1, sessionType: 'VOICE', mode: 'VOICE', remainingSec: 25 * 60 });
    expect((await row(sid)).sessionType).toBe('VOICE');
    expect(await db.therapySession.count({ where: { programId: p.id } })).toBe(1);

    // finishing it makes day 1 done; day 2 is available the day after
    await db.therapySession.update({ where: { id: sid }, data: { usedSeconds: 40 * 60, sessionType: 'TEXT' } });
    expect((await leave(u, sid)).body.data.status).toBe('ENDED');
    expect((await startSit(u, p.id)).body.error.code).toBe('ALREADY_DONE_TODAY');
    at('2025-04-03T09:00:00Z');
    const next = await startSit(u, p.id);
    expect(next.status).toBe(201);
    expect(next.body.data).toMatchObject({ dayNumber: 2, resumed: false });
  });

  it('a sitting left more than 3 days is abandoned by the next start (kept with messages, deleted if empty)', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-04-10T09:00:00Z');
    const s1 = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, s1);
    at('2025-04-14T09:00:00Z'); // 4 days of silence
    const s2 = await startSit(u, p.id);
    expect(s2.status).toBe(201);
    expect(s2.body.data).toMatchObject({ dayNumber: 2, resumed: false });
    const old = await row(s1);
    expect(old.status).toBe('ENDED');
    expect(old.finalizedAt).not.toBeNull();

    at('2025-04-15T09:00:00Z');
    await leave(u, s2.body.data.sittingId, { force: true });
    at('2025-04-16T09:00:00Z');
    const empty = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-04-20T09:00:00Z');
    const s4 = await startSit(u, p.id);
    expect(s4.body.data.dayNumber).toBe(3);
    expect(await db.therapySession.count({ where: { id: empty } })).toBe(0);
  });

  it('the idle sweep never finalizes a paused program sitting, but gives up one older than 3 days', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-05-01T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, sid);
    const d = app.locals.deps;
    const sweepUntil = async (now: Date, done: () => Promise<boolean>) => { for (let i = 0; i < 30 && !(await done()); i++) await runIdleSweep({ db, glm: d.glm, cipher: d.cipher }, now); };
    await runIdleSweep({ db, glm: d.glm, cipher: d.cipher }, new Date('2025-05-03T08:00:00Z')); // two days idle: only paused
    expect((await row(sid)).status).toBe('ACTIVE');
    expect((await row(sid)).finalizedAt).toBeNull();
    await sweepUntil(new Date('2025-05-05T09:00:00Z'), async () => (await row(sid)).finalizedAt !== null);
    const gone = await row(sid);
    expect(gone.status).toBe('ENDED');
    expect(gone.finalizedAt).not.toBeNull();
  });
});

describe('the engine and the prompt follow used time', () => {
  const t0 = new Date('2025-06-01T09:00:00Z');
  const sitting = (o: Record<string, unknown> = {}) => ({ phase: 'CORE', lengthMin: 0, plannedMinutes: 40, startedAt: t0, isIntake: false, riskFlag: 'NONE', moodBefore: 5, programId: 'p1', dayNumber: 3, ...o });

  it('phase thresholds use used minutes, not the wall clock', () => {
    const threeHoursLater = new Date(t0.getTime() + 3 * 3600_000);
    // 10 of 40 minutes used, though 3 hours passed since startedAt: still CORE
    const early = computeState(sitting({ usedSeconds: 10 * 60 }), 10, threeHoursLater);
    expect(early.phase).toBe('CORE');
    expect(early.elapsedMin).toBe(10);
    expect(early.remainingMin).toBe(30);
    // 33 of 40 used (>= 80%), though almost no wall time passed: SUMMARY, then HOMEWORK at 92%, CLOSING at 100%
    const soon = new Date(t0.getTime() + 60_000);
    expect(computeState(sitting({ usedSeconds: 33 * 60 }), 10, soon).phase).toBe('SUMMARY');
    expect(computeState(sitting({ usedSeconds: 38 * 60, phase: 'SUMMARY' }), 12, soon).phase).toBe('HOMEWORK');
    expect(computeState(sitting({ usedSeconds: 40 * 60, phase: 'HOMEWORK' }), 14, soon).phase).toBe('CLOSING');
  });

  it('without usedSeconds (and for legacy sessions) the wall clock is used as before', () => {
    const later = new Date(t0.getTime() + 33 * 60_000);
    expect(computeState(sitting(), 10, later).phase).toBe('SUMMARY');
    const legacy = { phase: 'CORE', lengthMin: 30, startedAt: t0, isIntake: false, riskFlag: 'NONE', usedSeconds: 0 };
    expect(computeState(legacy, 10, new Date(t0.getTime() + 25 * 60_000)).phase).toBe('SUMMARY'); // no programId: usedSeconds is ignored
  });

  it('sittingRemainingSec', () => {
    expect(sittingRemainingSec({ plannedMinutes: 40, usedSeconds: 600 })).toBe(1800);
    expect(sittingRemainingSec({ plannedMinutes: 40, usedSeconds: 99_999 })).toBe(0);
    expect(sittingRemainingSec({ plannedMinutes: 0, usedSeconds: 10 })).toBeNull();
  });

  const systemPrompts = () => glm.calls.map((c) => c[0]!.content).filter((c) => c.includes('SESSION PHASE'));

  it('adds the RESUMING block after a gap of over 5 minutes, and not for a short pause', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-06-02T09:00:00Z');
    const sid = (await startSit(u, p.id)).body.data.sittingId as string;
    expect((await say(u, sid, 'Evenings are rough for me lately')).status).toBe(201);
    // message timestamps are written by the database (real clock): pin them to the fake clock
    await db.sessionMessage.updateMany({ where: { sessionId: sid }, data: { createdAt: new Date('2025-06-02T09:00:00Z') } });

    glm.calls.length = 0;
    at('2025-06-02T09:03:00Z'); // 3 minutes later: just a pause in the conversation
    expect((await say(u, sid, 'Mostly after dinner')).status).toBe(201);
    expect(systemPrompts().some((s) => s.includes('RESUMING'))).toBe(false);
    await db.sessionMessage.updateMany({ where: { sessionId: sid }, data: { createdAt: new Date('2025-06-02T09:03:00Z') } });

    glm.calls.length = 0;
    at('2025-06-02T09:20:00Z'); // stepped away for 17 minutes
    expect((await say(u, sid, 'Sorry, I am back')).status).toBe(201);
    const prompts = systemPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    const withBlock = prompts.find((s) => s.includes('RESUMING'));
    expect(withBlock).toBeDefined();
    expect(withBlock).toMatch(/welcome them back/i);
    expect(withBlock).toMatch(/never mention timers/i);
    // the first message of a sitting never gets it
    const q = await newProgram(u, { title: 'Another' });
    const sid2 = (await startSit(u, q.id)).body.data.sittingId as string;
    glm.calls.length = 0;
    await say(u, sid2, 'Hello');
    expect(systemPrompts().some((s) => s.includes('RESUMING'))).toBe(false);
  });
});

describe('presence from the relay and legacy sessions', () => {
  function relayFor(userId: string, over: Partial<RelayDeps>) {
    const dd = app.locals.deps;
    const out: ServerMsg[] = [];
    const relay = createRelay({
      send: (m) => out.push(m),
      authenticate: async (t) => (t === 'good' ? { userId } : null),
      openSession: async (uid, sid) => { const s = await dd.conversation.ownedSession(uid, sid); return { language: s.language, programId: s.programId }; },
      connectUpstream: async () => ({ send: () => {}, close: () => {} }),
      converse: async () => '', crisis: async () => '',
      ...over,
    });
    return { relay, out, hello: (sessionId: string) => relay.onClient(JSON.stringify({ type: 'hello', token: 'good', sessionId })), ping: () => relay.onClient(JSON.stringify({ type: 'ping' })) };
  }

  it('a relay ping touches the sitting, at most once per 10 seconds', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-07-01T09:00:00Z');
    const sid = (await startSit(u, p.id, { mode: 'VOICE' })).body.data.sittingId as string;
    let clock = 0;
    const touched: string[] = [];
    const t = relayFor(u.userId, { now: () => clock, touch: async (_uid, s) => { touched.push(s); await touchSitting(db, s, new Date(Date.parse('2025-07-01T09:00:00Z') + clock)); } });
    await t.hello(sid);
    expect(touched).toHaveLength(0); // the hello itself is not a heartbeat
    clock = 1_000; await t.ping();
    clock = 5_000; await t.ping();
    clock = 9_999; await t.ping();
    expect(touched).toEqual([sid]);
    clock = 11_000; await t.ping();
    clock = 12_000; await t.ping();
    expect(touched).toEqual([sid, sid]);
    await vi.waitFor(async () => expect((await row(sid)).usedSeconds).toBe(11));
    expect(t.out.filter((m) => m.type === 'pong')).toHaveLength(5);
    t.relay.close();
  });

  it('legacy standalone sessions are unchanged: no used time, no pause on leave, no time box', async () => {
    const u = await mk();
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' });
    expect(s.status).toBe(201);
    const sid = s.body.data.id as string;
    expect(s.body.data).toMatchObject({ programId: null, plannedMinutes: 0, endsAt: null, remainingSec: null, usedMinutes: null });
    at('2025-08-01T10:00:00Z');
    await db.therapySession.update({ where: { id: sid }, data: { lastActivityAt: new Date('2025-08-01T09:59:50Z') } });
    const st = await poll(u, sid);
    expect(st.body.data).toMatchObject({ endsAt: null, remainingSec: null });
    expect((await row(sid)).usedSeconds).toBe(0);
    expect((await say(u, sid)).status).toBe(201);
    expect((await row(sid)).usedSeconds).toBe(0);
    const end = await leave(u, sid);
    expect(end.body.data).toMatchObject({ id: sid, status: 'ENDED' });
    expect(end.body.data.paused).toBeUndefined();
    expect((await row(sid)).status).toBe('ENDED');
  });
});
