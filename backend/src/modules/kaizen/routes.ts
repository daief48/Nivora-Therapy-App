import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { buildAction, growthStage, kaizenMessage, KAIZEN_CATEGORIES, planNext, TEMPLATES, type KaizenCategory, type Lang } from '../../services/kaizenEngine.js';
import { addDays, localDate } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const id = z.object({ id: z.string().uuid() });

export function kaizenRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function who(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as Lang };
  }
  const goalView = (g: any) => ({ id: g.id, title: g.title, category: g.category, targetDirection: g.targetDirection, status: g.status, currentTarget: g.currentTarget, createdAt: g.createdAt });
  const actionView = (a: any) => ({
    id: a.id, goalId: a.goalId, date: a.date, title: a.title, description: a.description, targetValue: a.targetValue, unit: a.unit, difficulty: a.difficulty,
    micro: a.micro, status: a.status, difficultyFeedback: a.difficultyFeedback, completedAt: a.completedAt, reflected: !!a.reflectedAt,
    feltLevel: a.feltLevel, usefulness: a.usefulness, nextPreference: a.nextPreference,
  });

  /** Creates today's single primary action for the goal (idempotent). */
  async function ensureToday(goal: any, userId: string, today: string, lang: Lang) {
    const existing = await d.db.kaizenAction.findUnique({ where: { goalId_date: { goalId: goal.id, date: today } } });
    if (existing) return existing;
    const hist = await d.db.kaizenAction.findMany({ where: { goalId: goal.id }, orderBy: { date: 'desc' }, take: 14 });
    const plan = planNext(goal.category, goal.currentTarget, hist.map((h) => ({
      date: h.date, status: h.status, targetValue: h.targetValue, micro: h.micro, difficultyFeedback: h.difficultyFeedback, nextPreference: h.nextPreference,
    })), today);
    const text = buildAction(goal.category as KaizenCategory, plan, lang);
    if (!plan.micro && plan.target !== goal.currentTarget) await d.db.kaizenGoal.update({ where: { id: goal.id }, data: { currentTarget: plan.target } });
    return d.db.kaizenAction.create({ data: {
      goalId: goal.id, userId, date: today, title: text.title, description: text.description, targetValue: plan.target, unit: plan.unit, difficulty: plan.difficulty, micro: plan.micro,
    } });
  }

  async function progress(userId: string, today: string) {
    const week = addDays(today, -6);
    const [done, weekRows, restarts, total] = await Promise.all([
      d.db.kaizenAction.count({ where: { userId, status: { in: ['DONE', 'PARTIAL'] } } }),
      d.db.kaizenAction.findMany({ where: { userId, date: { gte: week } }, orderBy: { date: 'asc' } }),
      d.db.kaizenAction.count({ where: { userId, micro: true } }),
      d.db.kaizenAction.count({ where: { userId } }),
    ]);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(week, i);
      const a = weekRows.find((x) => x.date === date);
      return { date, status: a?.status ?? null };
    });
    return { completed: done, stage: growthStage(done), restarts, total, week: days, consistency7: days.filter((x) => x.status === 'DONE' || x.status === 'PARTIAL').length };
  }

  r.get('/categories', (_req, res) => {
    res.json({ data: KAIZEN_CATEGORIES.map((c) => ({ category: c, en: TEMPLATES[c].en.title.replace('{n} {u}', '').trim(), unit: TEMPLATES[c].unit, start: TEMPLATES[c].start })) });
  });

  r.get('/goals', asyncHandler(async (req, res) => {
    const goals = await d.db.kaizenGoal.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: goals.map(goalView) });
  }));

  r.post('/goals', validate({ body: z.object({
    title: z.string().trim().min(1).max(120), category: z.enum(KAIZEN_CATEGORIES), targetDirection: z.string().trim().max(300).optional(),
  }) }), asyncHandler(async (req, res) => {
    // One primary focus at a time keeps the cognitive load low: earlier active goals are paused, not deleted.
    await d.db.kaizenGoal.updateMany({ where: { userId: req.user.id, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    const g = await d.db.kaizenGoal.create({ data: { userId: req.user.id, ...req.body, currentTarget: TEMPLATES[req.body.category as KaizenCategory].start } });
    res.status(201).json({ data: goalView(g) });
  }));

  r.patch('/goals/:id', validate({ params: id, body: z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(), title: z.string().trim().min(1).max(120).optional() }) }),
    asyncHandler(async (req, res) => {
      const g = await d.db.kaizenGoal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
      if (!g) throw notFound('Goal not found');
      if (req.body.status === 'ACTIVE') await d.db.kaizenGoal.updateMany({ where: { userId: req.user.id, status: 'ACTIVE', id: { not: g.id } }, data: { status: 'PAUSED' } });
      const u = await d.db.kaizenGoal.update({ where: { id: g.id }, data: req.body });
      res.json({ data: goalView(u) });
    }));

  r.delete('/goals/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const done = await d.db.kaizenGoal.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Goal not found');
    res.status(204).end();
  }));

  r.get('/today', asyncHandler(async (req, res) => {
    const { tz, lang } = await who(req.user.id);
    const today = localDate(tz);
    const goal = await d.db.kaizenGoal.findFirst({ where: { userId: req.user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    const prog = await progress(req.user.id, today);
    if (!goal) { res.json({ data: { needsGoal: true, goal: null, action: null, progress: prog } }); return; }
    const action = await ensureToday(goal, req.user.id, today, lang);
    res.json({ data: { needsGoal: false, goal: goalView(goal), action: actionView(action), progress: prog } });
  }));

  r.get('/progress', asyncHandler(async (req, res) => {
    const { tz } = await who(req.user.id);
    const today = localDate(tz);
    const recent = await d.db.kaizenAction.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 21, include: { goal: { select: { title: true } } } });
    res.json({ data: { ...(await progress(req.user.id, today)), recent: recent.map((a) => ({ ...actionView(a), goalTitle: a.goal.title })) } });
  }));

  r.post('/actions/:id/complete', validate({ params: id, body: z.object({
    level: z.enum(['FULL', 'PARTIAL', 'SKIPPED']), feedback: z.enum(['EASY', 'OK', 'HARD', 'OVERWHELMED']).optional(), note: z.string().trim().max(1000).optional(),
  }) }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!a) throw notFound('Action not found');
    const { lang } = await who(req.user.id);
    const prevDone = await d.db.kaizenAction.count({ where: { userId: req.user.id, status: { in: ['DONE', 'PARTIAL'] }, date: { lt: a.date } } });
    const lastBefore = await d.db.kaizenAction.findFirst({ where: { userId: req.user.id, date: { lt: a.date } }, orderBy: { date: 'desc' } });
    const status = req.body.level === 'FULL' ? 'DONE' : req.body.level;
    const u = await d.db.kaizenAction.update({ where: { id: a.id }, data: {
      status, difficultyFeedback: req.body.feedback ?? null, noteEncrypted: req.body.note ? d.cipher.encrypt(req.body.note) : null,
      completedAt: status === 'SKIPPED' ? null : new Date(),
    } });
    const returning = status !== 'SKIPPED' && (!lastBefore || lastBefore.status === 'SKIPPED' || a.micro) && prevDone > 0;
    const message = kaizenMessage(status === 'DONE' ? (returning ? 'RETURN' : 'FULL') : status === 'PARTIAL' ? 'PARTIAL' : 'SKIPPED', lang);
    res.json({ data: { ...actionView(u), message } });
  }));

  r.post('/actions/:id/reflect', validate({ params: id, body: z.object({
    felt: z.number().int().min(1).max(5), usefulness: z.number().int().min(1).max(5), next: z.enum(['SAME', 'EASIER', 'HARDER']), comment: z.string().trim().max(1000).optional(),
  }) }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!a) throw notFound('Action not found');
    const u = await d.db.kaizenAction.update({ where: { id: a.id }, data: {
      feltLevel: req.body.felt, usefulness: req.body.usefulness, nextPreference: req.body.next,
      commentEncrypted: req.body.comment ? d.cipher.encrypt(req.body.comment) : null, reflectedAt: new Date(),
    } });
    res.json({ data: actionView(u) });
  }));

  // User control: make today's step easier / harder or swap its focus without breaking the engine's history.
  r.post('/actions/:id/adjust', validate({ params: id, body: z.object({ direction: z.enum(['easier', 'harder']) }) }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: { goal: true } });
    if (!a) throw notFound('Action not found');
    const { lang } = await who(req.user.id);
    const tpl = TEMPLATES[a.goal.category as KaizenCategory];
    const target = Math.max(1, Math.min(tpl.max, a.targetValue + (req.body.direction === 'easier' ? -1 : 1)));
    const text = buildAction(a.goal.category as KaizenCategory, { target, unit: a.unit as 'minutes' | 'breaths', micro: a.micro, difficulty: a.difficulty, reason: 'user' }, lang);
    const u = await d.db.kaizenAction.update({ where: { id: a.id }, data: { targetValue: target, title: text.title, description: text.description } });
    if (!a.micro) await d.db.kaizenGoal.update({ where: { id: a.goalId }, data: { currentTarget: target } });
    res.json({ data: actionView(u) });
  }));

  // Weekly review built from the user's own data; AI only phrases it, with a rule-based fallback.
  r.post('/weekly-review', d.messageLimiter, asyncHandler(async (req, res) => {
    const { tz, lang } = await who(req.user.id);
    const today = localDate(tz);
    const rows = await d.db.kaizenAction.findMany({ where: { userId: req.user.id, date: { gte: addDays(today, -6) } }, orderBy: { date: 'asc' }, include: { goal: { select: { title: true } } } });
    const done = rows.filter((x) => x.status === 'DONE' || x.status === 'PARTIAL').length;
    const restarts = rows.filter((x) => x.micro).length;
    const hard = rows.filter((x) => x.difficultyFeedback === 'HARD' || x.difficultyFeedback === 'OVERWHELMED').length;
    const fallback = lang === 'bn'
      ? `এই সপ্তাহে ${rows.length}টি ছোট পদক্ষেপের মধ্যে ${done}টি করেছেন।${restarts ? ` ${restarts}বার ছোট করে আবার শুরু করেছেন — এটাও উন্নতি।` : ''} পরের সপ্তাহে একটি বিষয়েই মন দিন, এবং কঠিন লাগলে আরও ছোট করুন।`
      : `This week you completed ${done} of ${rows.length} small steps.${restarts ? ` You restarted gently ${restarts} time(s) - that is progress too.` : ''} Next week, keep one focus and shrink the step whenever it feels hard.`;
    if (!rows.length) { res.json({ data: { text: lang === 'bn' ? 'এই সপ্তাহে এখনও কোনো পদক্ষেপ নেই। আজ একটি ছোট দিয়ে শুরু করা যাক।' : 'No steps this week yet. Let us start with one tiny step today.', ai: false } }); return; }
    try {
      const facts = rows.map((x) => `${x.date}: "${x.title}" -> ${x.status}${x.difficultyFeedback ? `, felt ${x.difficultyFeedback}` : ''}${x.micro ? ' (tiny restart)' : ''}`).join('\n') + `\nHard days: ${hard}.`;
      const out = await d.glm.chat([
        { role: 'system', content: `You write the Nivora weekly Kaizen review: 4-6 short sentences, warm and non-judgmental. Cover what improved, where it was hard, what to simplify, and ONE focus for next week. Never shame misses, never claim medical improvement. Reply in ${lang === 'bn' ? 'Bangla (বাংলা) script' : 'English'}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 350 });
      res.json({ data: { text: out.content.trim() || fallback, ai: !!out.content.trim() } });
    } catch { res.json({ data: { text: fallback, ai: false } }); }
  }));

  // Blossom garden: one flower per completed step. Flowers only ever grow; nothing is lost on a quiet week.
  r.get('/garden', asyncHandler(async (req, res) => {
    const { tz } = await who(req.user.id);
    const today = localDate(tz);
    const rows = await d.db.kaizenAction.findMany({ where: { userId: req.user.id, status: { in: ['DONE', 'PARTIAL'] } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { id: true, date: true } });
    const weekOf = (date: string) => { const dt = new Date(`${date}T00:00:00Z`); return addDays(date, -((dt.getUTCDay() + 6) % 7)); }; // Monday
    const perWeek = new Map<string, number>();
    for (const x of rows) perWeek.set(weekOf(x.date), (perWeek.get(weekOf(x.date)) ?? 0) + 1);
    const flowers = rows.map((x, i) => {
      const n = perWeek.get(weekOf(x.date)) ?? 1;
      return { id: x.id, date: x.date, kind: n >= 7 ? 'FULL_BLOOM' : n >= 3 ? 'BLOOM' : 'BUD', index: i };
    }).slice(-400);
    const from = addDays(today, -89);
    const counts = new Map<string, number>();
    for (const x of rows) if (x.date >= from) counts.set(x.date, (counts.get(x.date) ?? 0) + 1);
    const days = Array.from({ length: 90 }, (_, i) => { const date = addDays(from, i); return { date, count: counts.get(date) ?? 0 }; });
    res.json({ data: { total: rows.length, days, flowers } });
  }));
  return r;
}
