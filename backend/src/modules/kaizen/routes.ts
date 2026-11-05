import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { addDays, localDate } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import { guardFreeText } from '../../services/crisisResponse.js';
import { userHasRisk } from '../../services/riskState.js';
import { flowerTotal, seasonFromMood } from '../../services/gardenService.js';
import { copyLang, SEASON_LABEL } from '../../services/wellnessCopy.js';
import { kaizenMessage } from '../../services/kaizenEngine.js';
import { activeTaskOf, shouldReconsider } from '../../services/kaizenTask.js';
import { computeScore, canUseModelForGoal, goalView, phraseUpdateNote, splitGoal, fallbackSplit, type SplitTask } from '../../services/kaizenGoal.js';
import type { Deps } from '../deps.js';

/** The no-model split used when the user has not consented to their words going to the model. */
const splitGoalFallbackOnly = (title: string): SplitTask[] => fallbackSplit(title);

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
    const crisis = await guardFreeText(d.db, req.user.id, req.body.note);
    if (crisis) { res.json({ data: crisis }); return; }
    const done = await d.db.kaizenTask.update({ where: { id: t.id }, data: { status: 'DONE', completedAt: new Date(), stillSince: null, stillCount: 0, stateNoteEnc: req.body.note ? d.cipher.encrypt(req.body.note) : t.stateNoteEnc } });
    res.json({ data: taskView(done) });
  }));

  // "Can't today": a quiet no-penalty record that the session read; the task stays active.
  r.post('/task/:id/react', validate({ params: id, body: z.object({ note: z.string().trim().max(300).optional() }) }), asyncHandler(async (req, res) => {
    const t = await d.db.kaizenTask.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!t) throw notFound('Task not found');
    const crisis = await guardFreeText(d.db, req.user.id, req.body.note);
    if (crisis) { res.json({ data: crisis }); return; }
    const u = await d.db.kaizenTask.update({ where: { id: t.id }, data: { stateNoteEnc: d.cipher.encrypt(req.body.note ?? 'Not today — the task stays, no pressure.') } });
    res.json({ data: taskView(u) });
  }));

  // ── Feature B: the user's own goal — zero interaction with therapy sessions ──

  r.get('/goal', asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({
      where: { userId: req.user.id, status: { in: ['ACTIVE', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.json({ data: g ? goalView(g, (x) => d.cipher.decrypt(x)) : null });
  }));

  r.post('/goal', validate({ body: z.object({ title: z.string().trim().min(2).max(120) }) }), asyncHandler(async (req, res) => {
    const crisis = await guardFreeText(d.db, req.user.id, req.body.title);
    if (crisis) { res.json({ data: crisis }); return; }
    // One active goal at a time: an older active goal is set aside (kept as history, never deleted).
    await d.db.userGoal.updateMany({ where: { userId: req.user.id, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    // The AI split sends the user's own words to the model: JOURNAL_AI_SHARING consent; without it the deterministic split runs.
    const ai = await canUseModelForGoal(d.db, req.user.id);
    const locale = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale ?? 'en';
    const tasks: SplitTask[] = ai ? await splitGoal(d.glm, { title: req.body.title, locale }) : splitGoalFallbackOnly(req.body.title);
    const g = await d.db.userGoal.create({
      data: { userId: req.user.id, titleEnc: d.cipher.encrypt(req.body.title), tasksJson: JSON.stringify(tasks), score: 0 },
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    res.status(201).json({ data: goalView(g, (x) => d.cipher.decrypt(x)) });
  }));

  r.post('/goal/:id/update', validate({
    params: id, body: z.object({ note: z.string().trim().max(1000).optional(), doneCurrent: z.boolean().optional() }),
  }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'ACTIVE' } });
    if (!g) throw notFound('Goal not found');
    const crisis = await guardFreeText(d.db, req.user.id, req.body.note);
    if (crisis) { res.json({ data: crisis }); return; }
    const tasks: SplitTask[] = JSON.parse(g.tasksJson);
    if (req.body.doneCurrent) {
      const idx = tasks.findIndex((t) => !t.done);
      if (idx >= 0) tasks[idx]!.done = true;
    }
    const score = computeScore(tasks, [...(await d.db.userGoalUpdate.findMany({ where: { goalId: g.id }, orderBy: { createdAt: 'desc' }, take: 30 })).map((u) => ({ doneCurrent: u.doneCurrent })), { doneCurrent: !!req.body.doneCurrent }]);
    const allDone = tasks.every((t) => t.done);
    await d.db.$transaction([
      d.db.userGoal.update({ where: { id: g.id }, data: { tasksJson: JSON.stringify(tasks), score, status: allDone ? 'COMPLETED' : 'ACTIVE', completedAt: allDone ? new Date() : null } }),
      d.db.userGoalUpdate.create({ data: { goalId: g.id, noteEnc: req.body.note ? d.cipher.encrypt(req.body.note) : null, doneCurrent: !!req.body.doneCurrent, score } }),
    ]);
    const u = await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } });
    const line = await phraseUpdateNote(d.glm, { goal: d.cipher.decrypt(g.titleEnc), doneCurrent: !!req.body.doneCurrent, score, note: req.body.note, locale: u?.locale });
    res.json({ data: { ...goalView(await d.db.userGoal.findUniqueOrThrow({ where: { id: g.id }, include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } } }), (x) => d.cipher.decrypt(x)), line } });
  }));

  // Rewriting the goal mid-way: the AI re-splits the remaining tasks; completed ones and the score stay.
  r.post('/goal/:id/edit', validate({ params: id, body: z.object({ title: z.string().trim().min(2).max(120) }) }), asyncHandler(async (req, res) => {
    const g = await d.db.userGoal.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'ACTIVE' } });
    if (!g) throw notFound('Goal not found');
    const crisis = await guardFreeText(d.db, req.user.id, req.body.title);
    if (crisis) { res.json({ data: crisis }); return; }
    const tasks: SplitTask[] = JSON.parse(g.tasksJson);
    const doneTitles = tasks.filter((t) => t.done);
    const ai = await canUseModelForGoal(d.db, req.user.id);
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
    const crisis = await guardFreeText(d.db, req.user.id, req.body.note); // a high-risk note is never stored
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
