import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { addDays, localDate } from '../utils/dates.js';
import { createLogger } from '../utils/logger.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';
import { addKaizenStep } from '../services/kaizenExtras.js';
import { createCipher } from '../utils/crypto.js';
const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);

type App = ReturnType<typeof makeApp>;
const grant = (app: App, token: string, consentType: string) => request(app).post('/api/v1/consents').set(auth(token)).send({ consentType }).expect(201);
function expectConsentRequired(res: request.Response, consentType: string) {
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  expect(res.body.error.details.consentType).toBe(consentType);
}

// ---------- Phase 2: voice journal ----------
describe('POST /journal/voice', () => {
  const AUDIO = Buffer.alloc(4000, 3);
  const mkStt = (text: string) => { const s: any = { calls: [], transcribe: async (_b: Buffer, mime: string, lang: string) => { s.calls.push({ mime, lang }); return text; } }; return s; };
  const appWith = (stt: any, glm = fakeGlm()) => createApp({ config, db, logger: createLogger('silent'), glm, stt, limits: { global: 10_000, auth: 10_000, messages: 10_000, tts: 10_000 } });
  const send = (app: any, token: string, q = '', type = 'audio/mp4') => request(app).post(`/api/v1/journal/voice${q}`).set(auth(token)).set('Content-Type', type).send(AUDIO);

  it('stores the transcript without calling the model when JOURNAL_AI_SHARING is missing', async () => {
    const glm = fakeGlm();
    const app = appWith(mkStt('I felt tired but calm today'), glm);
    const u = await register(app);
    const res = await send(app, u.accessToken, '?language=en');
    expect(res.status).toBe(201);
    expect(res.body.data.entry.content).toBe('I felt tired but calm today');
    expect(res.body.data.entry.source).toBe('voice');
    expect(res.body.data.entry.hasAudio).toBe(false);
    expect(res.body.data.emotions).toBeNull();
    expect(res.body.data.consentNeeded).toBe('JOURNAL_AI_SHARING');
    expect(glm.calls.length).toBe(0);
  });

  it('with consent: emotion words from the model; falls back to the word list (ai:false) when it fails; audio kept only on request', async () => {
    const glm = fakeGlm('{"emotions":["tired","calm"],"reflection":"Words that showed up in your writing: tired, calm.","suggestion":"Take three slow breaths."}');
    const stt = mkStt('I felt tired but calm today');
    const app = appWith(stt, glm);
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const ok = await send(app, u.accessToken, '?language=ne');
    expect(ok.body.data.emotions.ai).toBe(true);
    expect(ok.body.data.consentNeeded).toBeNull();
    expect(stt.calls[0].lang).toBe('ne');
    const kept = await send(app, u.accessToken, '?keepAudio=1');
    expect(kept.body.data.entry.hasAudio).toBe(true);
    const audio = await request(app).get(`/api/v1/journal/${kept.body.data.entry.id}/audio`).set(auth(u.accessToken));
    expect(audio.status).toBe(200);
    expect(audio.body.length).toBe(4000);
    await request(app).get(`/api/v1/journal/${ok.body.data.entry.id}/audio`).set(auth(u.accessToken)).expect(404);

    const bad = appWith(mkStt('I felt tired today'), fakeGlm(new Error('down')));
    const u2 = await register(bad);
    await grant(bad, u2.accessToken, 'JOURNAL_AI_SHARING');
    const fb = await send(bad, u2.accessToken);
    expect(fb.status).toBe(201);
    expect(fb.body.data.emotions.ai).toBe(false);
    expect(fb.body.data.emotions.emotions).toContain('tired');
  });

  it('high-risk transcript: nothing stored, model never called, crisis support returned, safety event recorded', async () => {
    const glm = fakeGlm();
    const app = appWith(mkStt('I want to kill myself'), glm);
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const res = await send(app, u.accessToken, '?clean=1');
    expect(res.status).toBe(200);
    expect(res.body.data.crisis).toBe(true);
    expect(res.body.data.entry).toBeNull();
    expect(glm.calls.length).toBe(0);
    const list = await request(app).get('/api/v1/journal').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(0);
    expect(await db.safetyEvent.count({ where: { userId: u.userId } })).toBe(1);
  });

  it('caps duration and size, rejects non-audio and silence', async () => {
    const app = appWith(mkStt('hello there'));
    const u = await register(app);
    const long = await send(app, u.accessToken, '?durationSec=181');
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('AUDIO_TOO_LONG');
    expect((await send(app, u.accessToken, '', 'text/plain')).status).toBe(415);
    const big = await request(app).post('/api/v1/journal/voice').set(auth(u.accessToken)).set('Content-Type', 'audio/mp4').send(Buffer.alloc(5 * 1024 * 1024 + 10, 1));
    expect(big.status).toBe(413);
    const silent = appWith(mkStt('   '));
    const u2 = await register(silent);
    expect((await send(silent, u2.accessToken)).body.error.code).toBe('NO_SPEECH');
  });
});

// ---------- Phase 3: monthly, weekly summaries, garden ----------
async function seedMonth(userId: string, days = 20) {
  const today = localDate('UTC');
  for (let i = 0; i < days; i++) {
    const date = addDays(today, -i);
    const sleepScore = 50 + (i % 5) * 10; // 50..90
    const stress = 9 - (i % 5); // inversely related to sleep
    await db.checkIn.create({ data: { userId, kind: 'MORNING', mood: 4 + (i % 5), stress, energy: 5, createdAt: new Date(`${date}T10:00:00Z`) } });
    await db.sleepEntry.create({ data: { userId, date, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, latencyMin: 10, awakenings: 0, rested: 6, score: sleepScore } });
  }
}

describe('GET /insights/monthly', () => {
  const goodReply = (s: any) => JSON.stringify({
    headline: `You wrote on ${s.daysLogged} days.`,
    text: `Your average mood was ${s.averages.mood} out of 10. Your average stress was ${s.averages.stress} out of 10. Stress tended to be lower when sleep was better. You completed ${s.kaizenDone} small steps. A short wind-down tonight could be a gentle next step.`,
  });

  it('too little data: {enough:false}, no consent needed, model not called', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const r = await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data.enough).toBe(false);
    expect(r.body.data.narrative).toBeNull();
    expect(glm.calls.length).toBe(0);
  });

  it('enough data: blocked without consent, stats first, validated narrative with consent, template when numbers do not match', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    await seedMonth(u.userId);
    expectConsentRequired(await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken)), 'WELLNESS_AI_SHARING');
    expect(glm.calls.length).toBe(0);

    const plain = await request(app).get('/api/v1/insights/monthly?ai=0').set(auth(u.accessToken));
    expect(plain.status).toBe(200);
    expect(plain.body.data.enough).toBe(true);
    expect(plain.body.data.narrative.ai).toBe(false);
    expect(plain.body.data.series).toHaveLength(30);
    const pair = plain.body.data.correlations.find((c: any) => c.a === 'stress' && c.b === 'sleepScore');
    expect(pair.direction).toBe('opposite');
    expect(plain.body.data.weekdays).toHaveLength(7);
    expect(Object.keys(plain.body.data.share)).not.toContain('text');
    expect(glm.calls.length).toBe(0);

    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    glm.reply = goodReply(plain.body.data);
    const ok = await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken));
    expect(ok.body.data.narrative.ai).toBe(true);
    expect(glm.calls.length).toBe(1);
    expect(JSON.stringify(glm.calls[0])).not.toMatch(/worry|note/i);

    glm.reply = JSON.stringify({ headline: 'A good month.', text: 'Your mood was 9.9 out of 10. One. Two. Three. Four.' });
    const wrong = await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken));
    expect(wrong.body.data.narrative.ai).toBe(false);

    glm.reply = JSON.stringify({ headline: 'You probably have depression.', text: 'One. Two. Three. Four.' });
    expect((await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken))).body.data.narrative.ai).toBe(false);

    glm.reply = new Error('down');
    const down = await request(app).get('/api/v1/insights/monthly').set(auth(u.accessToken));
    expect(down.body.data.narrative.ai).toBe(false);
    expect(down.body.data.narrative.text).toBeTruthy();
  });
});

describe('kaizen garden', () => {
  it('the garden keeps its season and flowers forever: nothing a session or a goal status does can lower them', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    // an extra step via the journal flow (addKaizenStep helpers remain for other features)
    await addKaizenStep(db, u.userId, { category: 'SHORT_WALK', minutes: 5, source: 'WALK' });
    const act = await db.kaizenAction.findFirstOrThrow({ where: { userId: u.userId, source: 'WALK' } });
    expect(act.id).toBeTruthy();
    await request(app).post(`/api/v1/kaizen/actions/${act.id}/complete`).set(auth(u.accessToken)).send({ level: 'FULL' });
    await db.checkIn.create({ data: { userId: u.userId, kind: 'MORNING', mood: 9, stress: 2, energy: 8 } });
    const before = await request(app).get('/api/v1/kaizen/garden').set(auth(u.accessToken));
    expect(before.body.data.total).toBe(1);
    expect(before.body.data.season).toBe('SUMMER');
    expect(before.body.data.seasonLabel).toBe('Summer');
    // even archiving the helper goal cannot touch the flowers
    await db.kaizenGoal.updateMany({ where: { userId: u.userId }, data: { status: 'ABANDONED' } });
    const after = await request(app).get('/api/v1/kaizen/garden').set(auth(u.accessToken));
    expect(after.body.data.total).toBe(1);
    expect(after.body.data.carried).toBe(0);
  });
});

// ---------- Phase 4: nudges ----------
describe('nudges and today feed', () => {
  it('settings round-trip, snooze and the feed shape', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    const def = await request(app).get('/api/v1/nudges/settings').set(auth(u.accessToken));
    expect(def.body.data).toMatchObject({ enabled: true, quietStart: '23:00', quietEnd: '07:00', types: { WIND_DOWN: true, MOOD_CHECKIN: true, WEEKLY_REVIEW: true, MORNING_PLAN: true } });
    const put = await request(app).put('/api/v1/nudges/settings').set(auth(u.accessToken)).send({ quietStart: '22:00', types: { MOOD_CHECKIN: false } });
    expect(put.body.data.quietStart).toBe('22:00');
    expect(put.body.data.types.MOOD_CHECKIN).toBe(false);
    expect(put.body.data.types.WIND_DOWN).toBe(true);
    const snooze = await request(app).post('/api/v1/nudges/snooze').set(auth(u.accessToken)).send({ minutes: 60 });
    expect(snooze.body.data.snoozedUntil).toBeTruthy();
    const feed = await request(app).get('/api/v1/today/feed').set(auth(u.accessToken));
    expect(feed.status).toBe(200);
    expect(feed.body.data.nudges).toEqual([]); // snoozed
    expect(feed.body.data.plan).toHaveProperty('tonightBedtime');
    expect(Array.isArray(feed.body.data.insights)).toBe(true);
    await request(app).post('/api/v1/nudges/WIND_DOWN/dismiss').set(auth(u.accessToken)).expect(404);
    await request(app).post('/api/v1/nudges/BOGUS/dismiss').set(auth(u.accessToken)).expect(400);
  });
});

// ---------- Phase 5: device health import ----------
describe('health import', () => {
  it('needs consent, never overwrites manual nights, stays editable, and disconnect deletes imported rows', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    const body = { source: 'healthconnect', sleep: [{ date: '2026-10-20', bedtime: '23:00', wakeTime: '07:00' }, { date: '2026-10-21', bedtime: '23:30', wakeTime: '06:30' }], activity: [{ date: '2026-10-20', steps: 8000, walkingMin: 40 }] };
    expectConsentRequired(await request(app).post('/api/v1/health/import').set(auth(u.accessToken)).send(body), 'HEALTH_IMPORT');
    expect((await db.sleepEntry.count({ where: { userId: u.userId } }))).toBe(0);
    await request(app).post('/api/v1/sleep').set(auth(u.accessToken)).send({ bedtime: '22:00', wakeTime: '06:00', rested: 8, date: '2026-10-20' }).expect(201);
    await grant(app, u.accessToken, 'HEALTH_IMPORT');
    const imp = await request(app).post('/api/v1/health/import').set(auth(u.accessToken)).send(body);
    expect(imp.body.data.imported).toEqual({ sleep: 1, activity: 1 });
    expect(imp.body.data.skippedManual.sleep).toBe(1);
    const sleep = await request(app).get('/api/v1/sleep').set(auth(u.accessToken));
    const night = sleep.body.data.entries.find((e: any) => e.date === '2026-10-21');
    expect(night.source).toBe('healthconnect');
    expect(night.rested).toBeNull();
    expect(sleep.body.data.entries.find((e: any) => e.date === '2026-10-20').source).toBe('manual');
    expect((await request(app).get('/api/v1/health/status').set(auth(u.accessToken))).body.data).toEqual({ connected: true, importedSleepNights: 1, importedActivityDays: 1 });

    const edit = await request(app).patch(`/api/v1/sleep/${night.id}`).set(auth(u.accessToken)).send({ rested: 7, wakeTime: '07:00' });
    expect(edit.body.data.source).toBe('manual');
    expect(edit.body.data.rested).toBe(7);
    await request(app).post('/api/v1/health/import').set(auth(u.accessToken)).send({ source: 'healthkit', sleep: [{ date: '2026-10-22', bedtime: '23:00', wakeTime: '07:00' }] });
    const off = await request(app).delete('/api/v1/health/import').set(auth(u.accessToken));
    expect(off.body.data).toEqual({ deleted: { sleep: 1, activity: 1 }, consentWithdrawn: true });
    expect(await db.sleepEntry.count({ where: { userId: u.userId } })).toBe(2); // the two manual rows stay
    expectConsentRequired(await request(app).post('/api/v1/health/import').set(auth(u.accessToken)).send(body), 'HEALTH_IMPORT');
  });
});

// ---------- Phase 6: practice tools ----------
describe('practice tools', () => {
  it('breathing, grounding and thought records grow the garden once a day each', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    const b1 = await request(app).post('/api/v1/practice/breathing').set(auth(u.accessToken)).send({ minutes: 3 });
    expect(b1.status).toBe(201);
    expect(b1.body.data.kaizen).toEqual({ counted: true, flowers: 1 });
    const b2 = await request(app).post('/api/v1/practice/breathing').set(auth(u.accessToken)).send({});
    expect(b2.body.data.kaizen).toEqual({ counted: false, flowers: 1 });
    const g = await request(app).post('/api/v1/practice/grounding').set(auth(u.accessToken)).send({});
    expect(g.body.data.kaizen.flowers).toBe(2);
    const tr = await request(app).post('/api/v1/practice/thought-record').set(auth(u.accessToken)).send({ situation: 'Exam tomorrow', thought: 'I will fail', feeling: 'worried' });
    expect(tr.body.data.kaizen.flowers).toBe(3);
    const j = await request(app).get('/api/v1/journal?entryType=THOUGHT_RECORD').set(auth(u.accessToken));
    expect(j.body.data).toHaveLength(1);
    expect(JSON.parse(j.body.data[0].content).thought).toBe('I will fail');
    const garden = await request(app).get('/api/v1/kaizen/garden').set(auth(u.accessToken));
    expect(garden.body.data.total).toBe(3);
  });

  it('thought record with high-risk text stores nothing and counts nothing', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    const r = await request(app).post('/api/v1/practice/thought-record').set(auth(u.accessToken)).send({ situation: 'Bad night', thought: 'I want to kill myself' });
    expect(r.body.data.crisis).toBe(true);
    expect((await request(app).get('/api/v1/journal').set(auth(u.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/v1/kaizen/garden').set(auth(u.accessToken))).body.data.total).toBe(0);
  });

  it('gentler alternative: consent blocked, risk blocked, happy path, unsafe or failed model gives ai:false', async () => {
    const glm = fakeGlm('{"alternative":"I did my best with what I knew, and I can take it one step at a time."}');
    const app = makeApp({ glm });
    const u = await register(app);
    const call = (thought: string) => request(app).post('/api/v1/practice/thought-record/alternative').set(auth(u.accessToken)).send({ thought });
    expectConsentRequired(await call('I always fail'), 'JOURNAL_AI_SHARING');
    expect(glm.calls.length).toBe(0);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const risk = await call('I want to kill myself');
    expect(risk.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(0);
    const ok = await call('I always fail');
    expect(ok.body.data).toMatchObject({ crisis: false, ai: true });
    expect(ok.body.data.alternative).toContain('one step');
    expect(glm.calls.length).toBe(1);
    expect(glm.calls[0]![0]!.content).toMatch(/Never say the thought is wrong/);

    glm.reply = '{"alternative":"You probably have depression, so this thought is a symptom."}';
    const unsafe = await call('I always fail');
    expect(unsafe.body.data.ai).toBe(false);
    expect(unsafe.body.data.alternative).toBeTruthy();
    glm.reply = new Error('down');
    expect((await call('I always fail')).body.data.ai).toBe(false);
  });
});
