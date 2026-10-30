import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { buildReport, tagStats } from '../../services/reportService.js';
import { buildRoutine, gradualBedtime } from '../../services/sleepService.js';
import { addDays, fromMinutes, lastDays, localDate, toMinutes } from '../../utils/dates.js';
import type { Deps } from '../deps.js';

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const trend = (recent: number | null, before: number | null) => (recent == null || before == null ? null : Math.round((recent - before) * 10) / 10);

export function insightsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function who(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as 'en' | 'bn', desired: typeof prefs.desiredBedtime === 'string' ? (prefs.desiredBedtime as string) : '22:30' };
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
    const lowSleep = recent[0] && recent[0].rested <= 4;
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
  r.post('/analysis', d.messageLimiter, asyncHandler(async (req, res) => {
    const { tz, lang } = await who(req.user.id);
    const { list } = await collect(req.user.id, tz, 7);
    const data = list.filter((x) => x.checkIns || x.sleepScore != null || x.kaizen);
    const fallback = lang === 'bn' ? 'এখনও যথেষ্ট তথ্য নেই। কয়েকদিন check-in ও Sleep Diary পূরণ করলে আমি আপনার নিজের pattern দেখাতে পারব।' : 'Not enough data yet. After a few days of check-ins and sleep diary entries I can show your own patterns.';
    if (data.length < 2) { res.json({ data: { text: fallback, ai: false } }); return; }
    const facts = data.map((x) => `${x.date}: mood ${x.mood ?? '-'}, stress ${x.stress ?? '-'}, energy ${x.energy ?? '-'}, sleep score ${x.sleepScore ?? '-'}, sleep h ${x.sleepHours ?? '-'}, kaizen ${x.kaizen ?? '-'}`).join('\n');
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You are Nivora's wellness analyst. From the user's own last-7-days self-reported numbers write 3-5 short sentences: one pattern you notice (e.g. stress vs sleep), one encouraging observation, and ONE tiny suggestion for tomorrow. Use soft language. Never diagnose, never imply medical conclusions, never compare with other people. Reply in ${lang === 'bn' ? 'Bangla (বাংলা) script' : 'English'}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 350 });
      res.json({ data: { text: out.content.trim() || fallback, ai: !!out.content.trim() } });
    } catch { res.json({ data: { text: fallback, ai: false } }); }
  }));
  return r;
}
