import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { attachRealtime } from '../modules/realtime/ws.js';
import { createLogger } from '../utils/logger.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

// Session programs: one sitting per local calendar day, time box, completion, gates. The clock is faked with vi (Date only, timers stay real).
// Fake instants are fixed dates in the past so the access tokens (issued at the real time) never look expired.
const app = makeApp();
const offApp = () => createApp({
  config: { ...config, ALLOW_STANDALONE_SESSIONS: '0', VOICE_ENABLED: '0' }, db, logger: createLogger('silent'), glm: fakeGlm(),
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
const mk = async (tz = 'UTC') => { const u = await register(app); await db.user.update({ where: { id: u.userId }, data: { timezone: tz } }); return u; };
const newProgram = async (u: U, over: Record<string, unknown> = {}, a: any = app) => {
  const r = await request(a).post('/api/v1/session-programs').set(auth(u.accessToken)).send({ title: 'Sleeping better', goal: 'Fall asleep by 11', plannedDays: 3, dailyMinutes: 30, kind: 'SLEEP', ...over });
  expect(r.status).toBe(201);
  return r.body.data as { id: string };
};
const startSit = (u: U, pid: string, a: any = app) => request(a).post(`/api/v1/session-programs/${pid}/sittings`).set(auth(u.accessToken)).send({});
const say = (u: U, sid: string, text = 'I had a long day and feel tired') => request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text });
// force: leaving early only pauses a sitting now (see sittingActiveTime.test.ts); these tests mean 'the person finished the day'
const endSit = (u: U, sid: string) => request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send({ force: true });
const setUsed = (sid: string, usedSeconds: number) => db.therapySession.update({ where: { id: sid }, data: { usedSeconds, lastActivityAt: new Date() } });
const getProg = (u: U, pid: string) => request(app).get(`/api/v1/session-programs/${pid}`).set(auth(u.accessToken));

describe('session programs: CRUD, encryption, ownership', () => {
  it('creates a program with encrypted text, builds the topic from kind and lists it', async () => {
    const u = await mk();
    const p = await newProgram(u);
    const row = await db.sessionProgram.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.titleEncrypted).not.toContain('Sleeping');
    expect(row.goalEncrypted).not.toContain('Fall asleep');
    expect(row.topicId).toBeTruthy();
    const list = await request(app).get('/api/v1/session-programs').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ title: 'Sleeping better', goal: 'Fall asleep by 11', status: 'ACTIVE', todayState: 'READY', completedSittings: 0, currentDay: 1, progressPct: 0, plannedDays: 3, dailyMinutes: 30 });
    expect(list.body.data[0].topic.kind).toBe('SLEEP');
    const bad = await request(app).post('/api/v1/session-programs').set(auth(u.accessToken)).send({ title: 'x', plannedDays: 2, dailyMinutes: 30 });
    expect(bad.status).toBe(400);
    const bad2 = await request(app).post('/api/v1/session-programs').set(auth(u.accessToken)).send({ title: 'x', plannedDays: 5, dailyMinutes: 35 });
    expect(bad2.status).toBe(400);
  });

  it('returns 404 for every route on another user\'s program, sitting or topic', async () => {
    const a = await mk(); const b = await mk();
    const p = await newProgram(a);
    const s = (await startSit(a, p.id)).body.data.sittingId as string;
    const other = await newProgram(b);
    const topic = await request(app).post('/api/v1/topics').set(auth(a.accessToken)).send({ kind: 'GRIEF' });
    expect((await getProg(b, p.id)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/session-programs/${p.id}`).set(auth(b.accessToken)).send({ title: 'mine now' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/session-programs/${p.id}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await startSit(b, p.id)).status).toBe(404);
    expect((await request(app).get(`/api/v1/session-programs/${p.id}/sittings/${s}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/v1/session-programs/${other.id}/sittings/${s}`).set(auth(b.accessToken))).status).toBe(404); // a's sitting under b's program
    expect((await request(app).get(`/api/v1/session-programs/${other.id}/sittings/${s}`).set(auth(a.accessToken))).status).toBe(404);
    expect((await request(app).post('/api/v1/session-programs').set(auth(b.accessToken)).send({ title: 't', plannedDays: 3, dailyMinutes: 30, topicId: topic.body.data.id })).status).toBe(404);
    expect((await request(app).post('/api/v1/sessions').set(auth(b.accessToken)).send({ programId: p.id })).status).toBe(404);
    expect((await getProg(a, p.id)).status).toBe(200); // untouched
  });

  it('pauses, resumes and archives; a paused program cannot start a sitting', async () => {
    const u = await mk();
    const p = await newProgram(u);
    const paused = await request(app).patch(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken)).send({ status: 'PAUSED', title: 'Renamed', dailyMinutes: 40 });
    expect(paused.body.data).toMatchObject({ status: 'PAUSED', todayState: 'PAUSED', title: 'Renamed', dailyMinutes: 40 });
    const r = await startSit(u, p.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PROGRAM_NOT_ACTIVE');
    await request(app).patch(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken)).send({ status: 'ACTIVE' });
    const ok = await startSit(u, p.id);
    expect(ok.status).toBe(201);
    expect(ok.body.data.plannedMinutes).toBe(40);
    await request(app).patch(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken)).send({ status: 'ARCHIVED' });
    const list = await request(app).get('/api/v1/session-programs').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(0); // archived hidden by default
    const arch = await request(app).get('/api/v1/session-programs?status=ARCHIVED').set(auth(u.accessToken));
    expect(arch.body.data).toHaveLength(1);
  });

  it('delete cascades sittings, messages, notes and homework and writes an audit log', async () => {
    const u = await mk();
    const p = await newProgram(u);
    const s = (await startSit(u, p.id)).body.data.sittingId as string;
    expect((await say(u, s)).status).toBe(201);
    await endSit(u, s);
    await db.homework.create({ data: { userId: u.userId, sessionId: s, titleEncrypted: 'x' } });
    const before = await db.auditLog.count({ where: { actorId: u.userId, action: 'PROGRAM_DELETED' } });
    const del = await request(app).delete(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken));
    expect(del.status).toBe(204);
    expect(await db.sessionProgram.count({ where: { id: p.id } })).toBe(0);
    expect(await db.therapySession.count({ where: { id: s } })).toBe(0);
    expect(await db.sessionMessage.count({ where: { sessionId: s } })).toBe(0);
    expect(await db.sessionNote.count({ where: { sessionId: s } })).toBe(0);
    expect(await db.homework.count({ where: { sessionId: s } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorId: u.userId, action: 'PROGRAM_DELETED' } })).toBe(before + 1);
  });
});

describe('sittings: one per local day', () => {
  it('Day 1 and 2 are intake, Day 3 is regular; sitting detail and state expose the time box', async () => {
    const u = await mk();
    const p = await newProgram(u, { plannedDays: 4 });
    const days: any[] = [];
    for (const d of ['2025-03-01', '2025-03-02', '2025-03-03']) {
      at(`${d}T08:00:00Z`);
      const r = await startSit(u, p.id);
      expect(r.status).toBe(201);
      days.push(r.body.data);
      if (d === '2025-03-01') {
        expect(r.body.data.endsAt).toBe('2025-03-01T08:30:00.000Z');
        at('2025-03-01T08:10:00Z');
        const st = await request(app).get(`/api/v1/sessions/${r.body.data.sittingId}/state`).set(auth(u.accessToken));
        expect(st.body.data).toMatchObject({ endsAt: '2025-03-01T08:30:00.000Z', remainingSec: 20 * 60 });
        expect((await say(u, r.body.data.sittingId)).status).toBe(201);
      }
      await endSit(u, r.body.data.sittingId);
    }
    expect(days.map((x) => [x.dayNumber, x.isIntake, x.intakePart, x.sessionType])).toEqual([[1, true, 1, 'TEXT'], [2, true, 2, 'TEXT'], [3, false, null, 'TEXT']]);
    const det = await getProg(u, p.id);
    expect(det.body.data.timeline.map((t: any) => t.status)).toEqual(['DONE', 'DONE', 'DONE', 'UPCOMING']);
    expect(det.body.data).toMatchObject({ completedSittings: 3, currentDay: 4, progressPct: 75, moodTrend: expect.any(Array) });
    const sd = await request(app).get(`/api/v1/session-programs/${p.id}/sittings/${days[0].sittingId}`).set(auth(u.accessToken));
    expect(sd.body.data).toMatchObject({ dayNumber: 1, isIntake: true, status: 'ENDED' });
    expect(sd.body.data.transcript).toHaveLength(2);
    // transcript only when the user let the app remember the sitting
    await db.therapySession.update({ where: { id: days[0].sittingId }, data: { rememberThis: false } });
    const sd2 = await request(app).get(`/api/v1/session-programs/${p.id}/sittings/${days[0].sittingId}`).set(auth(u.accessToken));
    expect(sd2.body.data.transcript).toBeUndefined();
    expect(sd2.body.data.note).toBeNull();
  });

  it('starting again while one is open resumes it, ALREADY_DONE_TODAY once it ended, and the next day opens', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-04-01T09:00:00Z');
    const first = await startSit(u, p.id);
    const dup = await startSit(u, p.id);
    expect(dup.status).toBe(200); // was 409 SITTING_ALREADY_ACTIVE: an unfinished sitting is resumed, not refused
    expect(dup.body.data).toMatchObject({ sittingId: first.body.data.sittingId, resumed: true });
    expect((await getProg(u, p.id)).body.data.todayState).toBe('IN_PROGRESS');
    await endSit(u, first.body.data.sittingId);
    const again = await startSit(u, p.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DONE_TODAY');
    expect(again.body.error.details.nextAvailableAt).toBe('2025-04-02T00:00:00.000Z');
    const view = (await getProg(u, p.id)).body.data;
    expect(view).toMatchObject({ todayState: 'DONE_TODAY', nextAvailableAt: '2025-04-02T00:00:00.000Z' });
    // other programs of the same user are independent
    const p2 = await newProgram(u, { title: 'Second' });
    expect((await startSit(u, p2.id)).status).toBe(201);
    at('2025-04-02T00:01:00Z');
    const next = await startSit(u, p.id);
    expect(next.status).toBe(201);
    expect(next.body.data.dayNumber).toBe(2);
  });

  it('uses the user\'s timezone: 23:59 and 00:01 local are different days (Asia/Dhaka, UTC+6)', async () => {
    const u = await mk('Asia/Dhaka');
    const p = await newProgram(u);
    at('2025-01-15T17:59:00Z'); // 23:59 on Jan 15 in Dhaka
    const first = await startSit(u, p.id);
    expect(first.status).toBe(201);
    await endSit(u, first.body.data.sittingId);
    at('2025-01-15T17:59:30Z');
    const same = await startSit(u, p.id);
    expect(same.status).toBe(409);
    expect(same.body.error.details.nextAvailableAt).toBe('2025-01-15T18:00:00.000Z'); // local midnight
    at('2025-01-15T18:01:00Z'); // 00:01 on Jan 16 in Dhaka, still Jan 15 in UTC
    const next = await startSit(u, p.id);
    expect(next.status).toBe(201);
    expect(next.body.data.dayNumber).toBe(2);
    // the same two instants are ONE day for a UTC user
    const v = await mk('UTC');
    const pv = await newProgram(v);
    at('2025-01-15T17:59:00Z');
    await endSit(v, (await startSit(v, pv.id)).body.data.sittingId);
    at('2025-01-15T18:01:00Z');
    expect((await startSit(v, pv.id)).body.error.code).toBe('ALREADY_DONE_TODAY');
  });

  it('gives up a sitting left unfinished for over 3 days (kept if it has messages, dropped if empty)', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-05-01T10:00:00Z');
    const s1 = (await startSit(u, p.id)).body.data.sittingId as string;
    await say(u, s1);
    at('2025-05-05T10:00:00Z'); // 4 days later (an unfinished sitting younger than 3 days is resumed instead)
    const s2 = await startSit(u, p.id);
    expect(s2.status).toBe(201);
    expect(s2.body.data.dayNumber).toBe(2); // the abandoned one counts as day 1
    const old = await db.therapySession.findUniqueOrThrow({ where: { id: s1 } });
    expect(old.status).toBe('ENDED');
    expect(old.finalizedAt).not.toBeNull();
    // an empty one is removed, so the day number is reused
    await endSit(u, s2.body.data.sittingId);
    at('2025-05-06T10:00:00Z');
    const s3 = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-05-10T10:00:00Z');
    const s4 = await startSit(u, p.id);
    expect(s4.body.data.dayNumber).toBe(3);
    expect(await db.therapySession.count({ where: { id: s3 } })).toBe(0);
  });

  it('completes the program at plannedDays and then refuses further sittings', async () => {
    const u = await mk();
    const p = await newProgram(u, { plannedDays: 3 });
    for (const d of ['2025-06-01', '2025-06-02', '2025-06-03']) {
      at(`${d}T12:00:00Z`);
      const r = await startSit(u, p.id);
      expect(r.status).toBe(201);
      if (d !== '2025-06-03') expect((await getProg(u, p.id)).body.data.status).toBe('ACTIVE');
      await endSit(u, r.body.data.sittingId);
    }
    const v = (await getProg(u, p.id)).body.data;
    expect(v).toMatchObject({ status: 'COMPLETED', todayState: 'COMPLETED', progressPct: 100, completedSittings: 3, currentDay: 3 });
    expect((await db.sessionProgram.findUniqueOrThrow({ where: { id: p.id } })).completedAt).not.toBeNull();
    at('2025-06-04T12:00:00Z');
    const r = await startSit(u, p.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PROGRAM_NOT_ACTIVE');
    const reopen = await request(app).patch(`/api/v1/session-programs/${p.id}`).set(auth(u.accessToken)).send({ status: 'ACTIVE' });
    expect(reopen.status).toBe(409);
  });

  it('POST /sessions with a programId starts the same sitting and enforces the same rules', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-07-01T09:00:00Z');
    const r = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p.id });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ programId: p.id, dayNumber: 1, plannedMinutes: 30, isIntake: true, endsAt: '2025-07-01T09:30:00.000Z' });
    const dup = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p.id });
    expect(dup.status).toBe(200); // was 409 SITTING_ALREADY_ACTIVE: the unfinished sitting is resumed
    expect(dup.body.data).toMatchObject({ id: r.body.data.id, resumed: true });
  });
});

describe('sitting time box', () => {
  it('refuses new messages once the planned ACTIVE time is used with SITTING_TIME_UP and finalizes the sitting', async () => {
    const u = await mk();
    const p = await newProgram(u);
    at('2025-08-01T09:00:00Z');
    const s = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-08-01T09:29:00Z');
    await setUsed(s, 29 * 60); // 29 of 30 active minutes used (the box no longer follows the wall clock)
    expect((await say(u, s)).status).toBe(201);
    const st = await request(app).get(`/api/v1/sessions/${s}/state`).set(auth(u.accessToken));
    expect(st.body.data.remainingSec).toBe(60);
    await setUsed(s, 30 * 60);
    const late = await say(u, s, 'One more thing about my week');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SITTING_TIME_UP');
    const row = await db.therapySession.findUniqueOrThrow({ where: { id: s } });
    expect(row.status).toBe('ENDED');
    expect(row.finalizedAt).not.toBeNull();
    expect((await getProg(u, p.id)).body.data.completedSittings).toBe(1);
    const st2 = await request(app).get(`/api/v1/sessions/${s}/state`).set(auth(u.accessToken));
    expect(st2.body.data.remainingSec).toBe(0);
  });

  it('never hard-stops a user whose risk flag is ELEVATED or HIGH, or whose message is a safety concern', async () => {
    const u = await mk();
    for (const flag of ['ELEVATED', 'HIGH']) {
      const p = await newProgram(u, { title: `P ${flag}` });
      at('2025-09-01T09:00:00Z');
      const s = (await startSit(u, p.id)).body.data.sittingId as string;
      await db.therapySession.update({ where: { id: s }, data: { riskFlag: flag } });
      at('2025-09-01T11:00:00Z');
      await setUsed(s, 30 * 60); // the full time is used
      const r = await say(u, s, 'I just need to talk a little longer');
      expect(r.status).toBe(201);
      expect((await db.therapySession.findUniqueOrThrow({ where: { id: s } })).status).toBe('ACTIVE');
    }
    // risk flag still NONE, but the message itself is a safety concern: crisis / support path runs, no time-up
    const p = await newProgram(u, { title: 'P text' });
    at('2025-09-02T09:00:00Z');
    const s = (await startSit(u, p.id)).body.data.sittingId as string;
    at('2025-09-02T11:00:00Z');
    await setUsed(s, 30 * 60);
    const hopeless = await say(u, s, 'I feel hopeless and I cannot go on like this');
    expect(hopeless.status).toBe(201);
    const crisis = await say(u, s, 'I want to kill myself tonight');
    expect(crisis.status).toBe(201);
    expect(crisis.body.data.safety.crisis).toBe(true);
  });

  it('a legacy standalone session has no time box', async () => {
    const u = await mk();
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' });
    expect(s.status).toBe(201);
    expect(s.body.data).toMatchObject({ programId: null, dayNumber: null, plannedMinutes: 0, endsAt: null });
    const st = await request(app).get(`/api/v1/sessions/${s.body.data.id}/state`).set(auth(u.accessToken));
    expect(st.body.data).toMatchObject({ endsAt: null, remainingSec: null });
    expect((await say(u, s.body.data.id)).status).toBe(201);
    const list = await request(app).get('/api/v1/sessions').set(auth(u.accessToken));
    expect(list.body.data.map((x: any) => x.id)).toContain(s.body.data.id);
    const progs = await request(app).get('/api/v1/session-programs').set(auth(u.accessToken));
    expect(progs.body.data).toHaveLength(0); // legacy sessions are not programs
  });
});

describe('feature gates', () => {
  it('PROGRAM_REQUIRED for a standalone session when ALLOW_STANDALONE_SESSIONS is off', async () => {
    const off = offApp();
    const u = await mk();
    const r = await request(off).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('PROGRAM_REQUIRED');
    const p = await newProgram(u, {}, off);
    const ok = await request(off).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p.id });
    expect(ok.status).toBe(201);
    // the flag on (test default) keeps the legacy behaviour
    expect((await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({})).status).toBe(201);
  });

  it('MODE_DISABLED for voice sessions and the speech endpoints when VOICE_ENABLED is off', async () => {
    const off = offApp();
    const u = await mk();
    const v = await request(off).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE', programId: (await newProgram(u, {}, off)).id });
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe('MODE_DISABLED');
    const tts = await request(off).post('/api/v1/speech').set(auth(u.accessToken)).send({ text: 'hello' });
    expect(tts.status).toBe(400);
    expect(tts.body.error.code).toBe('MODE_DISABLED');
    const stt = await request(off).post('/api/v1/speech/transcribe').set(auth(u.accessToken)).set('Content-Type', 'audio/webm').send(Buffer.from('abc'));
    expect(stt.status).toBe(400);
    expect(stt.body.error.code).toBe('MODE_DISABLED');
    // and enabled by default in the test env
    expect((await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE' })).status).toBe(201);
  });

  it('refuses the realtime websocket upgrade when VOICE_ENABLED is off', async () => {
    const off = offApp();
    const server = createServer(off);
    attachRealtime(server, off.locals.deps);
    server.listen(0);
    await once(server, 'listening');
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/realtime`);
      const [, res] = await once(ws, 'unexpected-response');
      expect(res.statusCode).toBe(400);
      res.resume();
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});
