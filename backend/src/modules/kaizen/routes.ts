import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { buildAction, growthStage, kaizenMessage, KAIZEN_CATEGORIES, planNext, TEMPLATES, type KaizenCategory, type Lang } from '../../services/kaizenEngine.js';
import { addDays, localDate, mondayOf } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import { outputOk } from '../../services/aiOutput.js';
import { guardFreeText } from '../../services/crisisResponse.js';
import { userHasRisk } from '../../services/riskState.js';
import type { Db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { flowerTotal, retainGoalFlowers, seasonFromMood } from '../../services/gardenService.js';
import { copyLang, RISK_NEUTRAL, SEASON_LABEL } from '../../services/wellnessCopy.js';
import { requireConsent } from '../consents/consentService.js';
import { adaptTodayForSleep } from '../../services/kaizenExtras.js';
import { reasonText } from '../../services/actionCopy.js';
import { alchemizeAction, generateSoulWeather, writePlantChronicle, generateOmikuji, coachGoalSetup, coachPdcaCheckIn } from '../../services/kaizenAiService.js';
import type { Deps } from '../deps.js';

const id = z.object({ id: z.string().uuid() });

export function kaizenRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function who(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as Lang, locale: u?.locale ?? 'en' };
  }
  const goalView = (g: any) => ({ id: g.id, title: g.title, category: g.category, targetDirection: g.targetDirection, status: g.status, currentTarget: g.currentTarget, createdAt: g.createdAt });
  const actionView = (a: any) => ({
    id: a.id, goalId: a.goalId, date: a.date, title: a.userTextEncrypted ? d.cipher.decrypt(a.userTextEncrypted) : a.title, description: a.description, targetValue: a.targetValue, unit: a.unit, difficulty: a.difficulty,
    micro: a.micro, status: a.status, difficultyFeedback: a.difficultyFeedback, completedAt: a.completedAt, reflected: !!a.reflectedAt,
    feltLevel: a.feltLevel, usefulness: a.usefulness, nextPreference: a.nextPreference,
    source: a.source ?? 'GOAL', adapted: a.adaptedBy ?? null,
  });

  /** Creates today's single primary action for the goal (idempotent). */
  async function ensureToday(goal: any, userId: string, today: string, lang: Lang) {
    const existing = await d.db.kaizenAction.findUnique({ where: { goalId_date: { goalId: goal.id, date: today } } });
    if (existing) return existing;
    const hist = await d.db.kaizenAction.findMany({ where: { goalId: goal.id }, orderBy: { date: 'desc' }, take: 14 });
    const plan = planNext(goal.category, goal.currentTarget, hist.map((h) => ({
      date: h.date, status: h.status, targetValue: h.targetValue, micro: h.micro, difficultyFeedback: h.difficultyFeedback, nextPreference: h.nextPreference, baseTarget: h.baseTarget,
    })), today);
    const text = buildAction(goal.category as KaizenCategory, plan, lang);
    if (!plan.micro && plan.target !== goal.currentTarget) await d.db.kaizenGoal.update({ where: { id: goal.id }, data: { currentTarget: plan.target } });
    return d.db.kaizenAction.create({
      data: {
        goalId: goal.id, userId, date: today, title: text.title, description: text.description, targetValue: plan.target, unit: plan.unit, difficulty: plan.difficulty, micro: plan.micro,
      }
    });
  }

  async function progress(userId: string, today: string) {
    const week = addDays(today, -6);
    const [counted, weekRows, restarts, total, garden] = await Promise.all([
      d.db.kaizenAction.count({ where: { userId, status: { in: ['DONE', 'PARTIAL'] } } }),
      d.db.kaizenAction.findMany({ where: { userId, date: { gte: week } }, orderBy: { date: 'asc' } }),
      d.db.kaizenAction.count({ where: { userId, micro: true } }),
      d.db.kaizenAction.count({ where: { userId } }),
      d.db.gardenState.findUnique({ where: { userId } }),
    ]);
    const done = counted + (garden?.carried ?? 0); // flowers carried over from deleted goals stay counted: the number never goes down
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(week, i);
      const a = weekRows.find((x) => x.date === date);
      return { date, status: a?.status ?? null };
    });
    return { completed: done, stage: growthStage(done), restarts, total, week: days, consistency7: days.filter((x) => x.status === 'DONE' || x.status === 'PARTIAL').length };
  }

  /** Today's extra steps (journal 2-minute step, a walk, the session-close step): not the primary goal's step, but they complete and count the same way. */
  async function todayExtras(userId: string, today: string) {
    const rows = await d.db.kaizenAction.findMany({ where: { userId, date: today, source: { not: 'GOAL' } }, orderBy: { createdAt: 'asc' } });
    return rows.map(actionView);
  }

  r.get('/categories', (_req, res) => {
    res.json({ data: KAIZEN_CATEGORIES.map((c) => ({ category: c, en: TEMPLATES[c].en.title.replace('{n} {u}', '').trim(), unit: TEMPLATES[c].unit, start: TEMPLATES[c].start })) });
  });

  r.get('/goals', asyncHandler(async (req, res) => {
    const goals = await d.db.kaizenGoal.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: goals.map(goalView) });
  }));

  r.post('/goals', validate({
    body: z.object({
      title: z.string().trim().min(1).max(120), category: z.enum(KAIZEN_CATEGORIES), targetDirection: z.string().trim().max(300).optional(),
    })
  }), asyncHandler(async (req, res) => {
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
    const own = await d.db.kaizenGoal.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { id: true } });
    // One transaction: the flowers are carried over and the goal is deleted together, or neither happens.
    const done = await d.db.$transaction(async (tx) => {
      if (own) await retainGoalFlowers(tx as unknown as Db, req.user.id, own.id); // flowers never decrease
      return tx.kaizenGoal.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    });
    if (!done.count) throw notFound('Goal not found');
    res.status(204).end();
  }));

  r.get('/today', asyncHandler(async (req, res) => {
    const { tz, lang, locale } = await who(req.user.id);
    const today = localDate(tz);
    const goal = await d.db.kaizenGoal.findFirst({ where: { userId: req.user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    const prog = await progress(req.user.id, today);
    // Risk signals: no step is created or returned (no card, no extras, no light-day note). The app shows support options.
    if (await userHasRisk(d.db, d.cipher, req.user.id)) {
      res.json({ data: { needsGoal: false, goal: goal ? goalView(goal) : null, action: null, progress: prog, lightDay: false, reason: null, extras: [], riskMode: true } });
      return;
    }
    if (!goal) { res.json({ data: { needsGoal: true, goal: null, action: null, progress: prog, lightDay: false, reason: null, extras: await todayExtras(req.user.id, today), riskMode: false } }); return; }
    let action = await ensureToday(goal, req.user.id, today, lang);
    // A short night makes today lighter: still-planned steps shrink once (adapted:'SLEEP_LOW') and the day is marked light with a one-line reason.
    const light = await adaptTodayForSleep(d.db, req.user.id, tz, lang);
    if (light.adaptedIds.includes(action.id)) action = (await d.db.kaizenAction.findUnique({ where: { id: action.id } })) ?? action;
    res.json({ data: { needsGoal: false, goal: goalView(goal), action: actionView(action), progress: prog, lightDay: light.lightDay, reason: light.lightDay ? reasonText('sleep_short', locale) : null, extras: await todayExtras(req.user.id, today), riskMode: false } });
  }));

  r.get('/progress', asyncHandler(async (req, res) => {
    const { tz } = await who(req.user.id);
    const today = localDate(tz);
    const recent = await d.db.kaizenAction.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 21, include: { goal: { select: { title: true } } } });
    res.json({ data: { ...(await progress(req.user.id, today)), recent: recent.map((a) => ({ ...actionView(a), goalTitle: a.goal.title })) } });
  }));

  r.post('/actions/:id/complete', validate({
    params: id, body: z.object({
      level: z.enum(['FULL', 'PARTIAL', 'SKIPPED']), feedback: z.enum(['EASY', 'OK', 'HARD', 'OVERWHELMED']).optional(), note: z.string().trim().max(1000).optional(),
    })
  }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!a) throw notFound('Action not found');
    // Flowers never decrease: a step already done (fully or partly) cannot be turned into a skip.
    if (req.body.level === 'SKIPPED' && (a.status === 'DONE' || a.status === 'PARTIAL')) throw new AppError(409, 'ALREADY_COMPLETED', 'This step is already done and stays in your garden.');
    const crisis = await guardFreeText(d.db, req.user.id, req.body.note); // a high-risk note is never stored
    if (crisis) { res.json({ data: crisis }); return; }
    const { locale } = await who(req.user.id);
    const prevDone = await d.db.kaizenAction.count({ where: { userId: req.user.id, status: { in: ['DONE', 'PARTIAL'] }, date: { lt: a.date } } });
    const lastBefore = await d.db.kaizenAction.findFirst({ where: { userId: req.user.id, date: { lt: a.date } }, orderBy: { date: 'desc' } });
    const status = req.body.level === 'FULL' ? 'DONE' : req.body.level;
    const u = await d.db.kaizenAction.update({
      where: { id: a.id }, data: {
        status, difficultyFeedback: req.body.feedback ?? null, noteEncrypted: req.body.note ? d.cipher.encrypt(req.body.note) : null,
        completedAt: status === 'SKIPPED' ? null : new Date(),
      }
    });
    const returning = status !== 'SKIPPED' && (!lastBefore || lastBefore.status === 'SKIPPED' || a.micro) && prevDone > 0;
    const message = kaizenMessage(status === 'DONE' ? (returning ? 'RETURN' : 'FULL') : status === 'PARTIAL' ? 'PARTIAL' : 'SKIPPED', locale === 'bn' || locale === 'hi' || locale === 'ne' ? locale : 'en');
    res.json({ data: { ...actionView(u), message } });
  }));

  r.post('/actions/:id/reflect', validate({
    params: id, body: z.object({
      felt: z.number().int().min(1).max(5), usefulness: z.number().int().min(1).max(5), next: z.enum(['SAME', 'EASIER', 'HARDER']), comment: z.string().trim().max(1000).optional(),
    })
  }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!a) throw notFound('Action not found');
    const crisis = await guardFreeText(d.db, req.user.id, req.body.comment); // a high-risk comment is never stored
    if (crisis) { res.json({ data: crisis }); return; }
    const u = await d.db.kaizenAction.update({
      where: { id: a.id }, data: {
        feltLevel: req.body.felt, usefulness: req.body.usefulness, nextPreference: req.body.next,
        commentEncrypted: req.body.comment ? d.cipher.encrypt(req.body.comment) : null, reflectedAt: new Date(),
      }
    });
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
    const u = await d.db.kaizenAction.update({ where: { id: a.id }, data: { targetValue: target, baseTarget: null, title: text.title, description: text.description } });
    if (!a.micro) await d.db.kaizenGoal.update({ where: { id: a.goalId }, data: { currentTarget: target } });
    res.json({ data: actionView(u) });
  }));

  // Weekly review built from the user's own data; AI only phrases it, with a rule-based fallback.
  // Consent is checked first (403 CONSENT_REQUIRED, like journal AI); the rule-based text is only for AI failures or an empty week.
  r.post('/weekly-review', d.messageLimiter, asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI weekly review needs your explicit consent to read your Kaizen history');
    const { tz, lang, locale } = await who(req.user.id);
    // Risk signals: the model is not called and nothing is stored; neutral text only.
    if (await userHasRisk(d.db, d.cipher, req.user.id)) { res.json({ data: { text: RISK_NEUTRAL[copyLang(locale)], ai: false, summaryId: null, riskMode: true } }); return; }
    const today = localDate(tz);
    const rows = await d.db.kaizenAction.findMany({ where: { userId: req.user.id, date: { gte: addDays(today, -6) } }, orderBy: { date: 'asc' }, include: { goal: { select: { title: true } } } });
    const done = rows.filter((x) => x.status === 'DONE' || x.status === 'PARTIAL').length;
    const restarts = rows.filter((x) => x.micro).length;
    const hard = rows.filter((x) => x.difficultyFeedback === 'HARD' || x.difficultyFeedback === 'OVERWHELMED').length;
    const fallback = lang === 'bn'
      ? `à¦à¦‡ à¦¸à¦ªà§à¦¤à¦¾à¦¹à§‡ ${rows.length}à¦Ÿà¦¿ à¦›à§‹à¦Ÿ à¦ªà¦¦à¦•à§à¦·à§‡à¦ªà§‡à¦° à¦®à¦§à§à¦¯à§‡ ${done}à¦Ÿà¦¿ à¦•à¦°à§‡à¦›à§‡à¦¨à¥¤${restarts ? ` ${restarts}à¦¬à¦¾à¦° à¦›à§‹à¦Ÿ à¦•à¦°à§‡ à¦†à¦¬à¦¾à¦° à¦¶à§à¦°à§ à¦•à¦°à§‡à¦›à§‡à¦¨à¥¤` : ''} à¦ªà¦°à§‡à¦° à¦¸à¦ªà§à¦¤à¦¾à¦¹à§‡ à¦à¦•à¦Ÿà¦¿ à¦¬à¦¿à¦·à¦¯à¦¼à§‡à¦‡ à¦®à¦¨ à¦¦à¦¿à¦¨, à¦à¦¬à¦‚ à¦•à¦ à¦¿à¦¨ à¦²à¦¾à¦—à¦²à§‡ à¦†à¦°à¦“ à¦›à§‹à¦Ÿ à¦•à¦°à§à¦¨à¥¤`
      : `This week you completed ${done} of ${rows.length} small steps.${restarts ? ` You restarted gently ${restarts} time(s).` : ''} Next week, keep one focus and shrink the step whenever it feels hard.`;
    if (!rows.length) { res.json({ data: { text: lang === 'bn' ? 'à¦à¦‡ à¦¸à¦ªà§à¦¤à¦¾à¦¹à§‡ à¦à¦–à¦¨à¦“ à¦•à§‹à¦¨à§‹ à¦ªà¦¦à¦•à§à¦·à§‡à¦ª à¦¨à§‡à¦‡à¥¤ à¦†à¦œ à¦à¦•à¦Ÿà¦¿ à¦›à§‹à¦Ÿ à¦¦à¦¿à¦¯à¦¼à§‡ à¦¶à§à¦°à§ à¦•à¦°à¦¾ à¦¯à¦¾à¦•à¥¤' : 'No steps this week yet. Let us start with one tiny step today.', ai: false, riskMode: false } }); return; }
    const weekStart = mondayOf(today);
    // Every generated review is kept (one per week, regenerating replaces it) so the user can read past weeks.
    const saveSummary = async (text: string, ai: boolean) => {
      const data = { textEncrypted: d.cipher.encrypt(text), ai, statsJson: { done, total: rows.length, restarts, hardDays: hard } };
      return (await d.db.weeklySummary.upsert({ where: { userId_weekStart: { userId: req.user.id, weekStart } }, create: { userId: req.user.id, weekStart, ...data }, update: data })).id;
    };
    const t0 = Date.now();
    try {
      const facts = rows.map((x) => `${x.date}: "${x.title}" -> ${x.status}${x.difficultyFeedback ? `, felt ${x.difficultyFeedback}` : ''}${x.micro ? ' (tiny restart)' : ''}`).join('\n') + `\nHard days: ${hard}.`;
      const out = await d.glm.chat([
        { role: 'system', content: `You write the Nivora weekly Kaizen review: 4-6 short sentences, warm and non-judgmental. Cover what stood out, where it was hard, what to simplify, and ONE focus for next week. Never shame misses, never say the person is improving or declining, never score or praise them, never claim medical change, never mention medication. Reply in ${aiReplyLanguage(locale)}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 350 });
      const text = out.content.trim();
      // Every model output goes through checkOutput; anything flagged is replaced by the rule-based text (ai:false).
      const ok = !!text && outputOk(text);
      void d.telemetry.model(req.user.id, 'kaizen_review', Date.now() - t0, !ok);
      res.json({ data: { text: ok ? text : fallback, ai: ok, summaryId: await saveSummary(ok ? text : fallback, ok), riskMode: false } });
    } catch { void d.telemetry.model(req.user.id, 'kaizen_review', Date.now() - t0, true); res.json({ data: { text: fallback, ai: false, summaryId: await saveSummary(fallback, false), riskMode: false } }); }
  }));

  r.get('/weekly-summaries', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(52).default(12) }) }), asyncHandler(async (req, res) => {
    const rows = await d.db.weeklySummary.findMany({ where: { userId: req.user.id }, orderBy: { weekStart: 'desc' }, take: Number(req.query.limit ?? 12) || 12 });
    res.json({ data: rows.map((x) => ({ id: x.id, weekStart: x.weekStart, text: d.cipher.decrypt(x.textEncrypted), ai: x.ai, stats: x.statsJson, createdAt: x.createdAt })) });
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
    const { total, carried } = await flowerTotal(d.db, req.user.id);
    // Season follows the average mood of the last 30 days (decoration only; flowers are never removed by a hard month).
    const moods = await d.db.checkIn.findMany({ where: { userId: req.user.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { mood: true } });
    const avgMood30 = moods.length ? Math.round((moods.reduce((t, m) => t + m.mood, 0) / moods.length) * 10) / 10 : null;
    const season = seasonFromMood(avgMood30);
    const { locale } = await who(req.user.id);
    res.json({ data: { total, carried, days, flowers, season, seasonLabel: SEASON_LABEL[season][copyLang(locale)], avgMood30 } });
  }));

  // FEATURE 1: The Energy Alchemist
  // Transforms an action into an effortless 15-30s in-bed micro-ritual when energy is low.
  r.post('/alchemize', validate({
    body: z.object({
      actionId: z.string().uuid().optional(),
      energyLevel: z.enum(['LOW', 'MED', 'HIGH']),
      category: z.string().optional(),
    })
  }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The Energy Alchemist requires consent to transform your step with AI');
    const { locale } = await who(req.user.id);
    let cat = req.body.category;
    let targetAction: any = null;

    if (req.body.actionId) {
      targetAction = await d.db.kaizenAction.findFirst({
        where: { id: req.body.actionId, userId: req.user.id },
        include: { goal: true },
      });
      if (targetAction && !cat) cat = targetAction.goal?.category;
    }

    const atomic = await alchemizeAction(d.glm, {
      category: cat,
      energyLevel: req.body.energyLevel,
      locale,
    });

    if (targetAction) {
      const u = await d.db.kaizenAction.update({
        where: { id: targetAction.id },
        data: {
          title: atomic.title,
          description: atomic.description,
          micro: true,
          adaptedBy: 'ENERGY_ALCHEMIST',
        },
      });
      res.json({ data: { action: actionView(u), atomicStep: atomic } });
      return;
    }

    res.json({ data: { action: null, atomicStep: atomic } });
  }));

  // FEATURE 2: Soul Weather to Action
  // Validates user mood and generates a 60-second sensory-grounded ritual.
  r.post('/soul-weather', validate({
    body: z.object({
      emojis: z.array(z.string()).min(1).max(10),
      textNote: z.string().trim().max(500).optional(),
    })
  }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Soul Weather requires consent to process your mood with AI');
    if (req.body.textNote) {
      const crisis = await guardFreeText(d.db, req.user.id, req.body.textNote);
      if (crisis) { res.json({ data: { crisis, validation: '', ritualTitle: '', ritualStep: '' } }); return; }
    }
    const { locale } = await who(req.user.id);
    const result = await generateSoulWeather(d.glm, {
      emojis: req.body.emojis,
      textNote: req.body.textNote,
      locale,
    });
    res.json({ data: result });
  }));

  // FEATURE 3: The Living Zen Chronicle
  // Generates a poetic letter and haiku from their Kaizen plant's perspective.
  r.post('/living-chronicle', validate({
    body: z.object({
      weeklyActions: z.array(z.object({
        date: z.string(),
        status: z.string().nullable().optional(),
        micro: z.boolean().optional(),
        difficulty: z.number().optional(),
      })).optional(),
      stage: z.string().optional(),
    })
  }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The Living Chronicle requires consent to reflect on your plant growth with AI');
    const { tz, locale } = await who(req.user.id);
    let actions = req.body.weeklyActions;
    if (!actions || !actions.length) {
      const today = localDate(tz);
      const rows = await d.db.kaizenAction.findMany({
        where: { userId: req.user.id, date: { gte: addDays(today, -6) } },
        orderBy: { date: 'asc' },
      });
      actions = rows.map((r) => ({ date: r.date, status: r.status, micro: r.micro, difficulty: r.difficulty }));
    }
    const today = localDate(tz);
    const prog = await progress(req.user.id, today);
    const result = await writePlantChronicle(d.glm, {
      weeklyActions: actions,
      stage: req.body.stage ?? prog.stage,
      locale,
    });
    res.json({ data: result });
  }));

  // FEATURE 5: Zen Omikuji
  // Generates a 1-sentence contemplative fortune/blessing for the completed action.
  r.post('/omikuji', validate({
    body: z.object({
      completedActionTitle: z.string().max(200).optional(),
      completionStreak: z.number().int().min(0).optional(),
    })
  }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Zen Omikuji requires consent to generate blessings with AI');
    const { locale } = await who(req.user.id);
    const result = await generateOmikuji(d.glm, {
      completedActionTitle: req.body.completedActionTitle,
      completionStreak: req.body.completionStreak,
      locale,
    });
    res.json({ data: result });
  }));

  // ── Kaizen AI Goal Coach: Setup & Clarification ─────────────────────────────
  // POST /kaizen/coach/setup
  r.post('/coach/setup', d.messageLimiter, validate({
    body: z.object({
      rawGoal: z.string().trim().min(2).max(500),
      currentSituation: z.string().trim().max(500).optional(),
      availableTimeMin: z.number().int().min(1).max(120).optional(),
    })
  }), asyncHandler(async (req, res) => {
    const crisis = await guardFreeText(d.db, req.user.id, req.body.rawGoal);
    if (crisis) { res.json({ data: crisis }); return; }
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI Goal Coach requires consent to refine your goal');
    const { locale } = await who(req.user.id);
    const result = await coachGoalSetup(d.glm, {
      rawGoal: req.body.rawGoal,
      currentSituation: req.body.currentSituation,
      availableTimeMin: req.body.availableTimeMin,
      locale,
    });
    res.json({ data: result });
  }));

  // ── Kaizen AI Goal Coach: PDCA Check-In ──────────────────────────────────────
  // POST /kaizen/coach/checkin
  r.post('/coach/checkin', d.messageLimiter, validate({
    body: z.object({
      goalTitle: z.string(),
      actionTitle: z.string(),
      status: z.enum(['DONE', 'PARTIAL', 'SKIPPED']),
      difficultyFeedback: z.enum(['EASY', 'OK', 'HARD', 'OVERWHELMED']).optional(),
      feltLevel: z.number().int().min(1).max(5).optional(),
      userNote: z.string().trim().max(1000).optional(),
    })
  }), asyncHandler(async (req, res) => {
    if (req.body.userNote) {
      const crisis = await guardFreeText(d.db, req.user.id, req.body.userNote);
      if (crisis) { res.json({ data: crisis }); return; }
    }
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI Goal Coach requires consent for check-in analysis');
    const { locale } = await who(req.user.id);
    const result = await coachPdcaCheckIn(d.glm, {
      goalTitle: req.body.goalTitle,
      actionTitle: req.body.actionTitle,
      status: req.body.status,
      difficultyFeedback: req.body.difficultyFeedback,
      feltLevel: req.body.feltLevel,
      userNote: req.body.userNote,
      locale,
    });
    res.json({ data: result });
  }));

  return r;
}
