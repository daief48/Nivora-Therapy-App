import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACTION_COPY, REASONS, WEEKDAY_NAMES } from '../services/actionCopy.js';
import {
  ACTION_IDS, ACTIONS, buildMenu, createMarkerFilter, extractAction, inferTags, isTiny, KAIZEN_FOR_ACTION, menuPromptBlock, NEW_ROUTES, recordOffer, setOutcome, stepForFeelings,
  validateChoice, type ActionDef,
} from '../services/actionMenu.js';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const deps = { db, cipher };
const EVENING = new Date('2026-11-04T20:00:00Z'); // user timezone is UTC in tests
const MORNING = new Date('2026-11-04T08:00:00Z');
const setLevel = (userId: string, suggestionLevel: string) => db.userProfile.update({ where: { userId }, data: { suggestionLevel } });
const KNOWN_ROUTES = new Set(['Exercise', 'JournalEdit', 'Routine', 'Tabs', 'Sounds', 'SafetyPlan', 'Emergency', ...NEW_ROUTES]);

describe('action registry', () => {
  it('has every required action, a known route for each, and copy in en, bn, hi and ne', () => {
    for (const id of ['BREATHING', 'GROUNDING', 'THOUGHT_RECORD', 'JOURNAL_TEXT', 'JOURNAL_VOICE', 'GRATITUDE_NOTE', 'SLEEP_ROUTINE', 'KAIZEN_STEP', 'WALK_10', 'SOUNDS', 'REACH_OUT', 'SAFETY_PLAN', 'EMERGENCY']) expect(ACTION_IDS).toContain(id);
    for (const a of ACTIONS) {
      expect(KNOWN_ROUTES.has(a.deepLink.route), a.id).toBe(true);
      expect(a.titleKey).toBe(`action.${a.id}.title`);
      const c = ACTION_COPY[a.id]!;
      for (const l of ['en', 'bn', 'hi', 'ne'] as const) { expect(c.title[l]?.length, `${a.id} title ${l}`).toBeGreaterThan(2); expect(c.why[l]?.length, `${a.id} why ${l}`).toBeGreaterThan(5); }
    }
    for (const [k, v] of Object.entries(REASONS)) for (const l of ['en', 'bn', 'hi', 'ne'] as const) expect(v[l]?.length, `reason ${k} ${l}`).toBeGreaterThan(5);
    for (const l of ['en', 'bn', 'hi', 'ne'] as const) expect(WEEKDAY_NAMES[l]).toHaveLength(7);
  });
  it('reasons never carry numbers or scores', () => {
    for (const [k, v] of Object.entries(REASONS)) for (const l of ['en', 'bn', 'hi', 'ne'] as const) expect(/\d/.test(v[l]), `${k} ${l}`).toBe(false);
  });
  it('tiny = 5 minutes or less and savable to Kaizen; crisis actions are never saved', () => {
    expect(ACTIONS.filter(isTiny).map((a) => a.id)).toContain('BREATHING');
    expect(isTiny(ACTIONS.find((a) => a.id === 'WALK_10')!)).toBe(false);
    for (const a of ACTIONS.filter((x) => x.crisis)) expect(KAIZEN_FOR_ACTION[a.id]).toBeUndefined();
  });
});

describe('rules from words', () => {
  it('infers tags from English, Bangla, Hindi and Nepali wording', () => {
    expect(inferTags("I can't sleep at all")).toContain('sleep');
    expect(inferTags('my thoughts keep going round and round')).toContain('looping');
    expect(inferTags('I feel so lonely lately')).toContain('loneliness');
    expect(inferTags('রাতে ঘুম আসে না')).toContain('sleep');
    expect(inferTags('मुझे बहुत चिंता हो रही है')).toContain('anxiety');
    expect(inferTags('म एक्लो महसुस गर्छु')).toContain('loneliness');
    expect(inferTags('hello there')).toEqual([]);
  });
  it('maps feeling words to a menu action and a Kaizen category', () => {
    expect(stepForFeelings(['tired'])).toMatchObject({ actionId: 'SOUNDS', category: 'RELAXATION' });
    expect(stepForFeelings(['anxious', 'worried'])).toMatchObject({ actionId: 'BREATHING' });
    expect(stepForFeelings(['angry'])).toMatchObject({ actionId: 'BREATHING' });
    expect(stepForFeelings(['grateful'])).toMatchObject({ actionId: 'GRATITUDE_NOTE', category: 'GRATITUDE' });
    expect(stepForFeelings([])).toMatchObject({ category: 'SELF_OBSERVATION' });
  });
});

describe('the [[ACTION:ID]] marker', () => {
  it('is stripped from a finished reply and the id is returned', () => {
    expect(extractAction('If you like, we could try slow breathing.\n[[ACTION:BREATHING]]')).toEqual({ text: 'If you like, we could try slow breathing.', id: 'BREATHING' });
    expect(extractAction('Just listening.')).toEqual({ text: 'Just listening.', id: null });
    expect(extractAction('Hmm.\n[[action: grounding ]]').id).toBe('GROUNDING');
  });
  it('never leaks into a stream, however the chunks are split, and plain brackets pass through', () => {
    const full = 'We could try slow breathing together, if you like. [a note] and [[not ours]]\n[[ACTION:BREATHING]]';
    for (let size = 1; size <= 12; size++) {
      const f = createMarkerFilter();
      let shown = '';
      for (let i = 0; i < full.length; i += size) shown += f.push(full.slice(i, i + size));
      shown += f.end();
      expect(shown.trim(), `chunk ${size}`).toBe('We could try slow breathing together, if you like. [a note] and [[not ours]]');
    }
    const f = createMarkerFilter();
    expect(f.push('see [') + f.push('1] ok') + f.end()).toBe('see [1] ok');
  });
  it('validateChoice only accepts ids that were on this turn\'s menu', () => {
    const items = [{ def: ACTIONS.find((a) => a.id === 'BREATHING')!, reasonKey: 'chat' as const }];
    expect(validateChoice('BREATHING', items)?.def.id).toBe('BREATHING');
    expect(validateChoice('GROUNDING', items)).toBeNull();
    expect(validateChoice('TELEPORT', items)).toBeNull();
    expect(validateChoice(null, items)).toBeNull();
  });
  it('the prompt block lists only the menu, and is empty when there is nothing to offer', () => {
    expect(menuPromptBlock([])).toBe('');
    const b = menuPromptBlock([{ def: ACTIONS.find((a) => a.id === 'SLEEP_ROUTINE')!, reasonKey: 'chat' }]);
    expect(b).toContain('SLEEP_ROUTINE');
    expect(b).not.toContain('BREATHING');
  });
});

describe('buildMenu', () => {
  const app = makeApp();
  it('returns at most 4 actions of different kinds, never crisis actions, for a person with no context', async () => {
    const u = await register(app);
    const m = await buildMenu(deps, u.userId, { surface: 'TODAY', now: MORNING });
    expect(m.riskMode).toBe(false);
    expect(m.items.length).toBeGreaterThan(0);
    expect(m.items.length).toBeLessThanOrEqual(4);
    expect(new Set(m.items.map((i) => i.def.kind)).size).toBe(m.items.length);
    expect(m.items.some((i) => i.def.crisis)).toBe(false);
  });
  it('steers by what the person says and by the time of day (sleep routine only in the evening, in a sleep context)', async () => {
    const u = await register(app);
    const evening = await buildMenu(deps, u.userId, { surface: 'CHAT', text: "I can't sleep, I keep lying awake", now: EVENING });
    expect(evening.items.map((i) => i.def.id)).toContain('SLEEP_ROUTINE');
    expect(evening.items[0]!.reasonKey).toBe('tag_sleep');
    const morning = await buildMenu(deps, u.userId, { surface: 'CHAT', text: "I can't sleep, I keep lying awake", now: MORNING });
    expect(morning.items.map((i) => i.def.id)).not.toContain('SLEEP_ROUTINE');
    const loop = await buildMenu(deps, u.userId, { surface: 'CHAT', text: 'I keep thinking the same thought over and over', now: MORNING });
    expect(loop.items.map((i) => i.def.id)).toContain('THOUGHT_RECORD');
    const anxious = await buildMenu(deps, u.userId, { surface: 'CHAT', text: 'I feel so anxious and panicky', now: MORNING });
    expect(anxious.items.slice(0, 2).map((i) => i.def.kind)).toEqual(expect.arrayContaining(['BREATHING']));
  });
  it('REACH_OUT needs a trusted contact and daytime; KAIZEN_STEP needs an active goal; JOURNAL_VOICE needs voice', async () => {
    const u = await register(app);
    const text = 'I feel lonely and alone, no energy to do anything';
    const base = await buildMenu(deps, u.userId, { surface: 'CHAT', text, now: MORNING, voiceEnabled: false });
    expect(base.items.map((i) => i.def.id)).not.toContain('REACH_OUT');
    expect(base.items.map((i) => i.def.id)).not.toContain('KAIZEN_STEP');
    expect(base.items.map((i) => i.def.id)).not.toContain('JOURNAL_VOICE');
    await db.trustedContact.create({ data: { userId: u.userId, nameEncrypted: cipher.encrypt('Sam'), phoneEncrypted: cipher.encrypt('+8801700000000') } });
    await db.kaizenGoal.create({ data: { userId: u.userId, title: 'Calm', category: 'BREATHING', status: 'ACTIVE' } });
    const m = await buildMenu(deps, u.userId, { surface: 'CHAT', text, now: MORNING, voiceEnabled: true, max: 4 });
    const ids = m.items.map((i) => i.def.id);
    expect(ids).toContain('REACH_OUT');
    const night = await buildMenu(deps, u.userId, { surface: 'CHAT', text, now: new Date('2026-11-04T23:30:00Z') });
    expect(night.items.map((i) => i.def.id)).not.toContain('REACH_OUT'); // not at night
  });
  it('risk signals: only Emergency, Safety plan and a trusted person, whatever the level or the words', async () => {
    const u = await register(app);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const m = await buildMenu(deps, u.userId, { surface: 'CHAT', text: "I can't sleep", now: EVENING });
    expect(m.riskMode).toBe(true);
    expect(m.items.map((i) => i.def.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
    await setLevel(u.userId, 'NEVER');
    expect((await buildMenu(deps, u.userId, { surface: 'TODAY', now: EVENING })).items.map((i) => i.def.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
  });
  it('other risk signals: PHQ-9 item 9 flag, a severe result, an elevated event today, a very low and stressed check-in', async () => {
    const mk = async () => (await register(app)).userId;
    const a = await mk(); await db.safetyEvent.create({ data: { userId: a, severity: 'ELEVATED', category: 'SELF_HARM', actionTaken: 'ASSESSMENT_ITEM9' } });
    expect((await buildMenu(deps, a, { surface: 'TODAY' })).riskMode).toBe(true);
    const b = await mk(); await db.assessment.create({ data: { userId: b, instrument: 'PHQ9', encryptedContent: cipher.encrypt(JSON.stringify({ answers: [], total: 21, severity: 'severe' })) } });
    expect((await buildMenu(deps, b, { surface: 'TODAY' })).riskMode).toBe(true);
    const c = await mk(); await db.safetyEvent.create({ data: { userId: c, severity: 'ELEVATED', category: 'HOPELESSNESS', actionTaken: 'SUPPORT_FOOTER_ADDED' } });
    expect((await buildMenu(deps, c, { surface: 'TODAY' })).riskMode).toBe(true);
    const e = await mk(); await db.checkIn.create({ data: { userId: e, kind: 'MORNING', mood: 1, stress: 10, energy: 2 } });
    expect((await buildMenu(deps, e, { surface: 'TODAY' })).riskMode).toBe(true);
    const f = await mk(); await db.assessment.create({ data: { userId: f, instrument: 'PHQ9', encryptedContent: cipher.encrypt(JSON.stringify({ answers: [], total: 6, severity: 'mild' })) } });
    expect((await buildMenu(deps, f, { surface: 'TODAY' })).riskMode).toBe(false);
  });
  it('suggestion level NEVER means no suggestions; RARELY caps chat offers at one a day', async () => {
    const u = await register(app);
    await setLevel(u.userId, 'NEVER');
    const never = await buildMenu(deps, u.userId, { surface: 'CHAT', now: MORNING });
    expect(never.items).toEqual([]); expect(never.note).toBe('LEVEL_NEVER');
    await setLevel(u.userId, 'RARELY');
    expect((await buildMenu(deps, u.userId, { surface: 'TODAY' })).items.length).toBeLessThanOrEqual(2);
    expect((await buildMenu(deps, u.userId, { surface: 'CHAT' })).items.length).toBeGreaterThan(0);
    await recordOffer(db, u.userId, ACTIONS.find((a) => a.id === 'BREATHING')!, 'CHAT');
    const capped = await buildMenu(deps, u.userId, { surface: 'CHAT' });
    expect(capped.items).toEqual([]); expect(capped.note).toBe('CAP_DAY');
  });
  it('variety: the last 3 shown actions and the previous kind are left out, and the same kind is not offered twice in a row', async () => {
    const u = await register(app);
    const by = (id: string) => ACTIONS.find((a) => a.id === id)!;
    for (const id of ['BREATHING', 'GROUNDING', 'JOURNAL_TEXT']) { await recordOffer(db, u.userId, by(id), 'TODAY'); await new Promise((r) => setTimeout(r, 5)); }
    const m = await buildMenu(deps, u.userId, { surface: 'TODAY', now: MORNING });
    const ids = m.items.map((i) => i.def.id);
    for (const id of ['BREATHING', 'GROUNDING', 'JOURNAL_TEXT']) expect(ids).not.toContain(id);
    expect(m.items.map((i) => i.def.kind)).not.toContain('JOURNAL'); // JOURNAL was the previous kind: JOURNAL_VOICE / GRATITUDE_NOTE are left out too
  });
  it('a kind dismissed or thumbed-down in the last 7 days is excluded; older ones are not', async () => {
    const u = await register(app);
    const by = (id: string) => ACTIONS.find((a) => a.id === id)!;
    const o1 = await recordOffer(db, u.userId, by('SOUNDS'), 'TODAY');
    await setOutcome(db, u.userId, o1, 'DISMISSED');
    const o2 = await recordOffer(db, u.userId, by('THOUGHT_RECORD'), 'CHAT');
    await setOutcome(db, u.userId, o2, 'THUMBS_DOWN');
    // push both out of the "last 3 shown" window so only the 7-day rule is tested
    for (const id of ['KAIZEN_STEP', 'WALK_10', 'SLEEP_ROUTINE']) { await recordOffer(db, u.userId, by(id), 'TODAY'); await new Promise((r) => setTimeout(r, 5)); }
    const m = await buildMenu(deps, u.userId, { surface: 'CHAT', text: 'my thoughts keep going round, I cannot calm down, anxious', now: MORNING });
    expect(m.items.map((i) => i.def.kind)).not.toContain('SOUNDS');
    expect(m.items.map((i) => i.def.kind)).not.toContain('THOUGHT_RECORD');
    await db.actionOffer.updateMany({ where: { userId: u.userId, actionId: { in: ['SOUNDS', 'THOUGHT_RECORD'] } }, data: { createdAt: new Date(Date.now() - 9 * 86_400_000) } });
    const later = await buildMenu(deps, u.userId, { surface: 'CHAT', text: 'my thoughts keep going round, I cannot calm down, anxious', now: MORNING });
    expect(later.items.map((i) => i.def.kind)).toContain('THOUGHT_RECORD');
  });
  it('consent filter: an action that requires a consent is left out without it (injected registry)', async () => {
    const u = await register(app);
    const reg: ActionDef[] = [
      { ...ACTIONS.find((a) => a.id === 'BREATHING')!, requires: { consent: 'JOURNAL_AI_SHARING' } },
      { ...ACTIONS.find((a) => a.id === 'SOUNDS')! },
    ];
    expect((await buildMenu(deps, u.userId, { surface: 'TODAY', now: MORNING }, reg)).items.map((i) => i.def.id)).toEqual(['SOUNDS']);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
    expect((await buildMenu(deps, u.userId, { surface: 'TODAY', now: MORNING }, reg)).items.map((i) => i.def.id)).toContain('BREATHING');
  });
  it('a short last night adds the sleep tag (numbers only)', async () => {
    const u = await register(app);
    const date = new Date(EVENING).toISOString().slice(0, 10);
    await db.sleepEntry.create({ data: { userId: u.userId, date, bedtime: '01:00', wakeTime: '06:00', durationMin: 300, latencyMin: 20, awakenings: 2, rested: 3, score: 40 } });
    const m = await buildMenu(deps, u.userId, { surface: 'TODAY', now: EVENING });
    expect(m.tags).toContain('sleep_short');
    expect(m.items.map((i) => i.def.id)).toContain('SLEEP_ROUTINE');
  });
});
