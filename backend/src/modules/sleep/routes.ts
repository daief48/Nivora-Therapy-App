import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { buildRoutine, durationMinutes, gradualBedtime, sleepScore } from '../../services/sleepService.js';
import { addDays, localDate } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DEFAULT_BEDTIME = '22:30';

export function sleepRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function profileInfo(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as 'en' | 'bn', desired: typeof prefs.desiredBedtime === 'string' ? (prefs.desiredBedtime as string) : DEFAULT_BEDTIME };
  }
  const view = (s: any) => ({
    id: s.id, date: s.date, bedtime: s.bedtime, wakeTime: s.wakeTime, durationMin: s.durationMin, latencyMin: s.latencyMin,
    awakenings: s.awakenings, rested: s.rested, score: s.score, note: s.noteEncrypted ? d.cipher.decrypt(s.noteEncrypted) : null,
  });

  async function routineRate(userId: string, today: string) {
    const logs = await d.db.routineLog.findMany({ where: { userId, date: { gte: addDays(today, -6) } } });
    return logs.length ? logs.reduce((s, l) => s + l.stepsDone / Math.max(1, l.stepsTotal), 0) / 7 : 0;
  }

  r.post('/', validate({ body: z.object({
    bedtime: hhmm, wakeTime: hhmm, latencyMin: z.number().int().min(0).max(600).default(15), awakenings: z.number().int().min(0).max(20).default(0),
    rested: z.number().int().min(1).max(10), note: z.string().trim().max(2000).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }) }), asyncHandler(async (req, res) => {
    const b = req.body;
    const { tz } = await profileInfo(req.user.id);
    const date = b.date ?? localDate(tz);
    const durationMin = durationMinutes(b.bedtime, b.wakeTime);
    const prev = await d.db.sleepEntry.findMany({ where: { userId: req.user.id, date: { lt: date } }, orderBy: { date: 'desc' }, take: 6 });
    const result = sleepScore({
      durationMin, awakenings: b.awakenings, rested: b.rested, recentBedtimes: [b.bedtime, ...prev.map((p) => p.bedtime)], routineRate: await routineRate(req.user.id, date),
    });
    const data = { bedtime: b.bedtime, wakeTime: b.wakeTime, durationMin, latencyMin: b.latencyMin, awakenings: b.awakenings, rested: b.rested, score: result.score, noteEncrypted: b.note ? d.cipher.encrypt(b.note) : null };
    const row = await d.db.sleepEntry.upsert({ where: { userId_date: { userId: req.user.id, date } }, create: { userId: req.user.id, date, ...data }, update: data });
    res.status(201).json({ data: { ...view(row), breakdown: result } });
  }));

  r.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(120).default(30) }) }), asyncHandler(async (req, res) => {
    const { limit } = q<{ limit: number }>(req);
    const rows = await d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: limit });
    const latest = rows[0];
    const breakdown = latest ? sleepScore({
      durationMin: latest.durationMin, awakenings: latest.awakenings, rested: latest.rested,
      recentBedtimes: rows.slice(0, 7).map((x) => x.bedtime), routineRate: await routineRate(req.user.id, latest.date),
    }) : null;
    res.json({ data: { entries: rows.map(view), breakdown } });
  }));

  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.sleepEntry.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Sleep entry not found');
    res.status(204).end();
  }));

  // Personalised wind-down routine + gradual bedtime shift (Kaizen applied to sleep).
  r.get('/routine', asyncHandler(async (req, res) => {
    const info = await profileInfo(req.user.id);
    const today = localDate(info.tz);
    const [recent, evening, log] = await Promise.all([
      d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 7 }),
      d.db.checkIn.findFirst({ where: { userId: req.user.id, kind: 'EVENING' }, orderBy: { createdAt: 'desc' } }),
      d.db.routineLog.findUnique({ where: { userId_date: { userId: req.user.id, date: today } } }),
    ]);
    const tonight = gradualBedtime(recent.map((x) => x.bedtime), info.desired);
    const steps = buildRoutine(tonight, evening?.stress);
    res.json({ data: { desiredBedtime: info.desired, tonightBedtime: tonight, steps, stepsDone: log?.stepsDone ?? 0, stepsTotal: steps.length - 1 } });
  }));

  r.post('/routine/log', validate({ body: z.object({ stepsDone: z.number().int().min(0).max(10), stepsTotal: z.number().int().min(1).max(10) }) }), asyncHandler(async (req, res) => {
    const { tz } = await profileInfo(req.user.id);
    const date = localDate(tz);
    const row = await d.db.routineLog.upsert({
      where: { userId_date: { userId: req.user.id, date } }, create: { userId: req.user.id, date, ...req.body }, update: req.body,
    });
    res.json({ data: { stepsDone: row.stepsDone, stepsTotal: row.stepsTotal } });
  }));

  // AI Sleep Coach: practical suggestion from the user's own diary. Falls back to a rule-based tip if the AI is unavailable.
  r.post('/coach', d.messageLimiter, asyncHandler(async (req, res) => {
    const info = await profileInfo(req.user.id);
    const rows = await d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 7 });
    if (!rows.length) {
      res.json({ data: { text: info.lang === 'bn' ? 'আগে একটি Sleep Diary এন্ট্রি যোগ করুন, তারপর আমি আপনার জন্য ব্যক্তিগত পরামর্শ দিতে পারব।' : 'Add a sleep diary entry first, then I can give you personal suggestions.', ai: false } });
      return;
    }
    const avg = (f: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + f(x), 0) / rows.length;
    const facts = `Last ${rows.length} nights. Desired bedtime ${info.desired}. Average sleep ${(avg((x) => x.durationMin) / 60).toFixed(1)} h, average awakenings ${avg((x) => x.awakenings).toFixed(1)}, average rested feeling ${avg((x) => x.rested).toFixed(1)}/10, average score ${Math.round(avg((x) => x.score))}/100. Bedtimes: ${rows.map((x) => x.bedtime).join(', ')}.`;
    const fallback = info.lang === 'bn'
      ? `গত কয়েক রাতে গড়ে ${(avg((x) => x.durationMin) / 60).toFixed(1)} ঘণ্টা ঘুমিয়েছেন। আজ রাতে wind-down রুটিন ১৫ মিনিট আগে শুরু করে দেখবেন কি?`
      : `You slept about ${(avg((x) => x.durationMin) / 60).toFixed(1)} h on average lately. Would you like to start your wind-down routine 15 minutes earlier tonight?`;
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You are the Nivora AI Sleep Coach, a calm wellness companion (not a doctor). Give ONE practical, gentle suggestion in 2-4 short sentences based only on the user's diary. Smallest useful change first (Kaizen). Never diagnose sleep disorders, never mention medication or supplements, never shame. Reply in ${info.lang === 'bn' ? 'Bangla (বাংলা) script' : 'English'}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 300 });
      res.json({ data: { text: out.content.trim() || fallback, ai: !!out.content.trim() } });
    } catch {
      res.json({ data: { text: fallback, ai: false } });
    }
  }));
  return r;
}
