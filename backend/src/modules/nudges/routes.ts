import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { reasonText, pick, type ReasonKey } from '../../services/actionCopy.js';
import { buildMenu, crisisItems, menuCards, parseLevel, toCard, type ActionCard } from '../../services/actionMenu.js';
import { adaptTodayForSleep } from '../../services/kaizenExtras.js';
import {
  applyDailyCap, computeTrend, dailyCapFor, DEFAULT_SETTINGS, dueNudges, inQuietHours, inviteVariant, parseTypesOff, TREND_DAYS, type NudgeSettingsView, type TrendDay,
} from '../../services/nudgeEngine.js';
import { userHasRisk } from '../../services/riskState.js';
import { buildRoutine, gradualBedtime } from '../../services/sleepService.js';
import { copyLang, fill, INSIGHT_COPY, NUDGE_COPY, NUDGE_CTA, NUDGE_TYPES, START_SESSION_LABEL, SUPPORT_NUDGE_COPY, type InsightKind, type NudgeType } from '../../services/wellnessCopy.js';
import { addDays, daysBetween, lastDays, localClock, mondayOf } from '../../utils/dates.js';
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
    types: z.object({ WIND_DOWN: z.boolean(), MOOD_CHECKIN: z.boolean(), WEEKLY_REVIEW: z.boolean(), MORNING_PLAN: z.boolean(), SESSION_INVITE: z.boolean() }).partial().optional(),
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

  // "Not now". For SESSION_INVITE this also keeps the invitation away for the next 3 days (see nudgeEngine.inviteVariant).
  r.post('/:type/dismiss', validate({ params: z.object({ type: nudgeType }) }), asyncHandler(async (req, res) => {
    const u = await d.db.user.findUnique({ where: { id: req.user.id } });
    const date = localClock(u?.timezone).date;
    const done = await d.db.nudgeLog.updateMany({ where: { userId: req.user.id, date, type: req.params.type }, data: { dismissedAt: new Date() } });
    if (!done.count) throw notFound('Nudge not found');
    void d.telemetry.track(req.user.id, 'action_dismissed', { kind: req.params.type, surface: 'NUDGE' });
    res.status(204).end();
  }));
  return r;
}

/** Cards of the Today feed are ordered light first on a light day (after a short night). */
const LIGHT_NUDGES = new Set<string>(['WIND_DOWN', 'MOOD_CHECKIN', 'SESSION_INVITE']);
const LIGHT_KINDS = new Set<string>(['BREATHING', 'GROUNDING', 'SOUNDS', 'SLEEP', 'JOURNAL', 'CRISIS']);

/**
 * GET /today/feed: everything the in-app Today screen needs in one call.
 * Every card carries `reason`: one localized line saying why it is shown (built from the rule that fired, never a number or a score).
 * With risk signals present the feed holds no tasks: no plan focus, no suggestions except the crisis support cards, only the support nudge.
 */
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
    const level = parseLevel(u?.profile?.suggestionLevel);
    const since = new Date(Date.now() - (TREND_DAYS + 3) * 86_400_000);
    const risk = await userHasRisk(d.db, d.cipher, uid);
    // A short night shrinks today's still-planned step once and makes the day light (rule-based, no model).
    const light = risk ? { lightDay: false, adaptedIds: [] as string[] } : await adaptTodayForSleep(d.db, uid, tz, u?.locale === 'bn' ? 'bn' : 'en');
    const [settings, sleeps, lastCheckIn, morning, summary, latestSummary, weekActions, action, goal, logs, checkins7, lastInvite] = await Promise.all([
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
      d.db.checkIn.findMany({ where: { userId: uid, createdAt: { gte: since } }, select: { mood: true, stress: true, createdAt: true } }),
      d.db.nudgeLog.findFirst({ where: { userId: uid, type: 'SESSION_INVITE' }, orderBy: { date: 'desc' } }),
    ]);
    const bedtime = gradualBedtime(sleeps.map((s) => s.bedtime), desired);
    const windDownAt = buildRoutine(bedtime)[0]!.at;
    const lastLocal = lastCheckIn ? localClock(tz, lastCheckIn.createdAt).date : null;

    // SESSION_INVITE input: the last TREND_DAYS days of the person's own numbers (never sent anywhere, never shown).
    const dayAvg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const trendDays: TrendDay[] = lastDays(today, TREND_DAYS).map((date) => {
      const cs = checkins7.filter((c) => localClock(tz, c.createdAt).date === date);
      const sl = sleeps.find((s) => s.date === date);
      return { date, mood: dayAvg(cs.map((c) => c.mood)), stress: dayAvg(cs.map((c) => c.stress)), sleepMin: sl?.durationMin ?? null };
    });
    const invite = { trend: computeTrend(trendDays), riskSignals: risk, daysSinceLast: lastInvite ? daysBetween(lastInvite.date, today) : null, level };

    const due = dueNudges({
      now: new Date(), nowMin: clock.minutes, dow: clock.dow, settings, morningCheckInToday: !!morning,
      daysSinceCheckIn: lastLocal ? daysBetween(lastLocal, today) : null,
      accountAgeDays: u ? daysBetween(localClock(tz, u.createdAt).date, today) : 0,
      tonightBedtime: bedtime, weeklyReviewSaved: !!summary, weekActions: weekActions.length, invite,
    });
    let { show, logNew } = applyDailyCap(due, logs.map((l) => ({ type: l.type as NudgeType, dismissed: !!l.dismissedAt })), dailyCapFor(level));
    if (risk) { show = show.filter((t) => t === 'SESSION_INVITE'); logNew = logNew.filter((t) => t === 'SESSION_INVITE'); } // risk signals: support only, no tasks
    for (const type of logNew) await d.db.nudgeLog.upsert({ where: { userId_date_type: { userId: uid, date: today, type } }, create: { userId: uid, date: today, type }, update: {} });

    const supportCards: ActionCard[] = crisisItems().map((i) => toCard(i.def, u?.locale, 'TODAY', 'risk_support'));
    const nudges = show.map((type) => {
      if (type === 'SESSION_INVITE') {
        const variant = risk ? 'SUPPORT' : 'INVITE';
        const c = variant === 'SUPPORT' ? pick(SUPPORT_NUDGE_COPY, u?.locale) : NUDGE_COPY.SESSION_INVITE[lang];
        void d.telemetry.track(uid, 'action_offered', { kind: 'SESSION_INVITE', surface: 'NUDGE' });
        return {
          type, title: c.title, body: c.body, cta: variant === 'SUPPORT' ? 'support' : NUDGE_CTA[type], variant,
          reason: reasonText(variant === 'SUPPORT' ? 'nudge_SUPPORT' : 'nudge_SESSION_INVITE', u?.locale),
          primary: variant === 'INVITE' ? { label: pick(START_SESSION_LABEL, u?.locale), deepLink: { route: 'Tabs', params: { screen: 'SessionsTab' } } } : null,
          notNowLabel: pick({ en: 'Not now', bn: 'এখন নয়', hi: 'अभी नहीं', ne: 'अहिले होइन' }, u?.locale),
          options: variant === 'SUPPORT' ? supportCards : [],
        };
      }
      const c = NUDGE_COPY[type][lang];
      return { type, title: c.title, body: fill(c.body, { bedtime }), cta: NUDGE_CTA[type], reason: reasonText(`nudge_${type}` as ReasonKey, u?.locale) };
    });
    const insights: { kind: InsightKind; title: string; body: string; value: number | string | null; reason: string }[] = [];
    const card = (kind: InsightKind, n: number | string) => {
      const c = INSIGHT_COPY[kind][lang];
      insights.push({ kind, title: c.title, body: fill(c.body, { n }), value: n, reason: reasonText(`insight_${kind}` as ReasonKey, u?.locale) });
    };
    const doneWeek = weekActions.filter((a) => a.status === 'DONE' || a.status === 'PARTIAL').length;
    if (doneWeek > 0) card('KAIZEN_WEEK', doneWeek);
    const scores = sleeps.slice(0, 7).map((s) => s.score);
    if (scores.length >= 3) card('SLEEP_TREND', Math.round(scores.reduce((t, x) => t + x, 0) / scores.length));
    const moods = checkins7.filter((c) => c.createdAt >= new Date(Date.now() - 8 * 86_400_000)).map((c) => c.mood);
    if (moods.length >= 3) card('MOOD_WEEK', Math.round((moods.reduce((t, x) => t + x, 0) / moods.length) * 10) / 10);
    if (latestSummary) card('WEEKLY_SUMMARY', latestSummary.id);

    // Suggestions from the action menu (rule-based, same registry as the session chat). Crisis cards only when risk signals are present.
    const menu = await buildMenu({ db: d.db, cipher: d.cipher }, uid, { surface: 'TODAY', max: 3, voiceEnabled: d.config.VOICE_ENABLED === '1' }).catch(() => null);
    const suggestions: ActionCard[] = menu ? menuCards(menu, 'TODAY') : [];

    const plan = {
      focus: risk ? null : action?.title ?? goal?.title ?? null, kaizenActionId: risk ? null : action?.id ?? null, tonightBedtime: bedtime, windDownAt, morningCheckInDone: !!morning,
      reason: risk ? null : light.lightDay ? reasonText('sleep_short', u?.locale) : action || goal ? reasonText('plan_focus', u?.locale) : null,
    };
    // Display order of the cards. On a light day the light ones come first (stable otherwise).
    const keys: { key: string; light: boolean }[] = [
      ...(plan.focus ? [{ key: 'plan', light: true }] : []),
      ...nudges.map((n) => ({ key: `nudge:${n.type}`, light: LIGHT_NUDGES.has(n.type) })),
      ...suggestions.map((s) => ({ key: `suggestion:${s.id}`, light: LIGHT_KINDS.has(s.kind) || s.minutes <= 3 })),
      ...insights.map((i) => ({ key: `insight:${i.kind}`, light: true })),
    ];
    const order = (light.lightDay ? [...keys.filter((k) => k.light), ...keys.filter((k) => !k.light)] : keys).map((k) => k.key);

    res.json({ data: {
      date: today, quietNow: inQuietHours(clock.minutes, settings.quietStart, settings.quietEnd), snoozedUntil: settings.snoozedUntil,
      lightDay: light.lightDay, riskMode: risk, suggestionLevel: level, order,
      plan, nudges, insights, suggestions,
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
