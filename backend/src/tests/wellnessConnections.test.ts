import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, localDate } from '../utils/dates.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});
afterEach(() => { vi.useRealTimers(); });
const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
type App = ReturnType<typeof makeApp>;
const call = (app: App, method: 'get' | 'post' | 'put' | 'delete', t: string, url: string, body?: unknown) => {
  const r = (request(app) as any)[method](`/api/v1${url}`).set(auth(t));
  return body === undefined ? r : r.send(body);
};
const grant = (app: App, t: string, consentType: string) => call(app, 'post', t, '/consents', { consentType }).expect(201);
const READING = (word: string) => JSON.stringify({ emotions: [word], reflection: `Words that showed up in your writing: ${word}.`, suggestion: 'Take three slow breaths.' });

describe('Journal -> Kaizen: the Emotion Reading 2-minute step', () => {
  async function entry(app: App, t: string, content: string) { return (await call(app, 'post', t, '/journal', { content })).body.data.id as string; }
  it('needs JOURNAL_AI_SHARING for the reading and for adding the step; the model is not called without it', async () => {
    const glm = fakeGlm(READING('tired'));
    const app = makeApp({ glm });
    const u = await register(app);
    const id = await entry(app, u.accessToken, 'I am so tired today');
    const a = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I am so tired today', entryId: id });
    expect(a.status).toBe(403); expect(a.body.error.details.consentType).toBe('JOURNAL_AI_SHARING');
    const b = await call(app, 'post', u.accessToken, `/journal/${id}/kaizen-step`);
    expect(b.status).toBe(403);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING'); // the other consent does not unlock it
    expect((await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'x tired', entryId: id })).status).toBe(403);
    expect(glm.calls.length).toBe(0);
  });

  it('saves the reading with the entry, maps feeling words to a step, and adds it as today\'s Kaizen step that counts for the garden', async () => {
    const glm = fakeGlm(READING('tired'));
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const id = await entry(app, u.accessToken, 'I am so tired and drained today');
    const r = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I am so tired and drained today', entryId: id });
    expect(r.body.data).toMatchObject({ crisis: false, ai: true, saved: true, emotions: ['tired'] });
    expect(r.body.data.step).toMatchObject({ actionId: 'SOUNDS', category: 'RELAXATION', minutes: 2, unit: 'minutes', reasonKey: 'journal_step' });
    expect(r.body.data.step.title).toBe('Rest your body for 2 minutes');
    const raw = await db.journalEntry.findUnique({ where: { id } });
    expect(raw!.emotionEncrypted).toBeTruthy(); expect(raw!.emotionEncrypted).not.toContain('tired');
    const got = await call(app, 'get', u.accessToken, `/journal/${id}`);
    expect(got.body.data.reading).toMatchObject({ emotions: ['tired'], step: { category: 'RELAXATION', minutes: 2 } });
    const flowers = (await call(app, 'get', u.accessToken, '/kaizen/garden')).body.data.total;
    const add = await call(app, 'post', u.accessToken, `/journal/${id}/kaizen-step`);
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ added: true, skipped: null, action: { source: 'JOURNAL', status: 'PLANNED', targetValue: 2, unit: 'minutes' } });
    expect((await call(app, 'post', u.accessToken, `/journal/${id}/kaizen-step`)).body.data.added).toBe(false); // idempotent
    const today = await call(app, 'get', u.accessToken, '/kaizen/today');
    expect(today.body.data.extras.map((e: any) => e.id)).toContain(add.body.data.action.id);
    await call(app, 'post', u.accessToken, `/kaizen/actions/${add.body.data.action.id}/complete`, { level: 'FULL' }).expect(200);
    expect((await call(app, 'get', u.accessToken, '/kaizen/garden')).body.data.total).toBe(flowers + 1);
  });

  it.each([['anxious', 'BREATHING'], ['angry', 'BREATHING'], ['grateful', 'GRATITUDE_NOTE']])('feeling word %s -> %s', async (word, actionId) => {
    const app = makeApp({ glm: fakeGlm(READING(word)) });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const r = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: `I feel ${word} today` });
    expect(r.body.data.step.actionId).toBe(actionId);
    expect(r.body.data.saved).toBe(false); // no entryId: nothing saved
  });

  it('when the model fails the offline word list still gives a step (ai:false)', async () => {
    const app = makeApp({ glm: fakeGlm(new Error('down')) });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const r = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I feel anxious and worried' });
    expect(r.body.data.ai).toBe(false);
    expect(r.body.data.step).toMatchObject({ actionId: 'BREATHING' });
  });

  it('text that raised a safety level gets no step at all, and adding one is refused', async () => {
    const app = makeApp({ glm: fakeGlm(READING('hopeless')) });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const text = 'I feel hopeless and empty';
    const id = await entry(app, u.accessToken, text);
    const r = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text, entryId: id });
    expect(r.body.data.step).toBeNull();
    expect((await call(app, 'post', u.accessToken, `/journal/${id}/kaizen-step`)).status).toBe(404);
    // high risk: crisis support, nothing derived
    const hi = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I want to kill myself' });
    expect(hi.body.data.crisis).toBe(true); expect(hi.body.data.step).toBeUndefined();
  });

  it('risk signals in the person\'s recent history skip the step even for a harmless entry', async () => {
    const app = makeApp({ glm: fakeGlm(READING('tired')) });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const id = await entry(app, u.accessToken, 'I am so tired today');
    await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I am so tired today', entryId: id });
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const add = await call(app, 'post', u.accessToken, `/journal/${id}/kaizen-step`);
    expect(add.body.data).toMatchObject({ added: false, skipped: 'RISK', action: null });
    expect(await db.kaizenAction.count({ where: { userId: u.userId } })).toBe(0);
  });
});

describe('Sleep -> today', () => {
  const lowNight = (userId: string) => db.sleepEntry.create({ data: { userId, date: localDate('UTC'), bedtime: '01:30', wakeTime: '06:00', durationMin: 270, latencyMin: 30, awakenings: 3, rested: 3, score: 38 } });
  async function withGoal(userId: string) {
    const g = await db.kaizenGoal.create({ data: { userId, title: 'Calm', category: 'BREATHING', status: 'ACTIVE', currentTarget: 6 } });
    return g;
  }
  it('a short night shrinks today\'s step once (not the goal), marks the day light and says why', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'en' });
    const g = await withGoal(u.userId);
    await lowNight(u.userId);
    const t = await call(app, 'get', u.accessToken, '/kaizen/today');
    expect(t.body.data.action).toMatchObject({ targetValue: 4, adapted: 'SLEEP_LOW' });
    expect(t.body.data.action.title).toContain('4');
    expect(t.body.data).toMatchObject({ lightDay: true, reason: "Last night's sleep was short, so today is lighter." });
    const again = await call(app, 'get', u.accessToken, '/kaizen/today');
    expect(again.body.data.action.targetValue).toBe(4); // applied once
    expect((await db.kaizenGoal.findUnique({ where: { id: g.id } }))!.currentTarget).toBe(6);
    const feed = (await call(app, 'get', u.accessToken, '/today/feed')).body.data;
    expect(feed.lightDay).toBe(true);
    expect(feed.plan.reason).toBe("Last night's sleep was short, so today is lighter.");
    expect(feed.plan.focus).toContain('4');
    const heavy = /^(nudge:(WEEKLY_REVIEW|MORNING_PLAN)|suggestion:(WALK_10|KAIZEN_STEP|THOUGHT_RECORD|REACH_OUT))/;
    const firstHeavy = feed.order.findIndex((k: string) => heavy.test(k));
    // on a light day every light card comes before the first heavy one
    const lightAfterHeavy = firstHeavy < 0 ? [] : feed.order.slice(firstHeavy).filter((k: string) => !heavy.test(k));
    expect(lightAfterHeavy).toEqual([]);
    expect(feed.order[0]).toBe('plan');
  });
  it('a normal night changes nothing; so does a night when risk signals are present (no adaptation, no task)', async () => {
    const app = makeApp();
    const u = await register(app);
    await withGoal(u.userId);
    await db.sleepEntry.create({ data: { userId: u.userId, date: localDate('UTC'), bedtime: '23:00', wakeTime: '07:00', durationMin: 480, latencyMin: 10, awakenings: 0, rested: 8, score: 88 } });
    const t = await call(app, 'get', u.accessToken, '/kaizen/today');
    expect(t.body.data).toMatchObject({ lightDay: false, reason: null }); expect(t.body.data.action.targetValue).toBe(6); expect(t.body.data.action.adapted).toBeNull();
    const v = await register(app);
    await withGoal(v.userId); await lowNight(v.userId);
    await call(app, 'get', v.accessToken, '/kaizen/today'); // creates the step (adapted)
    const w = await register(app);
    await withGoal(w.userId); await lowNight(w.userId);
    await db.safetyEvent.create({ data: { userId: w.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const f = (await call(app, 'get', w.accessToken, '/today/feed')).body.data;
    expect(f.lightDay).toBe(false); expect(f.plan.focus).toBeNull();
  });
  it('lower-than-own-median sleep also counts (needs 5 earlier nights)', async () => {
    const app = makeApp();
    const u = await register(app);
    await withGoal(u.userId);
    const today = localDate('UTC');
    for (let i = 1; i <= 6; i++) await db.sleepEntry.create({ data: { userId: u.userId, date: addDays(today, -i), bedtime: '23:00', wakeTime: '07:30', durationMin: 510, latencyMin: 10, awakenings: 0, rested: 8, score: 90 } });
    await db.sleepEntry.create({ data: { userId: u.userId, date: today, bedtime: '23:00', wakeTime: '06:30', durationMin: 420, latencyMin: 10, awakenings: 0, rested: 7, score: 80 } }); // 7 h, fine by the book, but 90 min under their own median
    expect((await call(app, 'get', u.accessToken, '/kaizen/today')).body.data.lightDay).toBe(true);
  });
});

describe('Sleep Coach: "add to tonight\'s routine"', () => {
  const diary = (userId: string, over: Record<string, unknown> = {}) => db.sleepEntry.create({ data: { userId, date: localDate('UTC'), bedtime: '23:00', wakeTime: '06:30', durationMin: 450, latencyMin: 15, awakenings: 0, rested: 7, score: 80, ...over } as any });
  it('the coach response carries a rule-based routineStep (also when the model fails); no extra model call', async () => {
    const glm = fakeGlm('Try starting your wind-down a little earlier tonight. A few slow breaths can help too.');
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    await diary(u.userId, { latencyMin: 45 });
    const r = await call(app, 'post', u.accessToken, '/sleep/coach');
    expect(r.body.data).toMatchObject({ ai: true, routineStep: { stepId: 'WRITE_WORRIES', minutes: 5 } });
    expect(glm.calls).toHaveLength(1);
    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const v = await register(bad);
    await grant(bad, v.accessToken, 'WELLNESS_AI_SHARING');
    await diary(v.userId, { awakenings: 3 });
    const f = await call(bad, 'post', v.accessToken, '/sleep/coach');
    expect(f.body.data).toMatchObject({ ai: false, routineStep: { stepId: 'SOUNDS' } });
  });
  it('adds the step to tonight\'s routine (localized label, extra:true), idempotent, removable; steps can be marked done and undone', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'bn' });
    const base = (await call(app, 'get', u.accessToken, '/sleep/routine')).body.data;
    expect(base.steps.map((s: any) => s.id)).toEqual(['breathing', 'reflection', 'audio', 'sleep']);
    expect(base.stepsTotal).toBe(3);
    const add = await call(app, 'post', u.accessToken, '/sleep/routine/steps', { stepId: 'PHONE_AWAY' });
    expect(add.status).toBe(201);
    expect(add.body.data.added).toBe(true);
    const steps = add.body.data.routine.steps;
    expect(steps[0]).toMatchObject({ id: 'PHONE_AWAY', extra: true, minutes: 10, done: false });
    expect(steps[0].label).toMatch(/[ঀ-৿]/);
    expect(add.body.data.routine.stepsTotal).toBe(4);
    expect((await call(app, 'post', u.accessToken, '/sleep/routine/steps', { stepId: 'PHONE_AWAY' })).body.data.added).toBe(false);
    expect((await call(app, 'post', u.accessToken, '/sleep/routine/steps', { stepId: 'NOPE' })).status).toBe(400);
    const done = await call(app, 'put', u.accessToken, '/sleep/routine/done/PHONE_AWAY', { done: true });
    expect(done.body.data).toMatchObject({ doneIds: ['PHONE_AWAY'], stepsDone: 1 });
    expect((await call(app, 'put', u.accessToken, '/sleep/routine/done/PHONE_AWAY', { done: false })).body.data.doneIds).toEqual([]);
    expect((await call(app, 'put', u.accessToken, '/sleep/routine/done/ghost', { done: true })).status).toBe(404);
    const gone = await call(app, 'delete', u.accessToken, '/sleep/routine/steps/PHONE_AWAY');
    expect(gone.body.data.steps.map((s: any) => s.id)).toEqual(['breathing', 'reflection', 'audio', 'sleep']);
  });
});

describe('practice completion updates the Garden and, undoably, tonight\'s routine', () => {
  const NEAR_BED = '2026-11-04T22:00:00Z'; // default bedtime 22:30, routine starts 22:05
  it('breathing / sleep sounds inside the wind-down window mark the matching step done; undo works; outside the window nothing is touched', async () => {
    at(NEAR_BED);
    const app = makeApp();
    const u = await register(app);
    const b = await call(app, 'post', u.accessToken, '/practice/breathing', { minutes: 3 });
    expect(b.status).toBe(201);
    expect(b.body.data.kaizen).toMatchObject({ counted: true, flowers: 1 });
    expect(b.body.data.routine).toMatchObject({ stepId: 'breathing', marked: true, undo: { method: 'PUT', path: '/sleep/routine/done/breathing', body: { done: false } } });
    expect((await call(app, 'get', u.accessToken, '/sleep/routine')).body.data.doneIds).toEqual(['breathing']);
    const again = await call(app, 'post', u.accessToken, '/practice/breathing', { minutes: 3 });
    expect(again.body.data.kaizen.counted).toBe(false); expect(again.body.data.routine).toMatchObject({ stepId: 'breathing', marked: false });
    const s1 = await call(app, 'post', u.accessToken, '/practice/sounds', { minutes: 10 });
    expect(s1.body.data.kaizen).toMatchObject({ counted: true, flowers: 2 }); expect(s1.body.data.routine).toBeNull(); // not sleep related
    const s2 = await call(app, 'post', u.accessToken, '/practice/sounds', { minutes: 10, sleepRelated: true });
    expect(s2.body.data.routine).toMatchObject({ stepId: 'audio', marked: true });
    expect((await call(app, 'get', u.accessToken, '/sleep/routine')).body.data.doneIds.sort()).toEqual(['audio', 'breathing']);
    const undo = await call(app, 'put', u.accessToken, b.body.data.routine.undo.path, b.body.data.routine.undo.body);
    expect(undo.body.data.doneIds).toEqual(['audio']);
    const g = await call(app, 'post', u.accessToken, '/practice/grounding', {});
    expect(g.body.data.routine).toBeUndefined(); // grounding does not touch the routine
    // noon: outside the window
    at('2026-11-04T12:00:00Z');
    const noon = await call(app, 'post', u.accessToken, '/practice/breathing', { minutes: 2 });
    expect(noon.body.data.routine).toBeNull();
  });
  it('thought record: offers a short journal summary built from the person\'s own words (no model); none when the text raised a safety level', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'en' });
    const b = { situation: 'Meeting at work', thought: 'I will fail', feeling: 'nervous', alternative: 'I have prepared well', moodBefore: 3, moodAfter: 5 };
    const r = await call(app, 'post', u.accessToken, '/practice/thought-record', b);
    expect(r.status).toBe(201);
    expect(r.body.data.journalOffer.entryType).toBe('DAILY_REFLECTION');
    expect(r.body.data.journalOffer.text).toContain('I will fail'); expect(r.body.data.journalOffer.text).toContain('I have prepared well');
    expect(r.body.data.kaizen.counted).toBe(true);
    expect(glm.calls).toHaveLength(0);
    const hopeless = await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 'Evening', thought: 'I feel hopeless and empty' });
    expect(hopeless.body.data.journalOffer).toBeNull();
    const high = await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 'x', thought: 'I want to kill myself' });
    expect(high.body.data.crisis).toBe(true);
  });
});

describe('Your month: practice block and one next step per pattern', () => {
  async function seedMonth(userId: string) {
    const today = localDate('UTC');
    for (let i = 0; i < 20; i++) {
      const date = addDays(today, -i), v = i % 7;
      await db.checkIn.create({ data: { userId, kind: 'MORNING', mood: 3 + v, stress: 9 - v, energy: 4 + (v % 3), createdAt: new Date(Date.now() - i * 86_400_000) } });
      await db.sleepEntry.create({ data: { userId, date, bedtime: '23:00', wakeTime: '06:30', durationMin: 420, latencyMin: 15, awakenings: 0, rested: 6, score: 40 + 8 * v } });
    }
  }
  const monthly = (app: App, t: string) => call(app, 'get', t, '/insights/monthly?ai=0');
  it('practice counts per kind and the person\'s own before/after mood averages for thought records, no improvement claim', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'en' });
    await seedMonth(u.userId);
    await call(app, 'post', u.accessToken, '/practice/breathing', { minutes: 2 });
    await call(app, 'post', u.accessToken, '/practice/grounding', { minutes: 2 });
    await call(app, 'post', u.accessToken, '/practice/sounds', { minutes: 5 });
    for (const [before, after] of [[3, 5], [4, 8]]) await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 's', thought: 't', moodBefore: before, moodAfter: after });
    await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 's', thought: 't' }); // no mood numbers
    const p = (await monthly(app, u.accessToken)).body.data.practice;
    expect(p.counts).toEqual({ BREATHING: 1, GROUNDING: 1, THOUGHT_RECORD: 1, SOUNDS: 1 }); // one thought-record completion per day
    expect(p.total).toBe(4);
    expect(p.thoughtRecord).toEqual({ count: 3, pairs: 2, avgMoodBefore: 3.5, avgMoodAfter: 6.5 });
    expect(JSON.stringify(p)).not.toMatch(/improv|better|worse|change/i);
    expect(p.line).toBe('You made time for 4 calming practices in this period.');
  });
  it('each pattern card carries ONE rule-based next-step button from the action registry', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'en' });
    await seedMonth(u.userId);
    const d = (await monthly(app, u.accessToken)).body.data;
    expect(d.enough).toBe(true); expect(d.riskMode).toBe(false);
    const sleepCard = d.patterns.find((p: any) => p.type === 'CORRELATION' && [p.a, p.b].includes('sleepScore'));
    expect(sleepCard.nextStep).toMatchObject({ id: 'SLEEP_ROUTINE', cta: "See tonight's routine", surface: 'MONTHLY', deepLink: { route: 'Routine' } });
    expect(sleepCard.text.length).toBeGreaterThan(5);
    const calm = d.patterns.find((p: any) => p.type === 'CORRELATION' && [p.a, p.b].includes('stress') && ![p.a, p.b].includes('sleepScore'));
    if (calm) expect(calm.nextStep).toMatchObject({ id: 'BREATHING' });
    for (const p of d.patterns) expect(p.nextStep === null || typeof p.nextStep.cta === 'string').toBe(true);
  });
  it('a weekday dip offers "Plan a gentle step for {weekday}"', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'en' });
    const today = localDate('UTC');
    for (let i = 0; i < 28; i++) {
      const date = addDays(today, -i), dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      await db.checkIn.create({ data: { userId: u.userId, kind: 'MORNING', mood: dow === 1 ? 2 : 7, stress: 4, energy: 5, createdAt: new Date(`${date}T08:00:00Z`) } });
    }
    const d = (await call(app, 'get', u.accessToken, '/insights/monthly?ai=0&days=30')).body.data;
    const w = d.patterns.find((p: any) => p.type === 'WEEKDAY_LOW');
    expect(w.weekday).toBe('Monday');
    expect(w.nextStep).toMatchObject({ id: 'KAIZEN_STEP', cta: 'Plan a gentle step for Monday', deepLink: { route: 'Tabs', params: { screen: 'KaizenTab', weekday: 1 } } });
  });
  it('no next step with risk signals or suggestion level NEVER', async () => {
    const app = makeApp();
    const u = await register(app);
    await seedMonth(u.userId);
    await call(app, 'put', u.accessToken, '/me/ai-settings', { suggestionLevel: 'NEVER' });
    const a = (await monthly(app, u.accessToken)).body.data;
    expect(a.patterns.length).toBeGreaterThan(0); expect(a.patterns.every((p: any) => p.nextStep === null)).toBe(true);
    const v = await register(app);
    await seedMonth(v.userId);
    await db.safetyEvent.create({ data: { userId: v.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const b = (await monthly(app, v.accessToken)).body.data;
    expect(b.riskMode).toBe(true); expect(b.patterns.every((p: any) => p.nextStep === null)).toBe(true);
  });
});

describe('opt-in anonymous AI events', () => {
  const events = (names: string[]) => db.analyticsEvent.findMany({ where: { name: { in: names } }, orderBy: { createdAt: 'asc' } });
  it('nothing is written unless the person opted in; then only codes (kind, surface, feature, latency bucket), never text or ids', async () => {
    const glm = fakeGlm(JSON.stringify({ headline: 'A calm week.', text: 'One. Two. Three. Four.' }));
    const app = makeApp({ glm });
    const quiet = await register(app);
    await grant(app, quiet.accessToken, 'WELLNESS_AI_SHARING');
    const today = localDate('UTC');
    const twoDays = async (u: string) => { await db.checkIn.create({ data: { userId: u, kind: 'MORNING', mood: 5, stress: 5, energy: 5 } }); for (const d of [today, addDays(today, -1)]) await db.sleepEntry.create({ data: { userId: u, date: d, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, latencyMin: 10, awakenings: 0, rested: 7, score: 80 } }); };
    await twoDays(quiet.userId);
    const before = await db.analyticsEvent.count();
    await call(app, 'post', quiet.accessToken, '/reports/weekly');
    await new Promise((r) => setTimeout(r, 150));
    expect(await db.analyticsEvent.count()).toBe(before);

    const open = await register(app);
    await grant(app, open.accessToken, 'WELLNESS_AI_SHARING');
    await call(app, 'put', open.accessToken, '/me/ai-settings', { analyticsOptIn: true });
    await twoDays(open.userId);
    await call(app, 'post', open.accessToken, '/reports/weekly'); // 'One. Two. Three. Four.' is a valid body: ai true
    await call(app, 'post', open.accessToken, '/actions/BREATHING/outcome', { outcome: 'ACCEPTED', surface: 'TODAY' });
    await call(app, 'post', open.accessToken, '/actions/SOUNDS/outcome', { outcome: 'DISMISSED', surface: 'TODAY' });
    await vi.waitFor(async () => expect((await events(['model_call', 'action_accepted', 'action_dismissed'])).length).toBeGreaterThanOrEqual(3));
    const all = await events(['model_call', 'action_accepted', 'action_dismissed', 'fallback_used']);
    const byName = Object.fromEntries(all.map((e) => [e.name, e.propsJson]));
    expect(byName.model_call).toMatchObject({ feature: 'weekly_report' });
    expect(['lt1s', '1to3s', '3to6s', 'gt6s']).toContain((byName.model_call as any).bucket);
    expect(byName.action_accepted).toEqual({ kind: 'BREATHING', surface: 'TODAY' });
    expect(byName.action_dismissed).toEqual({ kind: 'SOUNDS', surface: 'TODAY' });
    for (const e of all) { expect(e.anonId).not.toContain(open.userId); expect(JSON.stringify(e.propsJson)).not.toMatch(/calm|One\./); }
    expect(all.some((e) => e.name === 'fallback_used')).toBe(false); // no fallback happened
  });
  it('records which feature fell back to a template', async () => {
    const app = makeApp({ glm: fakeGlm(new Error('down')) });
    const u = await register(app);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    await call(app, 'put', u.accessToken, '/me/ai-settings', { analyticsOptIn: true });
    const today = localDate('UTC');
    await db.checkIn.create({ data: { userId: u.userId, kind: 'MORNING', mood: 5, stress: 5, energy: 5 } });
    for (const d of [today, addDays(today, -1)]) await db.sleepEntry.create({ data: { userId: u.userId, date: d, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, latencyMin: 10, awakenings: 0, rested: 7, score: 80 } });
    await call(app, 'post', u.accessToken, '/reports/weekly');
    await vi.waitFor(async () => expect((await db.analyticsEvent.count({ where: { name: 'fallback_used' } })) > 0).toBe(true));
    const fb = await db.analyticsEvent.findFirst({ where: { name: 'fallback_used' }, orderBy: { createdAt: 'desc' } });
    expect(fb!.propsJson).toEqual({ feature: 'weekly_report' });
  });
});
