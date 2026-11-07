import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { addDays, localDate } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import { guardInput } from '../../services/crisisResponse.js';
import { userHasRisk } from '../../services/riskState.js';
import { flowerTotal, seasonFromMood } from '../../services/gardenService.js';
import { copyLang, SEASON_LABEL } from '../../services/wellnessCopy.js';
import { kaizenMessage } from '../../services/kaizenEngine.js';
import { activeTaskOf, shouldReconsider } from '../../services/kaizenTask.js';
import {
  computeScore, canUseModelForGoal, goalView, phraseUpdateNote, phraseMilestone, splitGoal, splitGoalWithAnchor, fallbackSplit,
  smallerFallbackSplit, updateNoteFallback, MILESTONE_FALLBACK, FALLBACK_ANCHOR, goalTemplateView, goalTasksFromTemplate,
  type SplitTask,
} from '../../services/kaizenGoal.js';
import { addKaizenStep } from '../../services/kaizenExtras.js';
import { goalClarity, goalCopy } from '../../services/lucRule.js';
import { parseJsonObject } from '../../services/aiOutput.js';
import type { Deps } from '../deps.js';

/** The no-model split used when the user has not consented to their words going to the model. */
const splitGoalFallbackOnly = (title: string, timePerDayMin?: number | null): SplitTask[] => fallbackSplit(title, timePerDayMin);

const id = z.object({ id: z.string().uuid() });

/**
 * Kaizen backend after the v2 redesign:
 *  - Feature A: GET /task (+ complete / react) — the one therapy-given task.
 *  - Shared leftovers other features still use: the completion endpoint for the small steps that
 *    Journal, Practice, the action menu and session-close add through kaizenExtras, and the
 *    flower garden (Profile's Garden screen).
 *  - Feature B (the user's own goal) is served by /kaizen/goal* (see kaizenGoal).
 */
export function kaizenRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  const taskView = (t: any) => ({
    id: t.id,
    content: t.contentEnc ? d.cipher.decrypt(t.contentEnc) : null,
    reason: t.reasonEnc ? d.cipher.decrypt(t.reasonEnc) : null,
    status: t.status,
    stateNote: t.stateNoteEnc ? d.cipher.decrypt(t.stateNoteEnc) : null,
    standingStill: shouldReconsider(t),
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  });

  // Feature A: the current task (or nothing — the empty state is normal and healthy).
  r.get('/task', asyncHandler(async (req, res) => {
    if (await userHasRisk(d.db, d.cipher, req.user.id)) { res.json({ data: { task: null, history: [], riskMode: true } }); return; }
    const task = await activeTaskOf(d.db, req.user.id);
    const history = await d.db.kaizenTask.findMany({ where: { userId: req.user.id, status: { in: ['DONE', 'DROPPED'] } }, orderBy: { updatedAt: 'desc' }, take: 5 });
    res.json({ data: { task: task ? taskView(task) : null, history: history.map(taskView), riskMode: false } });
  }));

  r.post('/task/:id/complete', validate({ params: id, body: z.object({ note: z.string().trim().max(1000).optional() }) }), asyncHandler(async (req, res) => {
    const t = await d.db.kaizenTask.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!t) throw notFound('Task not found');
    const crisis = (await guardInput(d.db, d.glm, req.user.id, req.body.note)).crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    const done = await d.db.kaizenTask.update({ where: { id: t.id }, data: { status: 'DONE', completedAt: new Date(), stillSince: null, stillCount: 0, stateNoteEnc: req.body.note ? d.cipher.encrypt(req.body.note) : t.stateNoteEnc } });
    res.json({ data: taskView(done) });
  }));

  // "Can't today": a quiet no-penalty record that the session read; the task stays active.
  r.post('/task/:id/react', validate({ params: id, body: z.object({ note: z.string().trim().max(300).optional() }) }), asyncHandler(async (req, res) => {
    const t = await d.db.kaizenTask.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!t) throw notFound('Task not found');
    const crisis = (await guardInput(d.db, d.glm, req.user.id, req.body.note)).crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    const u = await d.db.kaizenTask.update({ where: { id: t.id }, data: { stateNoteEnc: d.cipher.encrypt(req.body.note ?? 'Not today — the task stays, no pressure.') } });
    res.json({ data: taskView(u) });
  }));

  // ── Feature B: the user's own goal — zero interaction with therapy sessions ──

  // All of the user's goals, newest first — several may be active at once, each with its own tasks and score.
  r.get('/goal', asyncHandler(async (req, res) => {
    const goals = await d.db.userGoal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.json({ data: goals.map((g) => goalView(g, (x) => d.cipher.decrypt(x))) });
  }));

  r.post('/goal', validate({ body: z.object({
    title: z.string().trim().min(2).max(120),
    timePerDayMin: z.number().int().min(1).max(120).optional(),
    anchor: z.string().trim().min(1).max(200).optional(),
    // Guided flow (opt-in, so older clients keep the one-step behaviour): listen -> understand -> confirm before the split.
    guided: z.boolean().optional(),
    answers: z.array(z.string().trim().min(1).max(200)).max(2).optional(),
    confirm: z.boolean().optional(),
  }) }), asyncHandler(async (req, res) => {
    const guard = await guardInput(d.db, d.glm, req.user.id, req.body.title, req.body.anchor, ...(req.body.answers ?? [])); const crisis = guard.crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    // Guided: a vague goal gets 1-2 clarifying questions, then a "did I get that right?" step; nothing is split (no model call) until confirm:true.
    // Any risk signal (elevated this turn or in the person's state) skips the flow and the goal is handled the older, direct way.
    if (req.body.guided && !req.body.confirm && !guard.skipAi && !(await userHasRisk(d.db, d.cipher, req.user.id))) {
      const lc = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
      const answers: string[] = req.body.answers ?? [];
      const merged = [req.body.title, ...answers].join(' ');
      let clarity = goalClarity(merged, { timePerDayMin: req.body.timePerDayMin });
      // Optional cheap model check, only when the rules say clear and a utility model exists; any failure means "clear".
      if (clarity.clear && d.utilityGlm && !answers.length && (await canUseModelForGoal(d.db, req.user.id))) {
        try {
          const out = await d.utilityGlm.chat([
            { role: 'system', content: 'Decide if a personal goal is concrete enough to split into daily steps (an action the person would do, with something measurable such as how often or how long). Output strict JSON {"clear":boolean}.' },
            { role: 'user', content: req.body.title.slice(0, 200) },
          ], { maxTokens: 20, signal: AbortSignal.timeout(3000) });
          const j = parseJsonObject(out.content);
          if (j && j.clear === false) clarity = { clear: false, reasons: ['NO_MEASURE'] };
        } catch { /* fail safe: clear */ }
      }
      const copy = goalCopy(lc, clarity, req.body.title, answers);
      if (!clarity.clear && !answers.length) {
        res.json({ data: { needsClarification: true, intro: copy.intro, questions: copy.questions, maxAnswers: 2 } });
        return;
      }
      res.json({ data: { needsConfirmation: true, understood: copy.understood, goal: req.body.title, answers, actions: { confirm: copy.confirm, notQuite: copy.notQuite } } });
      return;
    }
    // Multiple goals are welcome: each one keeps its own tasks, updates and score.
    // The AI split sends the user's own words to the model: JOURNAL_AI_SHARING consent; without it the deterministic split runs.
    const ai = !guard.skipAi && await canUseModelForGoal(d.db, req.user.id);
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    let tasks: SplitTask[]; let aiAnchor: string | null = null;
    if (ai) {
      const split = await splitGoalWithAnchor(d.glm, { title: req.body.title, timePerDayMin: req.body.timePerDayMin ?? null, locale, details: req.body.answers });
      tasks = split.tasks; aiAnchor = split.anchor;
    } else {
      tasks = splitGoalFallbackOnly(req.body.title, req.body.timePerDayMin);
    }
    const anchor = req.body.anchor ?? aiAnchor ?? FALLBACK_ANCHOR; // the user's own anchor wins over the model's
    const g = await d.db.userGoal.create({
      data: {
        userId: req.user.id, titleEnc: d.cipher.encrypt(req.body.title), tasksJson: JSON.stringify(tasks), score: 0,
        timePerDayMin: req.body.timePerDayMin ?? null, anchorEnc: d.cipher.encrypt(anchor),
      },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.status(201).json({ data: goalView(g, (x) => d.cipher.decrypt(x)) });
  }));

  // Feature 12: curated starter goals (static, no model) to begin from instead of a blank page.
  r.get('/goal/templates', asyncHandler(async (req, res) => {
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    res.json({ data: goalTemplateView(locale) });
  }));

  r.post('/goal/from-template', validate({ body: z.object({ templateId: z.string().trim().min(1).max(50) }) }), asyncHandler(async (req, res) => {
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    const tpl = goalTasksFromTemplate(req.body.templateId, locale);
    if (!tpl) throw notFound('Template not found');
    const g = await d.db.userGoal.create({
      data: { userId: req.user.id, titleEnc: d.cipher.encrypt(tpl.title), tasksJson: JSON.stringify(tpl.tasks), score: 0 },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.status(201).json({ data: goalView(g, (x) => d.cipher.decrypt(x)) });
  }));

  r.post('/goal/:id/update', validate({
    params: id, body: z.object({
      note: z.string().trim().max(1000).optional(), doneCurrent: z.boolean().optional(),
      difficulty: z.enum(['EASY', 'OK', 'HARD']).optional(),
    }),
  }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'ACTIVE' } });
    if (!g) throw notFound('Goal not found');
    const guard = await guardInput(d.db, d.glm, req.user.id, req.body.note); const crisis = guard.crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    const tasks: SplitTask[] = JSON.parse(g.tasksJson);
    const currentIdx = tasks.findIndex((t) => !t.done);
    if (req.body.doneCurrent) {
      if (currentIdx >= 0) tasks[currentIdx]!.done = true;
    }
    // Feature 2: the difficulty the user reports for the current step is remembered (newest last).
    const difficulty: { taskId: string; difficulty: string; at: string }[] = Array.isArray(JSON.parse(g.difficultyJson)) ? JSON.parse(g.difficultyJson) : [];
    if (req.body.difficulty && currentIdx >= 0) difficulty.push({ taskId: tasks[currentIdx]!.id, difficulty: req.body.difficulty, at: new Date().toISOString() });
    // The score is computed before any re-split: done tasks and the score survive a re-split untouched.
    const priorUpdates = await d.db.userGoalUpdate.findMany({ where: { goalId: g.id }, orderBy: { createdAt: 'asc' }, take: 30 });
    const score = computeScore(tasks, [...priorUpdates.map((u) => ({ doneCurrent: u.doneCurrent })), { doneCurrent: !!req.body.doneCurrent }]);
    // Two HARD reports on the same current step: the remaining steps are made smaller (AI when consented, deterministic otherwise).
    const ai = !guard.skipAi && await canUseModelForGoal(d.db, req.user.id);
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    let reSplit = false;
    const hardOnCurrent = currentIdx >= 0 ? difficulty.filter((e) => e.difficulty === 'HARD' && e.taskId === tasks[currentIdx]!.id).length : 0;
    if (hardOnCurrent >= 2) {
      const doneTasks = tasks.filter((t) => t.done);
      const smaller = ai
        ? (await splitGoalWithAnchor(d.glm, { title: d.cipher.decrypt(g.titleEnc), currentTitle: tasks[currentIdx]!.title, smaller: true, locale })).tasks.map((t, i) => ({ ...t, id: `r${i + 1}` }))
        : smallerFallbackSplit(tasks[currentIdx]!.title);
      tasks.splice(0, tasks.length, ...[...doneTasks, ...smaller]);
      reSplit = true;
    }
    const allDone = tasks.every((t) => t.done);
    // Feature 10: the 50% milestone is shown once, the first time the score crosses it.
    const milestones: string[] = Array.isArray(JSON.parse(g.milestonesJson)) ? JSON.parse(g.milestonesJson) : [];
    const crossed50 = g.score < 50 && score >= 50 && !milestones.includes('50');
    if (crossed50) milestones.push('50');
    await d.db.$transaction([
      d.db.userGoal.update({
        where: { id: g.id }, data: {
          tasksJson: JSON.stringify(tasks), score, status: allDone ? 'COMPLETED' : 'ACTIVE', completedAt: allDone ? new Date() : null,
          difficultyJson: JSON.stringify(difficulty), milestonesJson: JSON.stringify(milestones),
        }
      }),
      d.db.userGoalUpdate.create({ data: { goalId: g.id, noteEnc: req.body.note ? d.cipher.encrypt(req.body.note) : null, doneCurrent: !!req.body.doneCurrent, score } }),
    ]);
    // Feature 11: finishing the goal plants one best-effort garden flower — it never breaks the response.
    if (allDone) {
      try {
        const { action } = await addKaizenStep(d.db, req.user.id, { category: 'JOURNAL', minutes: 2, source: 'MENU', title: `Goal completed: ${d.cipher.decrypt(g.titleEnc)}` });
        await d.db.kaizenAction.update({ where: { id: action.id }, data: { status: 'DONE', completedAt: new Date() } });
      } catch { /* the flower is decoration; the goal completion itself always lands */ }
    }
    // The encouragement contains the user's own words, so it stays behind the same consent as the split.
    const line = ai
      ? await phraseUpdateNote(d.glm, { goal: d.cipher.decrypt(g.titleEnc), doneCurrent: !!req.body.doneCurrent, score, note: req.body.note, locale })
      : updateNoteFallback(!!req.body.doneCurrent);
    const milestone = crossed50 ? (ai ? await phraseMilestone(d.glm, { goal: d.cipher.decrypt(g.titleEnc), locale }) : MILESTONE_FALLBACK) : undefined;
    const fresh = await d.db.userGoal.findUniqueOrThrow({ where: { id: g.id }, include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    res.json({
      data: {
        ...goalView(fresh, (x) => d.cipher.decrypt(x)), line,
        ...(reSplit ? { reSplit } : {}),
        ...(req.body.difficulty ? { difficultyAccepted: true } : {}),
        ...(milestone ? { milestone } : {}),
      }
    });
  }));

  // Feature 4: the habit anchor can be rewritten any time the routine it attaches to changes.
  r.post('/goal/:id/anchor', validate({ params: id, body: z.object({ anchor: z.string().trim().min(1).max(200) }) }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!g) throw notFound('Goal not found');
    const crisis = (await guardInput(d.db, d.glm, req.user.id, req.body.anchor)).crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    const updated = await d.db.userGoal.update({
      where: { id: g.id }, data: { anchorEnc: d.cipher.encrypt(req.body.anchor) },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.json({ data: goalView(updated, (x) => d.cipher.decrypt(x)) });
  }));

  // Feature 7: a daily gentle reminder time (minutes after midnight; null = off). Display and delivery are the mobile side's.
  r.post('/goal/:id/reminder', validate({ params: id, body: z.object({ reminderMin: z.number().int().min(0).max(1439).nullable() }) }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!g) throw notFound('Goal not found');
    const updated = await d.db.userGoal.update({
      where: { id: g.id }, data: { reminderMin: req.body.reminderMin },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.json({ data: goalView(updated, (x) => d.cipher.decrypt(x)) });
  }));

  // Feature 11: the journey card — the whole trip in one small view.
  r.get('/goal/:id/card', validate({ params: id }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!g) throw notFound('Goal not found');
    const tasks: SplitTask[] = JSON.parse(g.tasksJson);
    const end = g.completedAt ?? new Date();
    const days = Math.max(1, Math.floor((end.getTime() - g.createdAt.getTime()) / 86_400_000) + 1); // inclusive, at least the first day
    res.json({ data: { title: d.cipher.decrypt(g.titleEnc), tasks: tasks.map((t) => ({ title: t.title, done: t.done })), startedAt: g.createdAt, completedAt: g.completedAt, days, score: g.score } });
  }));

  // Rewriting the goal mid-way: the AI re-splits the remaining tasks; completed ones and the score stay.
  r.post('/goal/:id/edit', validate({ params: id, body: z.object({ title: z.string().trim().min(2).max(120) }) }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'ACTIVE' } });
    if (!g) throw notFound('Goal not found');
    const guard = await guardInput(d.db, d.glm, req.user.id, req.body.title); const crisis = guard.crisis;
    if (crisis) { res.json({ data: crisis }); return; }
    const tasks: SplitTask[] = JSON.parse(g.tasksJson);
    const doneTitles = tasks.filter((t) => t.done);
    const ai = !guard.skipAi && await canUseModelForGoal(d.db, req.user.id);
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    const remaining = ai ? await splitGoal(d.glm, { title: req.body.title, locale }) : splitGoalFallbackOnly(req.body.title);
    const merged: SplitTask[] = [...doneTitles, ...remaining.map((t, i) => ({ ...t, id: `r${i + 1}` }))];
    const updated = await d.db.userGoal.update({ where: { id: g.id }, data: { titleEnc: d.cipher.encrypt(req.body.title), tasksJson: JSON.stringify(merged) } });
    res.json({ data: goalView({ ...updated, updates: [] }, (x) => d.cipher.decrypt(x)) });
  }));

  r.post('/goal/:id/abandon', validate({ params: id }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'ACTIVE' } });
    if (!g) throw notFound('Goal not found');
    await d.db.userGoal.update({ where: { id: g.id }, data: { status: 'ABANDONED' } });
    res.status(204).end();
  }));

  const actionView = (a: any) => ({
    id: a.id, goalId: a.goalId, date: a.date, title: a.userTextEncrypted ? d.cipher.decrypt(a.userTextEncrypted) : a.title, description: a.description,
    targetValue: a.targetValue, unit: a.unit, difficulty: a.difficulty, micro: a.micro, status: a.status,
    source: a.source ?? 'GOAL',
  });

  // Completing a small step (an extra from the journal, a walk, the action menu or a session close):
  // flowers never decrease — a done step can never be turned into a skip.
  r.post('/actions/:id/complete', validate({
    params: id, body: z.object({
      level: z.enum(['FULL', 'PARTIAL', 'SKIPPED']), feedback: z.enum(['EASY', 'OK', 'HARD', 'OVERWHELMED']).optional(), note: z.string().trim().max(1000).optional(),
    })
  }), asyncHandler(async (req, res) => {
    const a = await d.db.kaizenAction.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!a) throw notFound('Action not found');
    if (req.body.level === 'SKIPPED' && (a.status === 'DONE' || a.status === 'PARTIAL')) {
      throw new (await import('../../utils/errors.js')).AppError(409, 'ALREADY_COMPLETED', 'This step is already done and stays in your garden.');
    }
    const crisis = (await guardInput(d.db, d.glm, req.user.id, req.body.note)).crisis; // a high-risk note is never stored
    if (crisis) { res.json({ data: crisis }); return; }
    const u = await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } });
    const locale = u?.locale ?? 'en';
    const status = req.body.level === 'FULL' ? 'DONE' : req.body.level;
    const updated = await d.db.kaizenAction.update({
      where: { id: a.id }, data: {
        status, difficultyFeedback: req.body.feedback ?? null, noteEncrypted: req.body.note ? d.cipher.encrypt(req.body.note) : null,
        completedAt: status === 'SKIPPED' ? null : new Date(),
      }
    });
    const message = kaizenMessage(status === 'DONE' ? 'FULL' : status === 'PARTIAL' ? 'PARTIAL' : 'SKIPPED', locale === 'bn' || locale === 'hi' || locale === 'ne' ? locale : 'en');
    res.json({ data: { ...actionView(updated), message } });
  }));

  // Blossom garden: one flower per completed step. Flowers only ever grow; nothing is lost on a quiet week.
  // (Profile's Garden screen uses this; the Kaizen section itself does not.)
  r.get('/garden', asyncHandler(async (req, res) => {
    const u = await d.db.user.findUnique({ where: { id: req.user.id }, select: { timezone: true, locale: true } });
    const today = localDate(u?.timezone);
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
    const locale = u?.locale ?? 'en';
    res.json({ data: { total, carried, days, flowers, season, seasonLabel: SEASON_LABEL[season][copyLang(locale)], avgMood30 } });
  }));

  return r;
}
