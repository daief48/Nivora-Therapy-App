import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { templateWeek, validateWeekReport, weekFactLines, type WeekFacts } from '../services/weeklyReport.js';
import { addDays, localDate } from '../utils/dates.js';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const GOOD = JSON.stringify({
  headline: 'A week with small steps and some quiet nights.',
  text: 'You made room for a few small steps this week. Your sleep and your mood both showed up in your own notes. Some nights were shorter than others. Your mood moved up and down a little, as it does. You can keep things gentle next week. One small step at a time is enough.',
});
const post = (app: any, t: string, body: unknown = {}) => request(app).post('/api/v1/reports/weekly').set(auth(t)).send(body as object);
const grant = (app: any, t: string, consentType: string) => request(app).post('/api/v1/consents').set(auth(t)).send({ consentType }).expect(201);

async function seed(userId: string) {
  const today = localDate('UTC');
  await db.checkIn.create({ data: { userId, kind: 'MORNING', mood: 6, stress: 4, energy: 5 } });
  await db.checkIn.create({ data: { userId, kind: 'EVENING', mood: 7, stress: 3, energy: 5, createdAt: new Date(Date.now() - 86_400_000) } });
  for (const [i, min] of [[0, 330], [1, 450]] as const) await db.sleepEntry.create({ data: { userId, date: addDays(today, -i), bedtime: '23:00', wakeTime: '06:00', durationMin: min, latencyMin: 15, awakenings: 1, rested: 5, score: 70 } });
  const g = await db.kaizenGoal.create({ data: { userId, title: 'Calm', category: 'BREATHING', status: 'ACTIVE' } });
  await db.kaizenAction.create({ data: { goalId: g.id, userId, date: today, title: 'Breathe', description: '', targetValue: 2, unit: 'minutes', status: 'DONE' } });
  await db.kaizenAction.create({ data: { goalId: g.id, userId, date: addDays(today, -1), title: 'Breathe', description: '', targetValue: 2, unit: 'minutes', status: 'SKIPPED' } });
}

describe('weekly report: pure parts', () => {
  const facts: WeekFacts = { weekStart: '2026-10-29', kaizenDone: 3, kaizenTotal: 5, restarts: 1, hardDays: 0, sleepNights: 4, avgSleepScore: 71, avgSleepHours: 6.8, shortNights: 1, moodDays: 5, avgMood: 6.4, avgStress: 4.2, daysWithData: 6 };
  const lines = weekFactLines(facts);
  it('the template exists in all four languages and holds only computed numbers', () => {
    for (const l of ['en', 'bn', 'hi', 'ne']) {
      const t = templateWeek(facts, l);
      expect(t.headline.length).toBeGreaterThan(5); expect(t.text.length).toBeGreaterThan(20);
    }
    expect(templateWeek(facts, 'en').text).toContain('3 small steps');
    expect(templateWeek({ ...facts, daysWithData: 1 }, 'en').text).toMatch(/not much to look back on/);
  });
  const ok = { headline: 'A calm week.', text: 'One. Two. Three. Four.' };
  it('accepts only the right shape: headline 1-3 sentences, body 4-6, numbers from the facts, safe wording', () => {
    expect(validateWeekReport(ok, lines)).toEqual(ok);
    expect(validateWeekReport({ headline: 'A. B. C. D.', text: ok.text }, lines)).toBeNull(); // headline too long
    expect(validateWeekReport({ headline: ok.headline, text: 'One. Two. Three.' }, lines)).toBeNull(); // body too short
    expect(validateWeekReport({ headline: ok.headline, text: 'One. Two. Three. Four. Five. Six. Seven.' }, lines)).toBeNull(); // body too long
    expect(validateWeekReport({ headline: ok.headline, text: 'You slept 8 hours. Two. Three. Four.' }, lines)).toBeNull(); // 8 is not a fact
    expect(validateWeekReport({ headline: ok.headline, text: 'You took 3 small steps. Two. Three. Four.' }, lines)).not.toBeNull();
    expect(validateWeekReport({ headline: ok.headline, text: 'Your mood was 6.4 out of 10. Two. Three. Four.' }, lines)).not.toBeNull();
    expect(validateWeekReport({ headline: ok.headline, text: 'You probably have depression. Two. Three. Four.' }, lines)).toBeNull();
    expect(validateWeekReport(null, lines)).toBeNull(); expect(validateWeekReport({ headline: 1, text: 2 }, lines)).toBeNull();
  });
});

describe('POST /reports/weekly', () => {
  it('needs WELLNESS_AI_SHARING: 403 CONSENT_REQUIRED and the model is never called (journal consent does not count)', async () => {
    const glm = fakeGlm(GOOD);
    const app = makeApp({ glm });
    const u = await register(app);
    await seed(u.userId);
    const a = await post(app, u.accessToken);
    expect(a.status).toBe(403); expect(a.body.error.code).toBe('CONSENT_REQUIRED'); expect(a.body.error.details.consentType).toBe('WELLNESS_AI_SHARING');
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    expect((await post(app, u.accessToken)).status).toBe(403);
    expect(glm.calls.length).toBe(0);
  });

  it('happy path: ONE model call, ai:true, persisted encrypted in WeeklySummary, facts only in the prompt', async () => {
    const glm = fakeGlm(GOOD);
    const app = makeApp({ glm });
    const u = await register(app);
    await seed(u.userId);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const res = await post(app, u.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ai: true, cached: false, riskMode: false, headline: expect.stringContaining('small steps') });
    expect(res.body.data.stats).toMatchObject({ kaizenDone: 1, kaizenTotal: 2, sleepNights: 2, moodDays: 2 });
    expect(glm.calls).toHaveLength(1);
    const prompt = glm.calls[0]!.map((m) => m.content).join('\n');
    expect(prompt).toContain('Small steps completed: 1 of 2.');
    const row = await db.weeklySummary.findFirst({ where: { userId: u.userId } });
    expect(row!.reportEncrypted).toBeTruthy(); expect(row!.reportEncrypted).not.toContain('small steps');
    expect(JSON.parse(cipher.decrypt(row!.reportEncrypted!))).toMatchObject({ ai: true, headline: expect.any(String) });
    expect(row!.ai).toBe(true);
    // a stored report is returned without another model call; force regenerates
    const again = await post(app, u.accessToken);
    expect(again.body.data).toMatchObject({ cached: true, ai: true }); expect(glm.calls).toHaveLength(1);
    expect((await post(app, u.accessToken, { force: true })).body.data.cached).toBe(false); expect(glm.calls).toHaveLength(2);
    expect(await db.weeklySummary.count({ where: { userId: u.userId } })).toBe(1);
    const got = await request(app).get('/api/v1/reports/weekly').set(auth(u.accessToken));
    expect(got.body.data).toMatchObject({ ai: true, cached: true });
    // the older endpoints keep working and see the same row
    const list = await db.weeklySummary.findMany({ where: { userId: u.userId } });
    expect(list).toHaveLength(1);
  });

  it('invented numbers, a bad shape or unsafe wording fall back to the template (ai:false); so does a model failure', async () => {
    const cases: (string | Error)[] = [
      JSON.stringify({ headline: 'A week.', text: 'You slept 9 hours a night on average. Two. Three. Four.' }),
      JSON.stringify({ headline: 'A week.', text: 'Only one sentence here.' }),
      JSON.stringify({ headline: 'A week.', text: 'You probably have depression. Two. Three. Four.' }),
      'not json at all',
      new Error('provider down'),
    ];
    for (const reply of cases) {
      const glm = fakeGlm(reply);
      const app = makeApp({ glm });
      const u = await register(app);
      await seed(u.userId);
      await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
      const res = await post(app, u.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data.ai).toBe(false);
      expect(res.body.data.headline).toBe('Here is your week, in your own numbers.');
      expect(res.body.data.text).toContain('1 small steps');
      expect(glm.calls).toHaveLength(1);
      expect((await db.weeklySummary.findFirst({ where: { userId: u.userId } }))!.ai).toBe(false);
    }
  });

  it('too little data: template, no model call', async () => {
    const glm = fakeGlm(GOOD);
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const res = await post(app, u.accessToken);
    expect(res.body.data.ai).toBe(false);
    expect(res.body.data.text).toMatch(/not much to look back on/);
    expect(glm.calls).toHaveLength(0);
  });

  it('risk signals: no model call, no next step, support options only, nothing stored', async () => {
    const glm = fakeGlm(GOOD);
    const app = makeApp({ glm });
    const u = await register(app);
    await seed(u.userId);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const res = await post(app, u.accessToken);
    expect(res.body.data).toMatchObject({ riskMode: true, ai: false, nextStep: null });
    expect(res.body.data.support.map((s: any) => s.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
    expect(glm.calls).toHaveLength(0);
    expect(await db.weeklySummary.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('replies in the user\'s language when the template is used', async () => {
    const glm = fakeGlm(new Error('down'));
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'ne' });
    await seed(u.userId);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const res = await post(app, u.accessToken);
    expect(res.body.data.headline).toMatch(/[ऀ-ॿ]/);
    expect(res.body.data.nextStep === null || /[ऀ-ॿ]/.test(res.body.data.nextStep.title)).toBe(true);
  });
});
