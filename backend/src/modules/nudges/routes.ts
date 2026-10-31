import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { applyDailyCap, DEFAULT_SETTINGS, dueNudges, inQuietHours, parseTypesOff, type NudgeSettingsView } from '../../services/nudgeEngine.js';
import { buildRoutine, gradualBedtime } from '../../services/sleepService.js';
import { copyLang, fill, INSIGHT_COPY, NUDGE_COPY, NUDGE_CTA, NUDGE_TYPES, type InsightKind, type NudgeType } from '../../services/wellnessCopy.js';
import { addDays, daysBetween, localClock, mondayOf } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const nudgeType = z.enum(NUDGE_TYPES);

export function nudgesRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function loadSettings(userId: string): Promise<NudgeSettingsView> {
    const s = await d.db.nudgeSettings.findUnique({ where: { userId } });
    if (!s) return { ...DEFAULT_SETTINGS };
    return { enabled: s.enabled, quietStart: s.quietStart, quietEnd: s.quietEnd, typesOff: parseTypesOff(s.typesOff), snoozedUntil: s.snoozedUntil };
  }
  const settingsView = (s: NudgeSettingsView) => ({
    enabled: s.enabled, quietStart: s.quietStart, quietEnd: s.quietEnd, snoozedUntil: s.snoozedUntil,
    types: Object.fromEntries(NUDGE_TYPES.map((t) => [t, !s.typesOff.includes(t)])) as Record<NudgeType, boolean>,
  });

  r.get('/settings', asyncHandler(async (req, res) => { res.json({ data: settingsView(await loadSettings(req.user.id)) }); }));

  r.put('/settings', validate({ body: z.object({
    enabled: z.boolean().optional(), quietStart: hhmm.optional(), quietEnd: hhmm.optional(),
    types: z.object({ WIND_DOWN: z.boolean(), MOOD_CHECKIN: z.boolean(), WEEKLY_REVIEW: z.boolean(), MORNING_PLAN: z.boolean() }).partial().optional(),
  }) }), asyncHandler(async (req, res) => {
    const cur = await loadSettings(req.user.id);
    const off = new Set<NudgeType>(cur.typesOff);
    for (const [t, on] of Object.entries(req.body.types ?? {}) as [NudgeType, boolean][]) { if (on) off.delete(t); else off.add(t); }
    const data = { enabled: req.body.enabled ?? cur.enabled, quietStart: req.body.quietStart ?? cur.quietStart, quietEnd: req.body.quietEnd ?? cur.quietEnd, typesOff: [...off].join(',') };
    await d.db.nudgeSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...data }, update: data });
    res.json({ data: settingsView(await loadSettings(req.user.id)) });
  }));

  // minutes = 0 clears the snooze. Max one week.
  r.post('/snooze', validate({ body: z.object({ minutes: z.number().int().min(0).max(10_080) }) }), asyncHandler(async (req, res) => {
    const snoozedUntil = req.body.minutes > 0 ? new Date(Date.now() + req.body.minutes * 60_000) : null;
    await d.db.nudgeSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, snoozedUntil }, update: { snoozedUntil } });
    res.json({ data: settingsView(await loadSettings(req.user.id)) });
  }));

  r.post('/:type/dismiss', validate({ params: z.object({ type: nudgeType }) }), asyncHandler(async (req, res) => {
    const u = await d.db.user.findUnique({ where: { id: req.user.id } });
    const date = localClock(u?.timezone).date;
    const done = await d.db.nudgeLog.updateMany({ where: { userId: req.user.id, date, type: req.params.type }, data: { dismissedAt: new Date() } });
    if (!done.count) throw notFound('Nudge not found');
    res.status(204).end();
  }));
  return r;
}

/** GET /today/feed: everything the in-app Today screen needs in one call (plan, due nudges, insight cards). */
export function todayRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const settingsOf = nudgesSettingsLoader(d);

  r.get('/feed', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const u = await d.db.user.findUnique({ where: { id: uid }, include: { profile: true } });
    const tz = u?.timezone ?? 'UTC';
    const lang = copyLang(u?.locale);
    const clock = localClock(tz);
    const today = clock.date, weekStart = mondayOf(today);
    const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
    const desired = typeof prefs.desiredBedtime === 'string' ? prefs.desiredBedtime : '22:30';
    const since = new Date(Date.now() - 8 * 86_400_000);
    const [settings, sleeps, lastCheckIn, morning, summary, latestSummary, weekActions, action, goal, logs, checkins7] = await Promise.all([
      settingsOf(uid),
      d.db.sleepEntry.findMany({ where: { userId: uid }, orderBy: { date: 'desc' }, take: 7 }),
      d.db.checkIn.findFirst({ where: { userId: uid }, orderBy: { createdAt: 'desc' } }),
      d.db.checkIn.findFirst({ where: { userId: uid, kind: 'MORNING', createdAt: { gte: new Date(Date.now() - 20 * 3_600_000) } } }),
      d.db.weeklySummary.findUnique({ where: { userId_weekStart: { userId: uid, weekStart } } }),
      d.db.weeklySummary.findFirst({ where: { userId: uid }, orderBy: { weekStart: 'desc' } }),
      d.db.kaizenAction.findMany({ where: { userId: uid, date: { gte: addDays(today, -6) } } }),
      d.db.kaizenAction.findFirst({ where: { userId: uid, date: today, goal: { status: 'ACTIVE' } } }),
      d.db.kaizenGoal.findFirst({ where: { userId: uid, status: 'ACTIVE' } }),
      d.db.nudgeLog.findMany({ where: { userId: uid, date: today } }),
      d.db.checkIn.findMany({ where: { userId: uid, createdAt: { gte: since } }, select: { mood: true } }),
    ]);
    const bedtime = gradualBedtime(sleeps.map((s) => s.bedtime), desired);
    const windDownAt = buildRoutine(bedtime)[0]!.at;
    const lastLocal = lastCheckIn ? localClock(tz, lastCheckIn.createdAt).date : null;
    const due = dueNudges({
      now: new Date(), nowMin: clock.minutes, dow: clock.dow, settings, morningCheckInToday: !!morning,
      daysSinceCheckIn: lastLocal ? daysBetween(lastLocal, today) : null,
      accountAgeDays: u ? daysBetween(localClock(tz, u.createdAt).date, today) : 0,
      tonightBedtime: bedtime, weeklyReviewSaved: !!summary, weekActions: weekActions.length,
    });
    const { show, logNew } = applyDailyCap(due, logs.map((l) => ({ type: l.type as NudgeType, dismissed: !!l.dismissedAt })));
    for (const type of logNew) await d.db.nudgeLog.upsert({ where: { userId_date_type: { userId: uid, date: today, type } }, create: { userId: uid, date: today, type }, update: {} });

    const nudges = show.map((type) => {
      const c = NUDGE_COPY[type][lang];
      return { type, title: c.title, body: fill(c.body, { bedtime }), cta: NUDGE_CTA[type] };
    });
    const insights: { kind: InsightKind; title: string; body: string; value: number | string | null }[] = [];
    const card = (kind: InsightKind, n: number | string) => {
      const c = INSIGHT_COPY[kind][lang];
      insights.push({ kind, title: c.title, body: fill(c.body, { n }), value: n });
    };
    const doneWeek = weekActions.filter((a) => a.status === 'DONE' || a.status === 'PARTIAL').length;
    if (doneWeek > 0) card('KAIZEN_WEEK', doneWeek);
    const scores = sleeps.slice(0, 7).map((s) => s.score);
    if (scores.length >= 3) card('SLEEP_TREND', Math.round(scores.reduce((t, x) => t + x, 0) / scores.length));
    const moods = checkins7.map((c) => c.mood);
    if (moods.length >= 3) card('MOOD_WEEK', Math.round((moods.reduce((t, x) => t + x, 0) / moods.length) * 10) / 10);
    if (latestSummary) card('WEEKLY_SUMMARY', latestSummary.id);

    res.json({ data: {
      date: today, quietNow: inQuietHours(clock.minutes, settings.quietStart, settings.quietEnd), snoozedUntil: settings.snoozedUntil,
      plan: { focus: action?.title ?? goal?.title ?? null, kaizenActionId: action?.id ?? null, tonightBedtime: bedtime, windDownAt, morningCheckInDone: !!morning },
      nudges, insights,
    } });
  }));
  return r;
}

function nudgesSettingsLoader(d: Deps) {
  return async (userId: string): Promise<NudgeSettingsView> => {
    const s = await d.db.nudgeSettings.findUnique({ where: { userId } });
    if (!s) return { ...DEFAULT_SETTINGS };
    return { enabled: s.enabled, quietStart: s.quietStart, quietEnd: s.quietEnd, typesOff: parseTypesOff(s.typesOff), snoozedUntil: s.snoozedUntil };
  };
}
