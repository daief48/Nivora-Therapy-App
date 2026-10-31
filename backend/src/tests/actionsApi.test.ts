import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const glm = fakeGlm();
const app = makeApp({ glm });
const get = (t: string, url: string) => request(app).get(`/api/v1${url}`).set(auth(t));
const post = (t: string, url: string, body: unknown = {}) => request(app).post(`/api/v1${url}`).set(auth(t)).send(body as object);
const put = (t: string, url: string, body: unknown = {}) => request(app).put(`/api/v1${url}`).set(auth(t)).send(body as object);

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

describe('GET /actions/menu', () => {
  it('returns up to 4 localized cards from the registry without recording anything or calling a model', async () => {
    const u = await register(app, { locale: 'bn' });
    const before = glm.calls.length;
    const res = await get(u.accessToken, '/actions/menu?context=TODAY');
    expect(res.status).toBe(200);
    const { actions, riskMode, suggestionLevel } = res.body.data;
    expect(riskMode).toBe(false); expect(suggestionLevel).toBe('SOMETIMES');
    expect(actions.length).toBeGreaterThan(0); expect(actions.length).toBeLessThanOrEqual(4);
    for (const a of actions) {
      expect(a).toMatchObject({ offerId: null, surface: 'TODAY', crisis: false });
      expect(/[ঀ-৿]/.test(a.title), a.id).toBe(true); // Bangla user: ready localized text
      expect(a.reason.length).toBeGreaterThan(3); expect(a.titleKey).toBe(`action.${a.id}.title`); expect(a.deepLink.route).toBeTruthy();
    }
    expect(await db.actionOffer.count({ where: { userId: u.userId } })).toBe(0);
    expect(glm.calls.length).toBe(before);
    expect((await get(u.accessToken, '/actions/menu?context=NOPE')).status).toBe(400);
  });
  it('risk signals: crisis cards only', async () => {
    const u = await register(app);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'IMMINENT', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const res = await get(u.accessToken, '/actions/menu?context=INSIGHTS&tags=sleep');
    expect(res.body.data.riskMode).toBe(true);
    expect(res.body.data.actions.map((a: any) => a.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
    expect(res.body.data.actions.every((a: any) => a.crisis)).toBe(true);
  });
  it('requires sign-in', async () => { expect((await request(app).get('/api/v1/actions/menu')).status).toBe(401); });
});

describe('POST /actions/:id/outcome', () => {
  it('records accepted / dismissed / thumbs on an offer id or on an action id, and rejects unknown ids and outcomes', async () => {
    const u = await register(app);
    const a = await post(u.accessToken, '/actions/BREATHING/outcome', { outcome: 'DISMISSED', surface: 'TODAY' });
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ actionId: 'BREATHING', outcome: 'DISMISSED', kaizen: null });
    const row = await db.actionOffer.findFirst({ where: { userId: u.userId } });
    expect(row).toMatchObject({ kind: 'BREATHING', surface: 'TODAY', outcome: 'DISMISSED' });
    const b = await post(u.accessToken, `/actions/${row!.id}/outcome`, { outcome: 'THUMBS_DOWN' });
    expect(b.body.data.feedback).toBe(-1);
    expect(b.body.data.outcome).toBe('DISMISSED'); // thumbs only set the feedback
    expect((await post(u.accessToken, '/actions/NOPE/outcome', { outcome: 'ACCEPTED' })).status).toBe(404);
    expect((await post(u.accessToken, `/actions/${row!.id}/outcome`, { outcome: 'MAYBE' })).status).toBe(400);
    const other = await register(app);
    expect((await post(other.accessToken, `/actions/${row!.id}/outcome`, { outcome: 'ACCEPTED' })).status).toBe(404); // someone else's offer
  });
  it('a dismissed kind disappears from the next menu (variety ledger)', async () => {
    const u = await register(app);
    await post(u.accessToken, '/actions/SOUNDS/outcome', { outcome: 'DISMISSED' });
    for (const ctx of ['TODAY', 'INSIGHTS']) {
      const m = await get(u.accessToken, `/actions/menu?context=${ctx}&tags=anxiety,sleep,calm`);
      expect(m.body.data.actions.map((x: any) => x.kind)).not.toContain('SOUNDS');
    }
  });
  it('ACCEPTED with saveToKaizen creates ONE planned Kaizen step (idempotent), which counts in the garden once done', async () => {
    const u = await register(app);
    const first = await post(u.accessToken, '/actions/BREATHING/outcome', { outcome: 'ACCEPTED', saveToKaizen: true });
    expect(first.body.data.kaizen).toMatchObject({ status: 'PLANNED', source: 'MENU', targetValue: 2, unit: 'minutes' });
    const again = await post(u.accessToken, '/actions/BREATHING/outcome', { outcome: 'ACCEPTED', saveToKaizen: true });
    expect(again.body.data.kaizen.id).toBe(first.body.data.kaizen.id);
    const before = (await get(u.accessToken, '/kaizen/garden')).body.data.total;
    await post(u.accessToken, `/kaizen/actions/${first.body.data.kaizen.id}/complete`, { level: 'FULL' }).expect(200);
    expect((await get(u.accessToken, '/kaizen/garden')).body.data.total).toBe(before + 1);
    // crisis actions are never saved
    expect((await post(u.accessToken, '/actions/EMERGENCY/outcome', { outcome: 'ACCEPTED', saveToKaizen: true })).body.data.kaizen).toBeNull();
  });
});

describe('WALK_10', () => {
  it('lists localized ideas; a pick or a written idea becomes a Kaizen step that counts for the garden', async () => {
    const u = await register(app, { locale: 'hi' });
    const list = await get(u.accessToken, '/actions/walk');
    expect(list.body.data.choices.length).toBeGreaterThanOrEqual(4);
    expect(/[ऀ-ॿ]/.test(list.body.data.choices[0].label)).toBe(true);
    const res = await post(u.accessToken, '/actions/walk', { choice: 'walk' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ crisis: false, created: true, action: { source: 'WALK', status: 'PLANNED', targetValue: 10, unit: 'minutes' } });
    const flowers = res.body.data.flowers;
    const done = await post(u.accessToken, `/kaizen/actions/${res.body.data.action.id}/complete`, { level: 'FULL' });
    expect(done.status).toBe(200);
    expect((await get(u.accessToken, '/kaizen/garden')).body.data.total).toBe(flowers + 1);
    const today = await get(u.accessToken, '/kaizen/today');
    expect(today.body.data.extras.map((e: any) => e.id)).toContain(res.body.data.action.id);
  });
  it('a written idea replaces the planned one; a finished walk is left alone; needs a pick or text', async () => {
    const u = await register(app);
    const a = await post(u.accessToken, '/actions/walk', { text: 'Water the plants' });
    expect(a.body.data.action.title).toBe('Water the plants');
    const b = await post(u.accessToken, '/actions/walk', { text: 'Call the library', minutes: 15 });
    expect(b.status).toBe(200);
    expect(b.body.data.action).toMatchObject({ id: a.body.data.action.id, title: 'Call the library', targetValue: 15 });
    await post(u.accessToken, `/kaizen/actions/${a.body.data.action.id}/complete`, { level: 'FULL' });
    const c = await post(u.accessToken, '/actions/walk', { text: 'Another' });
    expect(c.body.data).toMatchObject({ alreadyDone: true, action: { title: 'Call the library' } });
    expect((await post(u.accessToken, '/actions/walk', {})).status).toBe(400);
  });
  it('a written idea that is high risk is stored nowhere and gets crisis support', async () => {
    const u = await register(app);
    const res = await post(u.accessToken, '/actions/walk', { text: 'I want to kill myself tonight' });
    expect(res.body.data.crisis).toBe(true);
    expect(await db.kaizenAction.count({ where: { userId: u.userId } })).toBe(0);
    expect(await db.safetyEvent.count({ where: { userId: u.userId, severity: { in: ['HIGH', 'IMMINENT'] } } })).toBe(1);
  });
});

describe('GRATITUDE_NOTE', () => {
  it('is saved as a normal journal entry typed GRATITUDE, encrypted; high-risk text is not stored', async () => {
    const u = await register(app);
    const res = await post(u.accessToken, '/actions/gratitude', { text: 'My neighbour brought tea today' });
    expect(res.status).toBe(201);
    expect(res.body.data.entry).toMatchObject({ entryType: 'GRATITUDE' });
    const raw = await db.journalEntry.findFirst({ where: { userId: u.userId } });
    expect(raw!.encryptedContent).not.toContain('neighbour');
    const list = await get(u.accessToken, '/journal?entryType=GRATITUDE');
    expect(list.body.data[0]).toMatchObject({ entryType: 'GRATITUDE', content: 'My neighbour brought tea today' });
    const bad = await post(u.accessToken, '/actions/gratitude', { text: 'I want to end my life' });
    expect(bad.body.data.crisis).toBe(true);
    expect(await db.journalEntry.count({ where: { userId: u.userId } })).toBe(1);
  });
});

describe('REACH_OUT', () => {
  it('lists trusted contacts with editable drafts in the user\'s language; nothing is sent', async () => {
    const u = await register(app, { locale: 'bn' });
    const none = await get(u.accessToken, '/actions/reach-out');
    expect(none.body.data).toMatchObject({ hasContacts: false, contacts: [], sent: false });
    await db.trustedContact.create({ data: { userId: u.userId, nameEncrypted: cipher.encrypt('রিনা'), phoneEncrypted: cipher.encrypt('+8801711111111'), relation: 'friend' } });
    const res = await get(u.accessToken, '/actions/reach-out');
    const c = res.body.data.contacts[0];
    expect(c).toMatchObject({ name: 'রিনা', phone: '+8801711111111', relation: 'friend' });
    expect(c.drafts.length).toBeGreaterThanOrEqual(2);
    expect(c.drafts[0]).toContain('রিনা'); expect(c.drafts[0]).not.toContain('{name}');
    expect(res.body.data.sent).toBe(false);
    // other people's contacts are not visible
    const other = await register(app);
    expect((await get(other.accessToken, '/actions/reach-out')).body.data.contacts).toEqual([]);
  });
});

describe('session close: ONE tiny action', () => {
  async function endedSession(token: string, lines: string[]) {
    const s = await post(token, '/sessions', { language: 'en' });
    const id = s.body.data.id as string;
    for (const l of lines) await post(token, `/sessions/${id}/messages`, { text: l });
    await post(token, `/sessions/${id}/end`, {});
    return id;
  }
  it('returns a tiny savable card; accepting it saves a Kaizen step', async () => {
    const u = await register(app);
    const sid = await endedSession(u.accessToken, ['I have been so anxious about exams']);
    const res = await post(u.accessToken, '/actions/session-close', { sessionId: sid });
    expect(res.status).toBe(200);
    const { action, prompt, riskMode, saveToKaizenOnAccept } = res.body.data;
    expect(prompt).toBe('What are you taking with you?');
    expect(riskMode).toBe(false); expect(saveToKaizenOnAccept).toBe(true);
    expect(action.minutes).toBeLessThanOrEqual(5); expect(action.surface).toBe('SESSION_CLOSE'); expect(action.offerId).toBeTruthy();
    const acc = await post(u.accessToken, `/actions/${action.offerId}/outcome`, { outcome: 'ACCEPTED', saveToKaizen: true });
    expect(acc.body.data.kaizen).toMatchObject({ source: 'SESSION_CLOSE', status: 'PLANNED' });
    expect(await db.actionOffer.findFirst({ where: { id: action.offerId } })).toMatchObject({ outcome: 'ACCEPTED', surface: 'SESSION_CLOSE', sessionId: sid });
  });
  it('a session that raised a safety level (or any risk signal) gets support options only; level NEVER gets nothing', async () => {
    const u = await register(app);
    const sid = await endedSession(u.accessToken, ['I have been stressed']);
    await db.therapySession.update({ where: { id: sid }, data: { riskFlag: 'HIGH' } });
    const res = await post(u.accessToken, '/actions/session-close', { sessionId: sid });
    expect(res.body.data).toMatchObject({ riskMode: true, action: null });
    expect(res.body.data.support.map((s: any) => s.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
    const v = await register(app);
    const sid2 = await endedSession(v.accessToken, ['I have been stressed']);
    await put(v.accessToken, '/me/ai-settings', { suggestionLevel: 'NEVER' });
    expect((await post(v.accessToken, '/actions/session-close', { sessionId: sid2 })).body.data).toMatchObject({ action: null, riskMode: false });
    expect((await post(v.accessToken, '/actions/session-close', { sessionId: sid })).status).toBe(404); // not their session
  });
});

describe('/me/ai-settings and /privacy/ai-data', () => {
  it('suggestionLevel defaults to SOMETIMES, validates and persists; analytics is opt-in', async () => {
    const u = await register(app);
    expect((await get(u.accessToken, '/me/ai-settings')).body.data).toMatchObject({ suggestionLevel: 'SOMETIMES', analyticsOptIn: false, levels: ['OFTEN', 'SOMETIMES', 'RARELY', 'NEVER'] });
    expect((await put(u.accessToken, '/me/ai-settings', { suggestionLevel: 'RARELY' })).body.data.suggestionLevel).toBe('RARELY');
    expect((await put(u.accessToken, '/me/ai-settings', { analyticsOptIn: true })).body.data).toMatchObject({ suggestionLevel: 'RARELY', analyticsOptIn: true });
    expect((await put(u.accessToken, '/me/ai-settings', { suggestionLevel: 'ALWAYS' })).status).toBe(400);
    expect((await get(u.accessToken, '/me/ai-settings')).body.data.suggestionLevel).toBe('RARELY');
  });
  it('lists which consent covers which data, the current consent state and which features use no model', async () => {
    const u = await register(app);
    const before = (await get(u.accessToken, '/privacy/ai-data')).body.data;
    const j = before.consents.find((c: any) => c.type === 'JOURNAL_AI_SHARING');
    const w = before.consents.find((c: any) => c.type === 'WELLNESS_AI_SHARING');
    expect(j).toMatchObject({ granted: false }); expect(j.covers).toContain('JOURNAL_TEXT'); expect(j.covers).not.toContain('SLEEP_DIARY_NUMBERS');
    expect(w).toMatchObject({ granted: false }); expect(w.covers).toContain('SLEEP_DIARY_NUMBERS'); expect(w.covers).not.toContain('JOURNAL_TEXT');
    expect(before.features.find((f: any) => f.key === 'weekly_report')).toMatchObject({ usesModel: true, consent: 'WELLNESS_AI_SHARING', allowed: false });
    expect(before.features.find((f: any) => f.key === 'action_menu')).toMatchObject({ usesModel: false, allowed: true });
    expect(before.neverSent).toContain('TRUSTED_CONTACTS');
    await post(u.accessToken, '/consents', { consentType: 'WELLNESS_AI_SHARING' });
    const after = (await get(u.accessToken, '/privacy/ai-data')).body.data;
    expect(after.consents.find((c: any) => c.type === 'WELLNESS_AI_SHARING').granted).toBe(true);
    expect(after.consents.find((c: any) => c.type === 'JOURNAL_AI_SHARING').granted).toBe(false);
    expect(after.features.find((f: any) => f.key === 'weekly_report').allowed).toBe(true);
    expect(after.features.find((f: any) => f.key === 'emotion_words').allowed).toBe(false);
  });
});
