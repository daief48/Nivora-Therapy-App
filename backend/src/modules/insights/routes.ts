import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { buildReport, tagStats } from '../../services/reportService.js';
import { buildRoutine, gradualBedtime } from '../../services/sleepService.js';
import { addDays, fromMinutes, lastDays, localDate, toMinutes } from '../../utils/dates.js';
import { checkOutput } from '../../services/safetyService.js';
import { outputOk, parseJsonObject } from '../../services/aiOutput.js';
import { seasonFromMood } from '../../services/gardenService.js';
import { computeMonthly, factsFor, MIN_DAYS_LOGGED, numbersMatch, sentenceCount, type DayRow } from '../../services/monthlyStats.js';
import { copyLang, fill, MONTHLY_COPY } from '../../services/wellnessCopy.js';
import { requireConsent } from '../consents/consentService.js';
import { parseLevel } from '../../services/actionMenu.js';
import { patternCards, practiceBlock } from '../../services/monthlyExtras.js';
import { userHasRisk } from '../../services/riskState.js';
import type { Deps } from '../deps.js';

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const trend = (recent: number | null, before: number | null) => (recent == null || before == null ? null : Math.round((recent - before) * 10) / 10);

export function insightsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function who(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as 'en' | 'bn', locale: u?.locale ?? 'en', desired: typeof prefs.desiredBedtime === 'string' ? (prefs.desiredBedtime as string) : '22:30' };
  }

  async function collect(userId: string, tz: string, days: number) {
    const today = localDate(tz);
    const from = addDays(today, -(days - 1));
    const since = new Date(Date.now() - (days + 1) * 86_400_000);
    const [checkins, sleeps, actions] = await Promise.all([
      d.db.checkIn.findMany({ where: { userId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } }),
      d.db.sleepEntry.findMany({ where: { userId, date: { gte: from } } }),
      d.db.kaizenAction.findMany({ where: { userId, date: { gte: from } } }),
    ]);
    const list = lastDays(today, days).map((date) => {
      const cs = checkins.filter((c) => localDate(tz, c.createdAt) === date);
      const sl = sleeps.find((s) => s.date === date);
      const ka = actions.find((a) => a.date === date);
      return {
        date, checkIns: cs.length, mood: avg(cs.map((c) => c.mood)), stress: avg(cs.map((c) => c.stress)), energy: avg(cs.map((c) => c.energy)),
        sleepScore: sl?.score ?? null, sleepHours: sl ? Math.round((sl.durationMin / 6)) / 10 : null, kaizen: ka?.status ?? null, micro: ka?.micro ?? false,
      };
    });
    return { today, list, checkins, sleeps, actions };
  }

  r.get('/timeline', validate({ query: z.object({ days: z.coerce.number().int().min(3).max(60).default(7) }) }), asyncHandler(async (req, res) => {
    const { days } = q<{ days: number }>(req);
    const { tz } = await who(req.user.id);
    const { list } = await collect(req.user.id, tz, days);
    res.json({ data: list });
  }));

  r.get('/summary', asyncHandler(async (req, res) => {
    const { tz } = await who(req.user.id);
    const { list, checkins, sleeps, actions } = await collect(req.user.id, tz, 14);
    const recent = list.slice(7), before = list.slice(0, 7);
    const col = (rows: typeof list, k: 'mood' | 'stress' | 'energy' | 'sleepScore') => avg(rows.map((x) => x[k]).filter((v): v is number => v != null));
    const kz = (rows: typeof list) => rows.filter((x) => x.kaizen === 'DONE' || x.kaizen === 'PARTIAL').length;
    const bedtimes = sleeps.map((s) => toMinutes(s.bedtime));
    const spread = bedtimes.length > 1 ? Math.round(Math.max(...bedtimes) - Math.min(...bedtimes)) : null;
    const totalCompleted = await d.db.kaizenAction.count({ where: { userId: req.user.id, status: { in: ['DONE', 'PARTIAL'] } } });
    res.json({ data: {
      checkInsLast7: recent.reduce((s, x) => s + x.checkIns, 0),
      mood: { avg: col(recent, 'mood'), change: trend(col(recent, 'mood'), col(before, 'mood')) },
      stress: { avg: col(recent, 'stress'), change: trend(col(recent, 'stress'), col(before, 'stress')) },
      energy: { avg: col(recent, 'energy'), change: trend(col(recent, 'energy'), col(before, 'energy')) },
      sleep: { avgScore: col(recent, 'sleepScore'), change: trend(col(recent, 'sleepScore'), col(before, 'sleepScore')), nights: sleeps.length, bedtimeSpreadMin: spread },
      kaizen: { doneLast7: kz(recent), donePrev7: kz(before), restarts: actions.filter((a) => a.micro).length, totalCompleted },
      journalCheckIns: checkins.filter((c) => c.noteEncrypted).length,
    } });
  }));

  // Reason tags: the user's own averages when a tag was present vs overall. Small samples are hidden.
  r.get('/tags', validate({ query: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }) }), asyncHandler(async (req, res) => {
    const { days } = q<{ days: number }>(req);
    const rows = await d.db.checkIn.findMany({ where: { userId: req.user.id, createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }, select: { mood: true, stress: true, energy: true, tags: true } });
    res.json({ data: { days, ...tagStats(rows) } });
  }));

  r.get('/report', validate({ query: z.object({ days: z.coerce.number().int().min(3).max(30).default(7) }) }), asyncHandler(async (req, res) => {
    const { days } = q<{ days: number }>(req);
    const { tz, lang } = await who(req.user.id);
    const { list, checkins, sleeps } = await collect(req.user.id, tz, days * 2);
    const cur = list.slice(days), prev = list.slice(0, days);
    const from = cur[0]!.date;
    const inRange = checkins.filter((c) => localDate(tz, c.createdAt) >= from);
    const bed = sleeps.filter((s) => s.date >= from).map((s) => toMinutes(s.bedtime));
    const spread = bed.length > 1 ? Math.round(Math.max(...bed) - Math.min(...bed)) : null;
    res.json({ data: buildReport({ lang, days, cur, prev, checkins: inRange, bedtimeSpreadMin: spread }) });
  }));

  // Personalised next-day plan: one primary focus, everything else optional.
  r.get('/plan', asyncHandler(async (req, res) => {
    const info = await who(req.user.id);
    const today = localDate(info.tz);
    const [recent, evening, morning, action, goal] = await Promise.all([
      d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 7 }),
      d.db.checkIn.findFirst({ where: { userId: req.user.id, kind: 'EVENING' }, orderBy: { createdAt: 'desc' } }),
      d.db.checkIn.findFirst({ where: { userId: req.user.id, kind: 'MORNING', createdAt: { gte: new Date(Date.now() - 20 * 3600_000) } } }),
      d.db.kaizenAction.findFirst({ where: { userId: req.user.id, date: today } }),
      d.db.kaizenGoal.findFirst({ where: { userId: req.user.id, status: 'ACTIVE' } }),
    ]);
    const bed = gradualBedtime(recent.map((s) => s.bedtime), info.desired);
    const wind = buildRoutine(bed, evening?.stress)[0]!.at;
    const lowSleep = recent[0]?.rested != null && recent[0].rested <= 4;
    const highStress = (morning?.stress ?? 0) >= 7;
    const bn = info.lang === 'bn';
    const items = [
      { id: 'morning', time: '08:00', done: !!morning, title: bn ? '২ মিনিটের সকালের check-in' : '2-minute morning check-in' },
      { id: 'afternoon', time: '15:00', done: false, title: bn ? (highStress ? '৫ মিনিট শ্বাসের বিরতি (আজ বিশেষভাবে)' : '৫ মিনিট শ্বাসের বিরতি') : (highStress ? '5-minute breathing break (especially today)' : '5-minute breathing break') },
      { id: 'evening', time: '20:00', done: false, title: bn ? '৩ মিনিটের সন্ধ্যার reflection' : '3-minute evening reflection' },
      { id: 'night', time: wind, done: false, title: bn ? 'রাতের wind-down রুটিন' : 'Night wind-down routine' },
    ];
    const focus = action?.title ?? (goal ? goal.title : bn ? 'আজ একটি ছোট লক্ষ্য বেছে নিন' : 'Choose one small goal today');
    const note = lowSleep ? (bn ? 'গতরাতে ঘুম কম লেগেছে — আজ হালকা দিন রাখুন, একটি পদক্ষেপই যথেষ্ট।' : 'Last night felt short - keep today light. One small step is enough.') : null;
    res.json({ data: { focus, kaizenActionId: action?.id ?? null, bedtime: bed, items, note } });
  }));

  // AI Daily Wellness Analysis: observations from the user's own data only, never a diagnosis.
  // Consent is checked first (403 CONSENT_REQUIRED, like journal AI); the rule-based text is only for AI failures or too little data.
  r.post('/analysis', d.messageLimiter, asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI daily analysis needs your explicit consent to read your check-ins and sleep');
    const { tz, lang, locale } = await who(req.user.id);
    const { list } = await collect(req.user.id, tz, 7);
    const data = list.filter((x) => x.checkIns || x.sleepScore != null || x.kaizen);
    const fallback = lang === 'bn' ? 'এখনও যথেষ্ট তথ্য নেই। কয়েকদিন check-in ও Sleep Diary পূরণ করলে আমি আপনার নিজের pattern দেখাতে পারব।' : 'Not enough data yet. After a few days of check-ins and sleep diary entries I can show your own patterns.';
    if (data.length < 2) { res.json({ data: { text: fallback, ai: false } }); return; }
    const facts = data.map((x) => `${x.date}: mood ${x.mood ?? '-'}, stress ${x.stress ?? '-'}, energy ${x.energy ?? '-'}, sleep score ${x.sleepScore ?? '-'}, sleep h ${x.sleepHours ?? '-'}, kaizen ${x.kaizen ?? '-'}`).join('\n');
    const t0 = Date.now();
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You are Nivora's wellness analyst. From the user's own last-7-days self-reported numbers write 3-5 short sentences: one pattern you notice (e.g. stress vs sleep), one encouraging observation, and ONE tiny suggestion for tomorrow. Use soft language. Never diagnose, never imply medical conclusions, never compare with other people. Reply in ${aiReplyLanguage(locale)}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 350 });
      const text = out.content.trim();
      // Every model output goes through checkOutput; anything flagged is replaced by the rule-based text (ai:false).
      void d.telemetry.model(req.user.id, 'daily_analysis', Date.now() - t0, !(text && checkOutput(text).ok));
      if (text && checkOutput(text).ok) { res.json({ data: { text, ai: true } }); return; }
      res.json({ data: { text: fallback, ai: false } });
    } catch { void d.telemetry.model(req.user.id, 'daily_analysis', Date.now() - t0, true); res.json({ data: { text: fallback, ai: false } }); }
  }));

  /**
   * Monthly patterns. Statistics are computed here without any model. Only when there is enough data AND the user has consented
   * (WELLNESS_AI_SHARING) does the model phrase the computed facts; every number it writes must appear in those facts, else the
   * template (ai:false) is returned. `ai=0` skips the model entirely: no consent needed, narrative is the template.
   */
  r.get('/monthly', d.messageLimiter, validate({ query: z.object({ days: z.coerce.number().int().min(14).max(60).default(30), ai: z.enum(['0', '1']).default('1') }) }), asyncHandler(async (req, res) => {
    const { days, ai } = q<{ days: number; ai: '0' | '1' }>(req);
    const { tz, locale } = await who(req.user.id);
    const { today, list } = await collect(req.user.id, tz, days);
    const from = addDays(today, -(days - 1));
    const activity = await d.db.dailyActivity.findMany({ where: { userId: req.user.id, date: { gte: from } } });
    const rows: DayRow[] = list.map((x) => {
      const a = activity.find((y) => y.date === x.date);
      const active = a && (a.walkingMin != null || a.exerciseMin != null) ? (a.walkingMin ?? 0) + (a.exerciseMin ?? 0) : null;
      return { date: x.date, mood: x.mood, stress: x.stress, energy: x.energy, sleepScore: x.sleepScore, sleepHours: x.sleepHours, kaizenDone: x.kaizen == null ? null : x.kaizen === 'DONE' || x.kaizen === 'PARTIAL' ? 1 : 0, steps: a?.steps ?? null, activeMin: active };
    });
    const stats = computeMonthly(rows);
    const season = seasonFromMood(stats.averages.mood);
    const share = { // aggregates only: no personal text, safe to render as a share card
      periodDays: stats.periodDays, daysLogged: stats.daysLogged, avgMood: stats.averages.mood, avgStress: stats.averages.stress, avgSleepScore: stats.averages.sleepScore,
      kaizenDone: stats.kaizenDone, season, strongestPattern: stats.correlations[0] ? { a: stats.correlations[0].a, b: stats.correlations[0].b, direction: stats.correlations[0].direction, strength: stats.correlations[0].strength } : null,
    };
    // Rule-based extras (no model): the practice block and one next-step button per pattern card (none with risk signals or when suggestions are off).
    const [riskMode, prof] = await Promise.all([userHasRisk(d.db, d.cipher, req.user.id), d.db.userProfile.findUnique({ where: { userId: req.user.id }, select: { suggestionLevel: true } })]);
    const practice = await practiceBlock(d.db, d.cipher, req.user.id, from, locale);
    const patterns = stats.enough ? patternCards(stats, locale, { riskMode, level: parseLevel(prof?.suggestionLevel) }) : [];
    if (!stats.enough) { res.json({ data: { ...stats, minDaysRequired: MIN_DAYS_LOGGED, narrative: null, season, share, practice, patterns, riskMode } }); return; }

    const c = MONTHLY_COPY[copyLang(locale)];
    const tpl = () => ({
      headline: fill(c.headline, { days }),
      text: [fill(c.days, { n: stats.daysLogged }), stats.averages.mood != null ? fill(c.mood, { n: stats.averages.mood }) : '', stats.averages.sleepScore != null ? fill(c.sleep, { n: stats.averages.sleepScore }) : '', fill(c.kaizen, { n: stats.kaizenDone }), c.close].filter(Boolean).join(' '),
      ai: false,
    });
    let narrative = tpl();
    if (ai === '1') {
      await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI monthly summary needs your explicit consent to read your check-ins, sleep and activity');
      const facts = factsFor(stats);
      const t0 = Date.now();
      try {
        const out = await d.glm.chat([
          { role: 'system', content: `You phrase a person's monthly wellness patterns for a calm self-care app. Use ONLY the facts given. Reply ONLY with JSON: {"headline":"1-3 short sentences","text":"4-6 short, warm sentences"}. Copy any number exactly as written in the facts and add no other numbers, dates or percentages. Say things "tended to go together", never that one thing caused another. Never diagnose, never mention medication or supplements, never shame, never compare the person with other people, no advice beyond one tiny gentle idea. Reply in ${aiReplyLanguage(locale)}.` },
          { role: 'user', content: facts.join('\n') },
        ], { maxTokens: 450 });
        const j = parseJsonObject(out.content);
        const headline = typeof j?.headline === 'string' ? j.headline.trim() : '', text = typeof j?.text === 'string' ? j.text.trim() : '';
        const hs = sentenceCount(headline), ts = sentenceCount(text);
        const accepted = !!(headline && text && hs >= 1 && hs <= 3 && ts >= 4 && ts <= 6 && outputOk(headline, text) && numbersMatch(`${headline} ${text}`, facts));
        if (accepted) narrative = { headline, text, ai: true };
        void d.telemetry.model(req.user.id, 'monthly', Date.now() - t0, !accepted);
      } catch { void d.telemetry.model(req.user.id, 'monthly', Date.now() - t0, true); /* keep the template */ }
    }
    res.json({ data: { ...stats, minDaysRequired: MIN_DAYS_LOGGED, narrative, season, share, practice, patterns, riskMode } });
  }));
  return r;
}
