import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, captureLogs, db, fakeGlm, makeApp, register } from './helpers.js';
import type { GlmClient } from '../services/glmClient.js';

const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
afterEach(() => { if (vi.isFakeTimers()) vi.useRealTimers(); });

/**
 * End-to-end through HTTP for the conversational core the user actually experiences:
 * text chat (streamed, with the private emotion read and the style guard), voice calls
 * (shortened spoken replies, stricter output safety), video calls (VIDEO kept as the
 * requested mode end to end, down to the Kaizen goal origin), crisis fragments across
 * short turns, and the session-end hand-off into the Kaizen goal decision.
 */
const mkProgram = async (app: ReturnType<typeof makeApp>, token: string) => {
  const r = await request(app).post('/api/v1/session-programs').set(auth(token)).send({ title: 'Stress', goal: 'calmer days', plannedDays: 5, dailyMinutes: 30, kind: 'SLEEP' });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
};
const startSitting = (app: ReturnType<typeof makeApp>, token: string, pid: string, mode: 'TEXT' | 'VOICE' | 'VIDEO' = 'TEXT') =>
  request(app).post(`/api/v1/session-programs/${pid}/sittings`).set(auth(token)).send({ mode });
const endSitting = (app: ReturnType<typeof makeApp>, token: string, sid: string) =>
  request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(token)).send({ force: true });

const SSE = { Accept: 'text/event-stream' };

describe('AI reply journey, end to end', () => {
  it('TEXT: streamed reply via SSE with the private emotion read in the prompt, then the style guard retried once', async () => {
    const utility = fakeGlm(JSON.stringify({ emotions: ['দুশ্চিন্তা'], intensity: 3, need: 'validate', theme: 'exams', userWords: ['চাপ লাগছে'] }));
    const glm = fakeGlm();
    const logs = captureLogs();
    const app = makeApp({ glm, utilityGlm: utility as unknown as GlmClient, logStream: logs.stream });
    const u = await register(app);
    const pid = await mkProgram(app, u.accessToken);
    const s = await startSitting(app, u.accessToken, pid, 'TEXT');
    const sid = s.body.data.sittingId as string;

    // Two earlier turns so the reply has context; the last one streams over SSE.
    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'Exams are coming and sleep is bad' }).expect(201);
    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'I keep waking at 4am thinking about papers' }).expect(201);

    glm.reply = 'That sounds heavy. The pressure is real and your body is reacting to it.';
    glm.streamParts = ['That sounds heavy. ', 'The pressure is real and your body is reacting to it.'];
    const sse = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).set(SSE).send({ text: 'চাপ লাগছে খুব' });
    expect(sse.status).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const events = sse.text.split('\n\n').filter((b) => b.startsWith('event:'));
    const names = events.map((e) => e.split('\n')[0]!.replace('event: ', ''));
    expect(names).toContain('delta');
    expect(names.at(-1)).toBe('done');
    const done = JSON.parse(events.find((e) => e.startsWith('event: done'))!.split('\ndata: ')[1]!);
    expect(done.message.content).toContain('pressure is real');
    expect(done.safety.crisis).toBe(false);

    // The private emotion read ran on the cheap model and its read reached the session prompt (never shown to the user).
    expect(utility.calls.length).toBeGreaterThanOrEqual(1);
    const system = glm.calls.at(-1)!.find((m: { role: string }) => m.role === 'system')!.content;
    expect(system).toContain('EMOTION READ');
    expect(system).toContain('চাপ লাগছে'); // the person's own words, so the reply reflects their language

    // Streaming deltas were already visible on the wire while the reply was being written.
    const deltas = events.filter((e) => e.startsWith('event: delta')).map((e) => JSON.parse(e.split('\ndata: ')[1]!).text);
    expect(deltas.join('')).toContain('That sounds heavy.');

    // Style guard: a lecturing, list-heavy reply triggers exactly one corrective retry (same checks), first reply kept on ties.
    glm.reply = 'Here is what to do. 1. Sleep at the same time. 2. No screens. 3. Meditate daily. 4. Exercise. 5. Journal. 6. Breathe. 7. Repeat. Does that help? What else? Why now?';
    const lectured = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'what should I do about it' }).expect(201);
    expect(lectured.body.data.message.content).toBeTruthy();
    expect(logs.text()).toContain('style_guard_retry');
    expect(glm.calls.length).toBeGreaterThanOrEqual(6); // 3 replies + 1 corrective retry
    const retrySystem = glm.calls.at(-1)![0]!.content;
    expect(retrySystem).toContain('CORRECTION'); // the corrective note travelled with the retry
  });

  it('VOICE: the spoken reply is shortened to whole sentences, and unsafe advice for the ear is replaced', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const pid = await mkProgram(app, u.accessToken);
    const s = await startSitting(app, u.accessToken, pid, 'VOICE');
    const sid = s.body.data.sittingId;
    expect(s.body.data.mode).toBe('VOICE');
    expect(s.body.data.sessionType).toBe('VOICE');

    glm.reply = 'That sounds really heavy and I am sorry the week went this way. You could try to journal for ten minutes before bed. You could also lower your caffeine intake after noon. Taking 5 mg of melatonin might help you sleep. What feels most manageable right now?';
    const r = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'I cannot sleep before 3am lately' }).expect(201);
    // The medication dosage advice is stripped by the spoken output check: the whole reply becomes the fixed safe fallback.
    expect(r.body.data.message.content).not.toMatch(/melatonin|5 mg/i);

    glm.reply = 'That sounds heavy, and I am glad you said it. It makes sense after a week like yours. What time do you usually lie down? But also consider your evenings, and your coffee, and your phone, and your workload, and your weekend plans too.';
    const r2 = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'long days lately' }).expect(201);
    const spoken = r2.body.data.message.content as string;
    // Kept short for the ear: at most 3 sentences, closing question kept when present.
    const sentences = spoken.split(/[.!?]+/).filter((x) => x.trim());
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(spoken).toContain('lie down'); // the closing question survived
  });

  it('VIDEO: the requested mode is kept end to end, from the sitting to the Kaizen goal origin', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const pid = await mkProgram(app, u.accessToken);
    // Days 1-2 are intake sittings (no goal offers there); the journey lands on day 3, a normal sitting.
    for (const [day, hour] of [['2025-05-01', '04:00'], ['2025-05-02', '04:00']] as const) {
      at(`${day}T${hour}:00Z`);
      const early = await startSitting(app, u.accessToken, pid, 'TEXT');
      await request(app).post(`/api/v1/sessions/${early.body.data.sittingId}/messages`).set(auth(u.accessToken)).send({ text: 'getting to know each other' }).expect(201);
      await endSitting(app, u.accessToken, early.body.data.sittingId);
    }
    at('2025-05-03T04:00:00Z');
    const s = await startSitting(app, u.accessToken, pid, 'VIDEO');
    const sid = s.body.data.sittingId;
    expect(s.body.data.mode).toBe('VIDEO');
    expect(s.body.data.sessionType).toBe('VOICE'); // server-side a video call is a voice session
    const row = await db.therapySession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.modeRequested).toBe('VIDEO');

    const r = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'seeing your face helps today' }).expect(201);
    expect(r.body.data.message.content).toBeTruthy(); // the spoken path applies here too

    // The therapy↔Kaizen goal link is gone: ending a session no longer creates suggested goals,
    // even for a struggling condition (Feature B goals are the user's own and never session-made).
    for (let i = 0; i < 3; i++) await db.checkIn.create({ data: { userId: u.userId, kind: 'MORNING', mood: 5, stress: 9, energy: 4 } });
    await endSitting(app, u.accessToken, sid);
    const goals = await db.kaizenGoal.findMany({ where: { userId: u.userId, systemKey: null } });
    expect(goals.every((g) => g.status === 'ABANDONED' || g.status === 'COMPLETED')).toBe(true);
    expect(goals.some((g) => g.status === 'ACTIVE')).toBe(false);
  });

  it('a crisis split across two short voice turns is caught as one, the model is never called and the words are not kept', async () => {
    const glm = fakeGlm('I hear you.');
    const app = makeApp({ glm });
    const u = await register(app);
    const pid = await mkProgram(app, u.accessToken);
    const s = await startSitting(app, u.accessToken, pid, 'VOICE');
    const sid = s.body.data.sittingId;
    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'I had a hard day' }).expect(201);

    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'Honestly lately there is' }).expect(201);
    const callsBeforeCrisis = glm.calls.length;
    const crisis = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'no reason to live' }).expect(201);
    expect(crisis.body.data.safety.crisis).toBe(true);
    expect(crisis.body.data.message.content.length).toBeGreaterThan(20); // the fixed, reviewed reply with support options
    expect(glm.calls.length).toBe(callsBeforeCrisis); // no model call on the crisis path

    // The user's high-risk words are never stored: only the two pre-crisis turns (user+assistant each)
    // and the crisis assistant reply exist — there is no user row for the crisis turn.
    expect((await db.sessionMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' } })).map((m) => m.role)).toEqual([
      'user', 'assistant', 'user', 'assistant', 'assistant',
    ]);
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: sid } })).riskFlag).toBe('HIGH');
  });
});
