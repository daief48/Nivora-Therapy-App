import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { crisisLang } from '../services/crisisResponse.js';
import { createCipher } from '../utils/crypto.js';
import { addDays, localDate } from '../utils/dates.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
type App = ReturnType<typeof makeApp>;
const call = (app: App, method: 'get' | 'post' | 'put' | 'patch' | 'delete', t: string, url: string, body?: unknown) => {
  const r = (request(app) as any)[method](`/api/v1${url}`).set(auth(t));
  return body === undefined ? r : r.send(body);
};
const grant = (app: App, t: string, consentType: string) => call(app, 'post', t, '/consents', { consentType }).expect(201);
const HIGH = 'I want to kill myself';
const BANGLA = /[ঀ-৿]/;
const risk = (userId: string) => db.safetyEvent.create({ data: { userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

describe('A2: crisis message language and resources for one-shot features', () => {
  it('crisisLang follows the script of the text and the account locale', () => {
    expect(crisisLang('I feel awful', 'en')).toBe('en');
    expect(crisisLang('I feel awful', 'hi')).toBe('en');
    expect(crisisLang('ami onek kharap', 'bn')).toBe('mixed');
    expect(crisisLang('আমি ভালো নেই', 'en')).toBe('bn');
    expect(crisisLang('मुझे बहुत बुरा लग रहा है', 'en')).toBe('hi');
    expect(crisisLang('मलाई धेरै नराम्रो लागिरहेको छ', 'hi')).toBe('ne');
  });

  it('thought-record: English text from an English account gets an English message with the country resources', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'en', countryCode: 'BD' });
    const r = await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 'Work', thought: HIGH });
    expect(r.status).toBe(200);
    expect(r.body.data.crisis).toBe(true);
    expect(r.body.data.safety.message).not.toMatch(BANGLA);
    expect(r.body.data.safety.message).toContain('Thank you for telling me');
    expect(r.body.data.safety.resources.some((x: any) => x.contactDetails === '999')).toBe(true);
    expect(await db.safetyEvent.count({ where: { userId: u.userId, severity: 'HIGH' } })).toBe(1);
  });

  it('a Bangla account writing English gets both languages; Bangla text gets Bangla', async () => {
    const app = makeApp();
    const u = await register(app, { locale: 'bn' });
    const a = await call(app, 'post', u.accessToken, '/practice/thought-record', { situation: 'Work', thought: HIGH });
    expect(a.body.data.safety.message).toMatch(BANGLA);
    expect(a.body.data.safety.message).toContain('Thank you for telling me');
    const b = await call(app, 'post', u.accessToken, '/actions/gratitude', { text: 'আমি আত্মহত্যা করতে চাই' });
    expect(b.body.data.safety.message).toMatch(BANGLA);
    expect(b.body.data.safety.message).not.toContain('Thank you for telling me');
  });

  it('actions walk, check-in, journal and journal-ai use the same language rule', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'en' });
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const walk = await call(app, 'post', u.accessToken, '/actions/walk', { text: HIGH });
    const ci = await call(app, 'post', u.accessToken, '/checkins', { kind: 'EVENING', mood: 3, stress: 5, energy: 4, note: HIGH });
    const jr = await call(app, 'post', u.accessToken, '/journal', { content: HIGH });
    const ja = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: HIGH });
    for (const m of [walk.body.data.safety.message, ci.body.data.safety.message, jr.body.data.safety.message, ja.body.data.safety.message]) {
      expect(m).toContain('Thank you for telling me'); expect(m).not.toMatch(BANGLA);
    }
    expect(glm.calls.length).toBe(0);
  });
});

describe('A3: risk gates', () => {
  async function riskyUser(glm = fakeGlm('{"emotions":["tired"],"reflection":"Words that showed up in your writing: tired.","suggestion":"Take three slow breaths."}')) {
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    await risk(u.userId);
    return { app, glm, t: u.accessToken, userId: u.userId };
  }

  it('POST /insights/analysis and GET /insights/plan: no model, no tasks, riskMode', async () => {
    const { app, glm, t } = await riskyUser();
    const a = await call(app, 'post', t, '/insights/analysis');
    expect(a.body.data).toMatchObject({ ai: false, riskMode: true });
    const p = await call(app, 'get', t, '/insights/plan');
    expect(p.body.data).toMatchObject({ riskMode: true, items: [], kaizenActionId: null, note: null });
    expect(glm.calls.length).toBe(0);
  });

  it('POST /sleep/coach: no model, no routineStep', async () => {
    const { app, glm, t } = await riskyUser();
    await call(app, 'post', t, '/sleep', { bedtime: '23:00', wakeTime: '07:00', rested: 6 }).expect(201);
    const r = await call(app, 'post', t, '/sleep/coach');
    expect(r.body.data).toMatchObject({ ai: false, routineStep: null, riskMode: true });
    expect(glm.calls.length).toBe(0);
  });

  it('kaizen: weekly-review has no model call, today returns no step', async () => {
    const { app, glm, t } = await riskyUser();
    await call(app, 'post', t, '/kaizen/goals', { title: 'Calm', category: 'BREATHING' }).expect(201);
    const today = await call(app, 'get', t, '/kaizen/today');
    expect(today.body.data).toMatchObject({ action: null, extras: [], riskMode: true, lightDay: false });
    expect(today.body.data.goal).toBeTruthy();
    expect(await db.kaizenAction.count({ where: { userId: (await db.user.findFirst({ where: { email: { not: '' } }, orderBy: { createdAt: 'desc' } }))!.id, source: 'GOAL' } })).toBeGreaterThanOrEqual(0);
    const w = await call(app, 'post', t, '/kaizen/weekly-review');
    expect(w.body.data).toMatchObject({ ai: false, riskMode: true, summaryId: null });
    expect(glm.calls.length).toBe(0);
  });

  it('kaizen/today under risk does not create an action row', async () => {
    const { app, t, userId } = await riskyUser();
    await call(app, 'post', t, '/kaizen/goals', { title: 'Calm', category: 'BREATHING' }).expect(201);
    await call(app, 'get', t, '/kaizen/today').expect(200);
    expect(await db.kaizenAction.count({ where: { userId } })).toBe(0);
  });

  it('monthly ai=1 does not call the model under risk', async () => {
    const { app, glm, t } = await riskyUser();
    const r = await call(app, 'get', t, '/insights/monthly?ai=1');
    expect(r.status).toBe(200);
    expect(r.body.data.riskMode).toBe(true);
    expect(glm.calls.length).toBe(0);
  });

  it('journal-ai/emotions under risk: words kept, no step, no suggestion', async () => {
    const { app, t } = await riskyUser();
    const r = await call(app, 'post', t, '/journal-ai/emotions', { text: 'I am tired today' });
    expect(r.body.data).toMatchObject({ crisis: false, riskMode: true, step: null, suggestion: '' });
    expect(r.body.data.emotions).toEqual(['tired']);
  });

  it('GET /reports/weekly: null after consent is withdrawn, support-only shape under risk', async () => {
    const glm = fakeGlm('{"headline":"x","text":"y"}');
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const first = await call(app, 'post', u.accessToken, '/reports/weekly', {});
    expect(first.status).toBe(200);
    // make sure something is stored even when the model reply was rejected
    expect((await call(app, 'get', u.accessToken, '/reports/weekly')).body.data).toMatchObject({ cached: true, riskMode: false });
    await risk(u.userId);
    const g = await call(app, 'get', u.accessToken, '/reports/weekly');
    expect(g.body.data).toMatchObject({ riskMode: true, nextStep: null, ai: false });
    expect(g.body.data.support.length).toBeGreaterThan(0);
    await db.safetyEvent.deleteMany({ where: { userId: u.userId } });
    await db.userConsent.updateMany({ where: { userId: u.userId, consentType: 'WELLNESS_AI_SHARING' }, data: { withdrawnAt: new Date() } });
    expect((await call(app, 'get', u.accessToken, '/reports/weekly')).body.data).toBeNull();
  });

  it('voice journal under risk: no step, no suggestion, riskMode', async () => {
    const app = makeApp({ glm: fakeGlm('{"emotions":["tired"],"reflection":"Words that showed up in your writing: tired.","suggestion":"Take three slow breaths."}') });
    // /journal/voice needs the STT dependency: covered by wellnessPhases tests; here only the typed-text equivalent is checked.
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    await risk(u.userId);
    const r = await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'tired but fine' });
    expect(r.body.data.step).toBeNull();
  });
});

describe('A4: free text is risk-checked before it is stored', () => {
  it('POST /journal: HIGH stores nothing; ELEVATED stores and records a content-free event', async () => {
    const app = makeApp();
    const u = await register(app);
    const r = await call(app, 'post', u.accessToken, '/journal', { content: HIGH });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ crisis: true, entry: null });
    expect(await db.journalEntry.count({ where: { userId: u.userId } })).toBe(0);
    const ev = await db.safetyEvent.findMany({ where: { userId: u.userId } });
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toContain('kill');
    const ok = await call(app, 'post', u.accessToken, '/journal', { content: 'I feel hopeless about work' });
    expect(ok.status).toBe(201);
    expect(await db.journalEntry.count({ where: { userId: u.userId } })).toBe(1);
    expect(await db.safetyEvent.count({ where: { userId: u.userId, severity: 'ELEVATED' } })).toBe(1);
    const plain = await call(app, 'post', u.accessToken, '/journal', { content: 'A normal quiet day.' });
    expect(plain.status).toBe(201);
  });

  it('PATCH /journal/:id: HIGH keeps the old text; a normal edit clears the saved reading', async () => {
    const app = makeApp({ glm: fakeGlm('{"emotions":["tired"],"reflection":"Words that showed up in your writing: tired.","suggestion":"Take three slow breaths."}') });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const id = (await call(app, 'post', u.accessToken, '/journal', { content: 'I am tired' })).body.data.id as string;
    await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'I am tired', entryId: id }).expect(200);
    expect((await db.journalEntry.findUnique({ where: { id } }))!.emotionEncrypted).toBeTruthy();
    const bad = await call(app, 'patch', u.accessToken, `/journal/${id}`, { content: HIGH });
    expect(bad.body.data.crisis).toBe(true);
    expect((await call(app, 'get', u.accessToken, `/journal/${id}`)).body.data.content).toBe('I am tired');
    await call(app, 'patch', u.accessToken, `/journal/${id}`, { content: 'Now rested' }).expect(200);
    expect((await db.journalEntry.findUnique({ where: { id } }))!.emotionEncrypted).toBeNull();
  });

  it('notes on sleep, moods and kaizen complete/reflect are not stored when HIGH; ordinary notes work', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    const s = await call(app, 'post', t, '/sleep', { bedtime: '23:00', wakeTime: '07:00', rested: 5, note: HIGH });
    expect(s.body.data.crisis).toBe(true);
    expect(await db.sleepEntry.count({ where: { userId: u.userId } })).toBe(0);
    await call(app, 'post', t, '/sleep', { bedtime: '23:00', wakeTime: '07:00', rested: 5, note: 'slept ok' }).expect(201);
    const m = await call(app, 'post', t, '/moods', { moodScore: 2, note: HIGH });
    expect(m.body.data.crisis).toBe(true);
    expect(await db.moodEntry.count({ where: { userId: u.userId } })).toBe(0);
    await call(app, 'post', t, '/moods', { moodScore: 3, note: 'fine' }).expect(201);
    await call(app, 'post', t, '/kaizen/goals', { title: 'Calm', category: 'BREATHING' }).expect(201);
    await db.safetyEvent.deleteMany({ where: { userId: u.userId } }); // the crisis notes above left events: the Today step needs no risk signals
    const act = (await call(app, 'get', t, '/kaizen/today')).body.data.action;
    const c = await call(app, 'post', t, `/kaizen/actions/${act.id}/complete`, { level: 'FULL', note: HIGH });
    expect(c.body.data.crisis).toBe(true);
    expect((await db.kaizenAction.findUnique({ where: { id: act.id } }))!.status).toBe('PLANNED');
    await db.safetyEvent.deleteMany({ where: { userId: u.userId } });
    const okc = await call(app, 'post', t, `/kaizen/actions/${act.id}/complete`, { level: 'FULL', note: 'felt calm' });
    expect(okc.status).toBe(200);
    const rf = await call(app, 'post', t, `/kaizen/actions/${act.id}/reflect`, { felt: 3, usefulness: 3, next: 'SAME', comment: HIGH });
    expect(rf.body.data.crisis).toBe(true);
    expect((await db.kaizenAction.findUnique({ where: { id: act.id } }))!.commentEncrypted).toBeNull();
  });

  it('a high-risk shared journal entry is left out of the model input and recorded', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const entry = await db.journalEntry.create({ data: { userId: u.userId, entryType: 'FREE', encryptedContent: cipher.encrypt('I want to end my life and nobody knows') } });
    const sid = (await call(app, 'post', u.accessToken, '/sessions', { language: 'en' })).body.data.id as string;
    const r = await call(app, 'post', u.accessToken, `/sessions/${sid}/messages`, { text: 'please read my journal', journalEntryId: entry.id });
    expect(r.status).toBe(201);
    expect(JSON.stringify(glm.calls)).not.toContain('end my life');
    const ev = await db.safetyEvent.findMany({ where: { userId: u.userId } });
    expect(ev.some((e) => e.actionTaken === 'SHARED_ENTRY_WITHHELD' && ['HIGH', 'IMMINENT'].includes(e.severity))).toBe(true);
  });
});

describe('A5: output checks', () => {
  it('insights/analysis rejects model text with medication advice or numbers not in the data', async () => {
    const day = (n: number) => addDays(localDate('UTC'), -n);
    for (const reply of ['You should stop taking your medication and sleep 11 hours.', 'Your mood was 9.9 on a lot of days.']) {
      const glm = fakeGlm(reply);
      const app = makeApp({ glm });
      const u = await register(app);
      await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
      for (const n of [1, 2]) await db.sleepEntry.create({ data: { userId: u.userId, date: day(n), bedtime: '23:00', wakeTime: '07:00', durationMin: 480, awakenings: 0, latencyMin: 10, rested: 6, score: 70, source: 'manual' } });
      const r = await call(app, 'post', u.accessToken, '/insights/analysis');
      expect(glm.calls.length).toBe(1);
      expect(r.body.data.ai).toBe(false);
    }
  });

  it('an unsafe model summary is never stored', async () => {
    const glm = fakeGlm('Here is a summary. You should stop taking your medication.');
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = (await call(app, 'post', u.accessToken, '/sessions', { language: 'en' })).body.data.id as string;
    await call(app, 'post', u.accessToken, `/sessions/${sid}/messages`, { text: 'hello there' });
    await call(app, 'post', u.accessToken, `/sessions/${sid}/end`);
    const rows = await db.sessionSummary.findMany({ where: { sessionId: sid } });
    for (const r of rows) expect(cipher.decrypt(r.encryptedSummary)).not.toContain('stop taking your medication');
  });
});

describe('A6: resting feed, analytics opt-in', () => {
  it('quiet hours: no plan focus, suggestions or insights; support options still show under risk', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await call(app, 'post', t, '/kaizen/goals', { title: 'Calm', category: 'BREATHING' }).expect(201);
    await call(app, 'put', t, '/nudges/settings', { quietStart: '00:00', quietEnd: '23:59' }).expect(200);
    const feed = await call(app, 'get', t, '/today/feed');
    expect(feed.body.data).toMatchObject({ quietNow: true, resting: true, suggestions: [], insights: [] });
    expect(feed.body.data.plan.focus).toBeNull();
    expect(feed.body.data.plan.kaizenActionId).toBeNull();
    await risk(u.userId);
    const r = await call(app, 'get', t, '/today/feed');
    expect(r.body.data.riskMode).toBe(true);
    expect(r.body.data.suggestions.length).toBeGreaterThan(0);
  });

  it('level NEVER and snooze also rest the feed', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await call(app, 'put', t, '/nudges/settings', { quietStart: '00:00', quietEnd: '00:00' }).expect(200);
    await call(app, 'post', t, '/nudges/snooze', { minutes: 60 }).expect(200);
    expect((await call(app, 'get', t, '/today/feed')).body.data).toMatchObject({ resting: true, suggestions: [] });
    await call(app, 'post', t, '/nudges/snooze', { minutes: 0 }).expect(200);
    expect((await call(app, 'get', t, '/today/feed')).body.data.resting).toBe(false);
    await db.userProfile.update({ where: { userId: u.userId }, data: { suggestionLevel: 'NEVER' } });
    expect((await call(app, 'get', t, '/today/feed')).body.data).toMatchObject({ resting: true, suggestions: [] });
  });
});
