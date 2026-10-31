import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyDailyCap, computeTrend, dailyCapFor, DEFAULT_SETTINGS, dueNudges, INVITE_GAP_DAYS, inviteVariant, MIN_TREND_DAYS, TREND_DAYS, type InviteInput, type NudgeContext } from '../services/nudgeEngine.js';
import { addDays } from '../utils/dates.js';
import { auth, db, fakeGlm, makeApp, PASSWORD, register } from './helpers.js';

const day = (n: number, over: Partial<{ mood: number | null; stress: number | null; sleepMin: number | null }> = {}) => ({ date: `2026-11-0${n}`, mood: null, stress: null, sleepMin: null, ...over });
const hard = { mood: 3, stress: 8 }, fine = { mood: 7, stress: 3, sleepMin: 450 };

describe('SESSION_INVITE: the trend rule (pure)', () => {
  it('constants: look at 5 days, need 3 days of data', () => { expect(TREND_DAYS).toBe(5); expect(MIN_TREND_DAYS).toBe(3); expect(INVITE_GAP_DAYS).toBe(3); });
  it('concerning = hard on MOST logged days (low mood, high stress or short sleep), with at least 3 days of data', () => {
    expect(computeTrend([day(1, hard), day(2, hard), day(3, hard)]).concerning).toBe(true);
    expect(computeTrend([day(1, hard), day(2, hard)]).concerning).toBe(false); // only 2 days of data
    expect(computeTrend([day(1, hard), day(2, fine), day(3, fine)]).concerning).toBe(false);
    expect(computeTrend([day(1, hard), day(2, hard), day(3, fine)]).concerning).toBe(true); // 2 of 3
    expect(computeTrend([day(1, hard), day(2, fine), day(3, fine), day(4, hard)]).concerning).toBe(false); // exactly half is not "most"
    expect(computeTrend([day(1, { sleepMin: 300 }), day(2, { sleepMin: 330 }), day(3, { sleepMin: 480 })]).concerning).toBe(true); // short sleep alone counts
    expect(computeTrend([day(1, { stress: 7 }), day(2, { stress: 9 }), day(3, { mood: 8 })]).concerning).toBe(true);
    expect(computeTrend([day(1), day(2), day(3, hard)])).toMatchObject({ daysWithData: 1, concerning: false }); // empty days do not count
  });
  it('only the last 5 days are looked at', () => {
    const days = [1, 2, 3].map((n) => day(n, hard)).concat([4, 5, 6, 7, 8].map((n) => ({ date: `2026-11-0${n}`, ...fine })));
    expect(computeTrend(days).concerning).toBe(false);
  });
  const invite = (over: Partial<InviteInput> = {}): InviteInput => ({ trend: { daysWithData: 4, hardDays: 3, concerning: true }, riskSignals: false, daysSinceLast: null, level: 'SOMETIMES', ...over });
  it('inviteVariant: once per 3 days, daytime only, never with level NEVER, support instead when there are risk signals', () => {
    expect(inviteVariant(invite(), 12 * 60)).toBe('INVITE');
    expect(inviteVariant(invite({ riskSignals: true }), 12 * 60)).toBe('SUPPORT');
    expect(inviteVariant(invite({ daysSinceLast: 1 }), 12 * 60)).toBeNull();
    expect(inviteVariant(invite({ daysSinceLast: 2 }), 12 * 60)).toBeNull();
    expect(inviteVariant(invite({ daysSinceLast: 3 }), 12 * 60)).toBe('INVITE');
    expect(inviteVariant(invite({ daysSinceLast: 0 }), 12 * 60)).toBe('INVITE'); // surfaced earlier today: keeps showing until dismissed
    expect(inviteVariant(invite({ level: 'RARELY', daysSinceLast: 5 }), 12 * 60)).toBeNull();
    expect(inviteVariant(invite({ level: 'RARELY', daysSinceLast: 7 }), 12 * 60)).toBe('INVITE');
    expect(inviteVariant(invite({ level: 'NEVER' }), 12 * 60)).toBeNull();
    expect(inviteVariant(invite({ trend: { daysWithData: 4, hardDays: 1, concerning: false } }), 12 * 60)).toBeNull();
    expect(inviteVariant(invite(), 9 * 60)).toBeNull(); expect(inviteVariant(invite(), 21 * 60)).toBeNull();
    expect(inviteVariant(undefined, 12 * 60)).toBeNull();
  });
  const ctx = (over: Partial<NudgeContext> = {}): NudgeContext => ({
    now: new Date('2026-11-04T12:00:00Z'), nowMin: 12 * 60, dow: 3, settings: { ...DEFAULT_SETTINGS }, morningCheckInToday: true, daysSinceCheckIn: 0, accountAgeDays: 30,
    tonightBedtime: '22:30', weeklyReviewSaved: false, weekActions: 0, invite: invite(), ...over,
  });
  it('dueNudges: respects quiet hours, snooze, the global switch and the per-type toggle; shares the daily cap of 2', () => {
    expect(dueNudges(ctx())).toContain('SESSION_INVITE');
    expect(dueNudges(ctx({ settings: { ...DEFAULT_SETTINGS, typesOff: ['SESSION_INVITE'] } }))).not.toContain('SESSION_INVITE');
    expect(dueNudges(ctx({ settings: { ...DEFAULT_SETTINGS, quietStart: '11:00', quietEnd: '13:00' } }))).toEqual([]);
    expect(dueNudges(ctx({ settings: { ...DEFAULT_SETTINGS, snoozedUntil: new Date('2026-11-04T13:00:00Z') } }))).toEqual([]);
    expect(dueNudges(ctx({ settings: { ...DEFAULT_SETTINGS, enabled: false } }))).toEqual([]);
    expect(dueNudges(ctx({ invite: invite({ level: 'NEVER' }) }))).toEqual([]);
    const due = dueNudges(ctx({ nowMin: 10 * 60 + 30, morningCheckInToday: false, daysSinceCheckIn: 5 }));
    expect(due).toEqual(['MORNING_PLAN', 'SESSION_INVITE', 'MOOD_CHECKIN']);
    expect(applyDailyCap(due, []).show).toEqual(['MORNING_PLAN', 'SESSION_INVITE']); // the cap is 2 and is shared
    expect(dueNudges(ctx({ invite: invite({ riskSignals: true }), nowMin: 10 * 60 + 30, morningCheckInToday: false }))[0]).toBe('SESSION_INVITE'); // support first
    expect(dailyCapFor('RARELY')).toBe(1); expect(dailyCapFor('OFTEN')).toBe(2);
    expect(dueNudges(ctx({ invite: invite({ level: 'RARELY' }), daysSinceCheckIn: 5 }))).not.toContain('MOOD_CHECKIN');
  });
});

describe('SESSION_INVITE in GET /today/feed', () => {
  beforeAll(async () => {
    await db.supportResource.upsert({
      where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
      create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
    });
  });
  afterEach(() => { vi.useRealTimers(); });
  const glm = fakeGlm();
  const app = makeApp({ glm });
  const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
  const login = async (email: string) => (await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data.accessToken as string;
  const feed = async (token: string) => (await request(app).get('/api/v1/today/feed').set(auth(token))).body.data;
  const checkin = (userId: string, date: string, mood: number, stress: number) => db.checkIn.create({ data: { userId, kind: 'MORNING', mood, stress, energy: 5, createdAt: new Date(`${date}T08:00:00Z`) } });
  const seed = async (userId: string, from: string, n: number, mood = 3, stress = 8) => { for (let i = 0; i < n; i++) await checkin(userId, addDays(from, i), mood, stress); };
  const invitation = (f: any) => f.nudges.find((n: any) => n.type === 'SESSION_INVITE');

  it('shows a gentle invitation after several hard days: no numbers, a visible Not now, a reason, "talk it through" wording', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app, { locale: 'en' });
    await seed(u.userId, '2026-10-31', 4);
    const f = await feed(u.accessToken);
    const n = invitation(f);
    expect(n).toMatchObject({ variant: 'INVITE', cta: 'start_session', options: [] });
    expect(n.primary).toMatchObject({ label: 'Start a session', deepLink: { route: 'Tabs', params: { screen: 'SessionsTab' } } });
    expect(n.notNowLabel).toBe('Not now');
    expect(n.reason.length).toBeGreaterThan(5);
    expect(/\d/.test(`${n.title} ${n.body} ${n.reason}`)).toBe(false);
    expect(n.body).toMatch(/talk it through/i);
    expect(n.body).toMatch(/AI companion, not a therapist/);
    expect(n.body).not.toMatch(/treat|therapy session|diagnos|disorder|depress/i);
    expect(f.riskMode).toBe(false);
    expect(glm.calls.length).toBe(0); // rule-based: no model
    expect((await db.nudgeLog.findMany({ where: { userId: u.userId, type: 'SESSION_INVITE' } })).length).toBe(1);
  });

  it('needs at least 3 days of data and hard days on most of them', async () => {
    at('2026-11-04T12:00:00Z');
    const a = await register(app); await seed(a.userId, '2026-11-03', 2);
    expect(invitation(await feed(a.accessToken))).toBeUndefined();
    const b = await register(app); await checkin(b.userId, '2026-11-02', 3, 8); await checkin(b.userId, '2026-11-03', 8, 2); await checkin(b.userId, '2026-11-04', 8, 2);
    expect(invitation(await feed(b.accessToken))).toBeUndefined();
    const c = await register(app); await checkin(c.userId, '2026-11-02', 3, 8); await checkin(c.userId, '2026-11-03', 3, 8); await checkin(c.userId, '2026-11-04', 8, 2);
    expect(invitation(await feed(c.accessToken))).toBeDefined();
  });

  it('short sleep counts too (sleep diary only, no check-ins)', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    for (const [i, h] of [[1, 300], [2, 320], [3, 350]] as const) await db.sleepEntry.create({ data: { userId: u.userId, date: `2026-11-0${i + 1}`, bedtime: '01:00', wakeTime: '06:00', durationMin: h, latencyMin: 20, awakenings: 1, rested: 4, score: 60 } });
    expect(invitation(await feed(u.accessToken))).toBeDefined();
  });

  it('"Not now" keeps it away for 3 days, then it may come back; at most once per 3 days even without a dismissal', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    await seed(u.userId, '2026-10-28', 12);
    const t0 = await login(u.email);
    expect(invitation(await feed(t0))).toBeDefined();
    await request(app).post('/api/v1/nudges/SESSION_INVITE/dismiss').set(auth(t0)).expect(204);
    expect(invitation(await feed(t0))).toBeUndefined(); // dismissed today
    at('2026-11-05T12:00:00Z'); expect(invitation(await feed(await login(u.email)))).toBeUndefined();
    at('2026-11-06T12:00:00Z'); expect(invitation(await feed(await login(u.email)))).toBeUndefined();
    at('2026-11-07T12:00:00Z'); expect(invitation(await feed(await login(u.email)))).toBeDefined();
    // shown on 11-07 and not dismissed: gone on the next two days anyway
    at('2026-11-08T12:00:00Z'); expect(invitation(await feed(await login(u.email)))).toBeUndefined();
  });

  it('per-type toggle: SESSION_INVITE appears in the settings and switching it off stops the invitation; quiet hours, snooze and the master switch too', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    await seed(u.userId, '2026-10-31', 4);
    const s = await request(app).get('/api/v1/nudges/settings').set(auth(u.accessToken));
    expect(s.body.data.types).toMatchObject({ SESSION_INVITE: true });
    const off = await request(app).put('/api/v1/nudges/settings').set(auth(u.accessToken)).send({ types: { SESSION_INVITE: false } });
    expect(off.body.data.types.SESSION_INVITE).toBe(false);
    expect(invitation(await feed(u.accessToken))).toBeUndefined();
    await request(app).put('/api/v1/nudges/settings').set(auth(u.accessToken)).send({ types: { SESSION_INVITE: true }, quietStart: '11:00', quietEnd: '13:00' });
    expect((await feed(u.accessToken)).nudges).toEqual([]);
    await request(app).put('/api/v1/nudges/settings').set(auth(u.accessToken)).send({ quietStart: '23:00', quietEnd: '07:00' });
    await request(app).post('/api/v1/nudges/snooze').set(auth(u.accessToken)).send({ minutes: 120 });
    expect((await feed(u.accessToken)).nudges).toEqual([]);
    await request(app).post('/api/v1/nudges/snooze').set(auth(u.accessToken)).send({ minutes: 0 });
    expect(invitation(await feed(u.accessToken))).toBeDefined();
  });

  it('suggestion level: NEVER shows no nudges at all; RARELY allows one a day', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    await seed(u.userId, '2026-10-31', 4);
    await request(app).put('/api/v1/me/ai-settings').set(auth(u.accessToken)).send({ suggestionLevel: 'NEVER' });
    const f = await feed(u.accessToken);
    expect(f.nudges).toEqual([]); expect(f.suggestions).toEqual([]); expect(f.suggestionLevel).toBe('NEVER');
    await request(app).put('/api/v1/me/ai-settings').set(auth(u.accessToken)).send({ suggestionLevel: 'RARELY' });
    expect((await feed(u.accessToken)).nudges.length).toBeLessThanOrEqual(1);
  });

  it('risk signals replace the invitation by support options (Emergency, Safety plan, trusted person) and the feed holds no task', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    await seed(u.userId, '2026-10-31', 4);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'ELEVATED', category: 'SELF_HARM', actionTaken: 'ASSESSMENT_ITEM9', createdAt: new Date('2026-11-03T10:00:00Z') } });
    const g = await db.kaizenGoal.create({ data: { userId: u.userId, title: 'Calm', category: 'BREATHING', status: 'ACTIVE' } });
    await db.kaizenAction.create({ data: { goalId: g.id, userId: u.userId, date: '2026-11-04', title: 'Breathe', description: '', targetValue: 2, unit: 'minutes' } });
    const f = await feed(u.accessToken);
    expect(f.riskMode).toBe(true);
    const n = invitation(f);
    expect(n).toMatchObject({ variant: 'SUPPORT', cta: 'support', primary: null });
    expect(n.options.map((o: any) => o.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
    expect(n.body).toMatch(/doctor or counsellor/);
    expect(n.options.some((o: any) => ['SESSION', 'BREATHING', 'GROUNDING'].includes(o.id))).toBe(false);
    expect(f.nudges.map((x: any) => x.type)).toEqual(['SESSION_INVITE']); // no other nudge
    expect(f.plan.focus).toBeNull(); expect(f.plan.kaizenActionId).toBeNull(); // no task
    expect(f.suggestions.map((s: any) => s.id).sort()).toEqual(['EMERGENCY', 'SAFETY_PLAN', 'TRUSTED_PERSON']);
  });

  it('risk signals without a hard trend: no invitation at all, only the crisis support cards in `suggestions`', async () => {
    at('2026-11-04T12:00:00Z');
    const u = await register(app);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN', createdAt: new Date('2026-11-02T10:00:00Z') } });
    const f = await feed(u.accessToken);
    expect(invitation(f)).toBeUndefined();
    expect(f.suggestions.every((s: any) => s.crisis)).toBe(true);
  });

  it('every card carries a one-line reason in the user\'s language, with no numbers', async () => {
    at('2026-11-04T10:30:00Z');
    const u = await register(app, { locale: 'bn' });
    await seed(u.userId, '2026-10-31', 4, 6, 4);
    const g = await db.kaizenGoal.create({ data: { userId: u.userId, title: 'Calm', category: 'BREATHING', status: 'ACTIVE' } });
    await db.kaizenAction.create({ data: { goalId: g.id, userId: u.userId, date: '2026-11-04', title: 'Breathe', description: '', targetValue: 2, unit: 'minutes' } });
    const f = await feed(u.accessToken);
    expect(f.plan.reason).toMatch(/[ঀ-৿]/);
    const cards = [...f.nudges, ...f.insights, ...f.suggestions];
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) { expect(c.reason, c.type ?? c.kind ?? c.id).toMatch(/[ঀ-৿]/); expect(/[0-9]/.test(c.reason)).toBe(false); }
    expect(f.order.length).toBe(1 + cards.length);
  });
});
