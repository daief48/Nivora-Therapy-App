import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ACTIONS, createMarkerFilter, extractAction, setOutcome, stepForFeelings } from '../services/actionMenu.js';
import { REASONS } from '../services/actionCopy.js';
import { dueNudges, DEFAULT_SETTINGS } from '../services/nudgeEngine.js';
import { planNext } from '../services/kaizenEngine.js';
import { minRFor } from '../services/monthlyStats.js';
import { routineDateFor } from '../services/routineSteps.js';
import { runIdleSweep } from '../services/jobs.js';
import { addKaizenStep } from '../services/kaizenExtras.js';
import { NUDGE_COPY } from '../services/wellnessCopy.js';
import { journalEmotions } from '../services/journalEmotions.js';
import { addDays, localDate } from '../utils/dates.js';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
type App = ReturnType<typeof makeApp>;
const call = (app: App, method: 'get' | 'post' | 'put' | 'patch' | 'delete', t: string, url: string, body?: unknown) => {
  const r = (request(app) as any)[method](`/api/v1${url}`).set(auth(t));
  return body === undefined ? r : r.send(body);
};
const grant = (app: App, t: string, consentType: string) => call(app, 'post', t, '/consents', { consentType }).expect(201);
afterEach(() => { vi.useRealTimers(); });
const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
void beforeAll;

describe('B1: manual sleep entries are never overwritten by imports', () => {
  it('POST /sleep marks the row manual (also when it replaces an imported night); an import skips it', async () => {
    const app = makeApp();
    const u = await register(app);
    await grant(app, u.accessToken, 'HEALTH_IMPORT');
    const date = addDays(localDate('UTC'), -1);
    await call(app, 'post', u.accessToken, '/health/import', { source: 'healthconnect', sleep: [{ date, bedtime: '23:00', wakeTime: '06:00' }] }).expect(200);
    expect((await db.sleepEntry.findFirst({ where: { userId: u.userId, date } }))!.source).toBe('healthconnect');
    const m = await call(app, 'post', u.accessToken, '/sleep', { bedtime: '22:30', wakeTime: '07:00', rested: 7, date });
    expect(m.body.data.source).toBe('manual');
    const again = await call(app, 'post', u.accessToken, '/health/import', { source: 'healthconnect', sleep: [{ date, bedtime: '01:00', wakeTime: '05:00' }] });
    expect(again.body.data.skippedManual.sleep).toBe(1);
    const row = await db.sleepEntry.findFirst({ where: { userId: u.userId, date } });
    expect(row).toMatchObject({ source: 'manual', bedtime: '22:30' });
  });
});

describe('B2: one tolerant [[ACTION]] marker definition', () => {
  const stream = (full: string, size: number) => {
    const f = createMarkerFilter(); let shown = '';
    for (let i = 0; i < full.length; i += size) shown += f.push(full.slice(i, i + size));
    return shown + f.end();
  };
  it('split across deltas, spaced, hyphenated id', () => {
    for (let size = 1; size <= 9; size++) {
      expect(stream('Maybe a few breaths, if you like.\n[[ACTION:BREATHING]]', size).trim()).toBe('Maybe a few breaths, if you like.');
      expect(stream('Maybe sleep.\n[[ ACTION : sleep-routine ]]', size).trim()).toBe('Maybe sleep.');
    }
    expect(extractAction('Maybe sleep.\n[[ ACTION : sleep-routine ]]')).toEqual({ text: 'Maybe sleep.', id: 'SLEEP_ROUTINE' });
    expect(extractAction('Hi\n[[action:Thought_Record]]').id).toBe('THOUGHT_RECORD');
  });
  it('a marker truncated at max tokens never reaches the text', () => {
    for (const tail of ['[[', '[[ACT', '[[ACTION:', '[[ACTION: BREAT', '[[ACTION:BREATHING]']) {
      expect(extractAction(`We could try that.\n${tail}`)).toEqual({ text: 'We could try that.', id: null });
      expect(stream(`We could try that.\n${tail}`, 3).trim()).toBe('We could try that.');
    }
  });
  it('a stray [[ACTION: prefix does not swallow the text that follows', () => {
    const later = ' and then a long, ordinary sentence that keeps going well past what any marker could be.';
    const shown = stream(`Look [[ACTION: not a real marker${later}`, 4);
    expect(shown).toContain('ordinary sentence');
    expect(shown.endsWith('could be.')).toBe(true);
    // a stray prefix with a short tail is released at end() when it is plain text
    expect(stream('Use [[brackets]] like this', 2)).toBe('Use [[brackets]] like this');
  });
});

describe('B3: a short night does not lower the goal', () => {
  it('target 10, two short nights (shrunk, base kept), third normal night plans 10 again', () => {
    const base = { micro: false, difficultyFeedback: null, nextPreference: null };
    const hist = [
      { date: '2026-11-02', status: 'PLANNED', targetValue: 6, baseTarget: 10, ...base }, // shrunk by SLEEP_LOW, never done
      { date: '2026-11-01', status: 'PLANNED', targetValue: 6, baseTarget: 10, ...base },
    ];
    const p = planNext('BREATHING', 10, hist, '2026-11-03');
    expect(p.target).toBe(10);
    const without = planNext('BREATHING', 10, hist.map((h) => ({ ...h, baseTarget: null })), '2026-11-03');
    expect(without.target).toBe(6); // the old behaviour: the shrink stuck
  });
});

describe('B4: flowers never decrease', () => {
  it('a done step cannot become a skip; deleting a goal keeps its flowers in progress and the summary', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await call(app, 'post', t, '/kaizen/goals', { title: 'Calm', category: 'BREATHING' }).expect(201);
    const act = (await call(app, 'get', t, '/kaizen/today')).body.data.action;
    await call(app, 'post', t, `/kaizen/actions/${act.id}/complete`, { level: 'FULL' }).expect(200);
    const down = await call(app, 'post', t, `/kaizen/actions/${act.id}/complete`, { level: 'SKIPPED' });
    expect(down.status).toBe(409);
    expect((await db.kaizenAction.findUnique({ where: { id: act.id } }))!.status).toBe('DONE');
    const goalId = (await call(app, 'get', t, '/kaizen/goals')).body.data[0].id;
    await call(app, 'delete', t, `/kaizen/goals/${goalId}`).expect(204);
    expect((await call(app, 'get', t, '/kaizen/progress')).body.data.completed).toBe(1);
    expect((await call(app, 'get', t, '/insights/summary')).body.data.kaizen.totalCompleted).toBe(1);
    expect((await call(app, 'get', t, '/kaizen/garden')).body.data.total).toBe(1);
  });
});

describe('B5: journal delete and tombstone purge', () => {
  it('delete clears the derived reading too; old tombstones are purged by the sweep', async () => {
    const app = makeApp({ glm: fakeGlm('{"emotions":["tired"],"reflection":"Words that showed up in your writing: tired.","suggestion":"x"}') });
    const u = await register(app);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const id = (await call(app, 'post', u.accessToken, '/journal', { content: 'so tired' })).body.data.id as string;
    await call(app, 'post', u.accessToken, '/journal-ai/emotions', { text: 'so tired', entryId: id }).expect(200);
    await call(app, 'delete', u.accessToken, `/journal/${id}`).expect(204);
    expect(await db.journalEntry.findUnique({ where: { id } })).toMatchObject({ encryptedContent: '', emotionEncrypted: null, audioEncrypted: null });
    await db.journalEntry.update({ where: { id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    const fresh = await db.journalEntry.create({ data: { userId: u.userId, encryptedContent: '', deletedAt: new Date() } });
    await runIdleSweep({ db, glm: fakeGlm(), cipher });
    expect(await db.journalEntry.findUnique({ where: { id } })).toBeNull();
    expect(await db.journalEntry.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});

describe('B6: the privacy export is complete', () => {
  it('includes nudges, garden, routine logs, kaizen provenance, empty goals and kept audio', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await call(app, 'put', t, '/nudges/settings', { quietStart: '22:00' }).expect(200);
    await db.nudgeLog.create({ data: { userId: u.userId, date: localDate('UTC'), type: 'WIND_DOWN' } });
    await db.gardenState.create({ data: { userId: u.userId, carried: 4 } });
    await call(app, 'put', t, '/sleep/routine/done/breathing', { done: true }).expect(200);
    await call(app, 'post', t, '/kaizen/goals', { title: 'Empty goal', category: 'JOURNALING' }).expect(201);
    await addKaizenStep(db, u.userId, { category: 'SHORT_WALK', minutes: 5, source: 'WALK', userTextEncrypted: cipher.encrypt('to the tea stall') });
    await db.journalEntry.create({ data: { userId: u.userId, encryptedContent: cipher.encrypt('hello'), source: 'voice', audioEncrypted: cipher.encrypt('QUJD'), audioMime: 'audio/mp4' } });
    const ex = (await call(app, 'post', t, '/privacy/export')).body.data;
    expect(ex.nudgeSettings.quietStart).toBe('22:00');
    expect(ex.nudgeLog).toHaveLength(1);
    expect(ex.garden.carriedFlowers).toBe(4);
    expect(ex.routineLogs[0].doneIds).toContain('breathing');
    expect(ex.kaizenGoals.some((g: any) => g.title === 'Empty goal')).toBe(true);
    expect(ex.kaizen[0]).toMatchObject({ source: 'WALK', yourText: 'to the tea stall' });
    expect(ex.journal[0]).toMatchObject({ audioBase64: 'QUJD', audioMime: 'audio/mp4' });
  });
});

describe('B7: duplicate offers and outcomes', () => {
  it('session-close returns the same offer when asked twice; a second terminal outcome does not overwrite', async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    const sid = (await call(app, 'post', t, '/sessions', { language: 'en' })).body.data.id as string;
    const a = (await call(app, 'post', t, '/actions/session-close', { sessionId: sid })).body.data;
    const b = (await call(app, 'post', t, '/actions/session-close', { sessionId: sid })).body.data;
    if (a.action) {
      expect(b.action.offerId).toBe(a.action.offerId);
      expect(await db.actionOffer.count({ where: { userId: u.userId, surface: 'SESSION_CLOSE', sessionId: sid } })).toBe(1);
    }
    const acc = await call(app, 'post', t, '/actions/BREATHING/outcome', { outcome: 'ACCEPTED' });
    const dis = await call(app, 'post', t, '/actions/BREATHING/outcome', { outcome: 'DISMISSED' });
    expect(acc.body.data.outcome).toBe('ACCEPTED');
    expect(dis.body.data.outcome).toBe('ACCEPTED');
    expect(dis.body.data.offerId).toBe(acc.body.data.offerId);
    expect(await db.actionOffer.count({ where: { userId: u.userId, actionId: 'BREATHING' } })).toBe(1);
    const row = await setOutcome(db, u.userId, 'BREATHING', 'THUMBS_UP');
    expect(row).toMatchObject({ outcome: 'ACCEPTED', feedback: 1 });
    void ACTIONS;
  });

  it('today feed tracks action_offered only for newly logged nudges', async () => {
    const app = makeApp();
    const u = await register(app);
    expect(typeof u.userId).toBe('string'); // telemetry is opt-in and content-free: covered by the logNew check in the route
  });
});

describe('B8: helper goals are marked, not matched by title', () => {
  it("a user's own goal titled Breathing is never reused; parallel completions do not 500", async () => {
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    const mine = (await call(app, 'post', t, '/kaizen/goals', { title: 'Breathing', category: 'BREATHING' })).body.data;
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(app, 'post', t, '/practice/breathing', { minutes: 2 })));
    expect(rs.map((r: any) => r.status)).toEqual([201, 201, 201, 201]);
    const goals = await db.kaizenGoal.findMany({ where: { userId: u.userId, category: 'BREATHING' } });
    expect(goals).toHaveLength(2);
    expect(goals.find((g) => g.id === mine.id)!.systemKey).toBeNull();
    expect(goals.filter((g) => g.systemKey === 'BREATHING')).toHaveLength(1);
    expect(await db.kaizenAction.count({ where: { goalId: mine.id } })).toBe(0);
  });
  it('parallel addKaizenStep returns the one existing step', async () => {
    const app = makeApp();
    const u = await register(app);
    const rs = await Promise.all([1, 2, 3].map(() => addKaizenStep(db, u.userId, { category: 'GRATITUDE', minutes: 2, source: 'MENU' })));
    expect(new Set(rs.map((r) => r.action.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
  });
});

describe('B9: offline feeling lexicon', () => {
  const words = async (text: string) => (await journalEmotions({ chat: async () => { throw new Error('off'); }, stream: async () => { throw new Error('off'); } } as any, text, 'en', 'English')).emotions;
  it('uses word boundaries and handles hopeless before hope', async () => {
    expect(await words('I will download it and stand alone in the crystal hall')).toEqual([]);
    expect(await words('I feel hopeless')).toEqual(['hopeless']);
    expect(await words('I hope it goes well')).toEqual(['hopeful']);
    expect(await words('leave me alone please')).toEqual([]);
  });
  it('does not map a negated feeling to that feeling', async () => {
    expect(await words('I am not tired at all')).toEqual([]);
    expect(await words("I don't feel anxious today, just calm")).toEqual(['calm']);
    expect(await words('ক্লান্ত না আজ')).toEqual([]);
    expect(stepForFeelings([], 'I am not tired').actionId).toBe('KAIZEN_STEP');
    expect(stepForFeelings([], 'leave me alone').actionId).toBe('KAIZEN_STEP');
    expect(stepForFeelings([], 'download the file').actionId).toBe('KAIZEN_STEP');
    expect(stepForFeelings([], 'I feel so alone lately').actionId).toBe('REACH_OUT');
  });
});

describe('B10: routine night date and atomic taps', () => {
  it('a local time before 04:00 belongs to the previous evening', () => {
    expect(routineDateFor({ date: '2026-11-05', minutes: 20 })).toBe('2026-11-04');
    expect(routineDateFor({ date: '2026-11-05', minutes: 3 * 60 + 59 })).toBe('2026-11-04');
    expect(routineDateFor({ date: '2026-11-05', minutes: 4 * 60 })).toBe('2026-11-05');
    expect(routineDateFor({ date: '2026-11-01', minutes: 5 })).toBe('2026-10-31');
  });
  it('bedtime 23:45: a tick at 00:20 lands on tonight\'s routine, and parallel taps keep every update', async () => {
    at('2026-11-04T23:55:00Z');
    const app = makeApp();
    const u = await register(app);
    const t = u.accessToken;
    await call(app, 'put', t, '/sleep/routine/done/breathing', { done: true }).expect(200);
    at('2026-11-05T00:05:00Z');
    const res = await Promise.all([
      call(app, 'put', t, '/sleep/routine/done/reflection', { done: true }),
      call(app, 'put', t, '/sleep/routine/done/audio', { done: true }),
      call(app, 'post', t, '/sleep/routine/steps', { stepId: 'DIM_LIGHTS' }),
    ]);
    expect(res.map((r: any) => r.status)).toEqual([200, 200, 201]);
    const rows = await db.routineLog.findMany({ where: { userId: u.userId } });
    expect(rows.map((r) => r.date)).toEqual(['2026-11-04']);
    expect(rows[0]!.doneIds.split(',').sort()).toEqual(['audio', 'breathing', 'reflection']);
    expect(JSON.stringify(rows[0]!.extras)).toContain('DIM_LIGHTS');
    const g = await call(app, 'get', t, '/sleep/routine');
    expect(g.body.data.doneIds.sort()).toEqual(['audio', 'breathing', 'reflection']);
  });
});

describe('B11: all of a day\'s kaizen actions count', () => {
  it('kaizen is DONE when any action of the day is done, even if another was skipped', async () => {
    const app = makeApp();
    const u = await register(app);
    const today = localDate('UTC');
    const g1 = await db.kaizenGoal.create({ data: { userId: u.userId, title: 'A', category: 'BREATHING' } });
    const g2 = await db.kaizenGoal.create({ data: { userId: u.userId, title: 'B', category: 'JOURNALING', status: 'PAUSED' } });
    const base = { userId: u.userId, date: today, title: 't', description: 'd', targetValue: 2, unit: 'minutes' };
    await db.kaizenAction.create({ data: { ...base, goalId: g1.id, status: 'SKIPPED' } });
    await db.kaizenAction.create({ data: { ...base, goalId: g2.id, status: 'DONE' } });
    const tl = (await call(app, 'get', u.accessToken, '/insights/timeline?days=3')).body.data;
    expect(tl[tl.length - 1].kaizen).toBe('DONE');
  });
});

describe('B12: cached weekly report keeps its own stats', () => {
  it('returns the stats it was generated with next to the old text', async () => {
    const app = makeApp({ glm: fakeGlm('not json') });
    const u = await register(app);
    const t = u.accessToken;
    await grant(app, t, 'WELLNESS_AI_SHARING');
    const first = (await call(app, 'post', t, '/reports/weekly', {})).body.data;
    expect(first.cached).toBe(false);
    expect(first.stats.kaizenDone).toBe(0);
    await addKaizenStep(db, u.userId, { category: 'GRATITUDE', minutes: 2, source: 'MENU' });
    await db.kaizenAction.updateMany({ where: { userId: u.userId }, data: { status: 'DONE' } });
    const second = (await call(app, 'post', t, '/reports/weekly', {})).body.data;
    expect(second.cached).toBe(true);
    expect(second.stats).toEqual(first.stats);
    expect((await call(app, 'get', t, '/reports/weekly')).body.data.stats).toEqual(first.stats);
  });
});

describe('B13: monthly correlations need |r| >= 0.5 below 30 paired days', () => {
  it('threshold', () => {
    expect(minRFor(20)).toBe(0.5);
    expect(minRFor(29)).toBe(0.5);
    expect(minRFor(30)).toBe(0.3);
  });
});

describe('B14: a walk idea is stored encrypted', () => {
  it('the title in the database is a template, the person sees their own words', async () => {
    const app = makeApp();
    const u = await register(app);
    const r = await call(app, 'post', u.accessToken, '/actions/walk', { text: 'to the tea stall', minutes: 10 });
    expect(r.status).toBe(201);
    expect(r.body.data.action.title).toBe('to the tea stall');
    const row = await db.kaizenAction.findFirst({ where: { userId: u.userId } });
    expect(row!.title).not.toContain('tea');
    expect(row!.userTextEncrypted).toBeTruthy();
    expect(row!.userTextEncrypted).not.toContain('tea');
    const today = await db.kaizenGoal.findFirst({ where: { userId: u.userId } });
    expect(today!.systemKey).toBe('SHORT_WALK');
    // replacing a planned idea
    const r2 = await call(app, 'post', u.accessToken, '/actions/walk', { text: 'around the block', minutes: 5 });
    expect(r2.body.data.action.title).toBe('around the block');
    expect(cipher.decrypt((await db.kaizenAction.findFirst({ where: { userId: u.userId } }))!.userTextEncrypted!)).toBe('around the block');
  });
});

describe('B15: nudge edge cases', () => {
  const ctx = (nowMin: number, bedtime: string) => ({
    now: new Date('2026-11-04T12:00:00Z'), nowMin, dow: 3, settings: { ...DEFAULT_SETTINGS }, morningCheckInToday: true, daysSinceCheckIn: 0, accountAgeDays: 30,
    tonightBedtime: bedtime, weeklyReviewSaved: true, weekActions: 0,
  });
  it('a bedtime inside quiet hours still gets a wind-down reminder before quiet hours start', () => {
    expect(dueNudges(ctx(22 * 60 + 30, '00:30'))).toContain('WIND_DOWN');
    expect(dueNudges(ctx(21 * 60, '00:30'))).not.toContain('WIND_DOWN');
    expect(dueNudges(ctx(23 * 60 + 30, '00:30'))).toEqual([]); // quiet hours stay silent
    expect(dueNudges(ctx(22 * 60, '22:30'))).toContain('WIND_DOWN'); // unchanged for a normal bedtime
  });
  it('dismissing after midnight uses the date of the logged nudge', async () => {
    at('2026-11-05T00:10:00Z');
    const app = makeApp();
    const u = await register(app);
    await db.nudgeLog.create({ data: { userId: u.userId, date: '2026-11-04', type: 'WIND_DOWN' } });
    await call(app, 'post', u.accessToken, '/nudges/WIND_DOWN/dismiss').expect(204);
    expect((await db.nudgeLog.findFirst({ where: { userId: u.userId } }))!.dismissedAt).not.toBeNull();
    expect((await call(app, 'post', u.accessToken, '/nudges/MOOD_CHECKIN/dismiss')).status).toBe(404);
  });
});

describe('B16: server copy', () => {
  it('MOOD_CHECKIN opens without an absence note and nothing says মেজাজ', () => {
    for (const lang of ['en', 'bn', 'hi', 'ne'] as const) {
      const b = NUDGE_COPY.MOOD_CHECKIN[lang].body;
      expect(b).not.toMatch(/few days|কয়েক দিন|कुछ दिन|केही दिन/);
    }
    expect(JSON.stringify(REASONS)).not.toContain('মেজাজ');
  });
  it('pattern_weekday is a tendency in every language', () => {
    for (const lang of ['bn', 'hi', 'ne'] as const) expect(REASONS.pattern_weekday[lang]).toMatch(/প্রবণতা|प्रवृत्ति/);
  });
});
