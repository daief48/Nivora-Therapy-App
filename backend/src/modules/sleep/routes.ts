import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { LUC_SINGLE_SHOT } from '../../services/lucRule.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { durationMinutes, gradualBedtime, sleepScore } from '../../services/sleepService.js';
import { addExtra, coachExtraFor, composeRoutine, loadLog, removeExtra, routineDate, setStepDone, tonightFor } from '../../services/routineSteps.js';
import { pick, ROUTINE_EXTRAS } from '../../services/actionCopy.js';
import { outputOk } from '../../services/aiOutput.js';
import { guardInput } from '../../services/crisisResponse.js';
import { userHasRisk } from '../../services/riskState.js';
import { copyLang, RISK_NEUTRAL } from '../../services/wellnessCopy.js';
import { requireConsent } from '../consents/consentService.js';
import { addDays, localDate } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DEFAULT_BEDTIME = '22:30';
/** Imported nights carry no "how rested" answer; scoring uses a neutral value instead of a made-up one. */
export const NEUTRAL_RESTED = 6;

export function sleepRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function profileInfo(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as 'en' | 'bn', locale: u?.locale ?? 'en', desired: typeof prefs.desiredBedtime === 'string' ? (prefs.desiredBedtime as string) : DEFAULT_BEDTIME };
  }
  const view = (s: any) => ({
    id: s.id, date: s.date, bedtime: s.bedtime, wakeTime: s.wakeTime, durationMin: s.durationMin, latencyMin: s.latencyMin,
    awakenings: s.awakenings, rested: s.rested, score: s.score, source: s.source, note: s.noteEncrypted ? d.cipher.decrypt(s.noteEncrypted) : null,
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
    const crisis = (await guardInput(d.db, d.glm, req.user.id, b.note)).crisis; // a high-risk note is never stored
    if (crisis) { res.json({ data: crisis }); return; }
    const { tz } = await profileInfo(req.user.id);
    const date = b.date ?? localDate(tz);
    const durationMin = durationMinutes(b.bedtime, b.wakeTime);
    const prev = await d.db.sleepEntry.findMany({ where: { userId: req.user.id, date: { lt: date } }, orderBy: { date: 'desc' }, take: 6 });
    const result = sleepScore({
      durationMin, awakenings: b.awakenings, rested: b.rested, recentBedtimes: [b.bedtime, ...prev.map((p) => p.bedtime)], routineRate: await routineRate(req.user.id, date),
    });
    const data = { bedtime: b.bedtime, wakeTime: b.wakeTime, durationMin, latencyMin: b.latencyMin, awakenings: b.awakenings, rested: b.rested, score: result.score, noteEncrypted: b.note ? d.cipher.encrypt(b.note) : null, source: 'manual' };
    const row = await d.db.sleepEntry.upsert({ where: { userId_date: { userId: req.user.id, date } }, create: { userId: req.user.id, date, ...data }, update: data });
    res.status(201).json({ data: { ...view(row), breakdown: result } });
  }));

  r.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(120).default(30) }) }), asyncHandler(async (req, res) => {
    const { limit } = q<{ limit: number }>(req);
    const rows = await d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: limit });
    const latest = rows[0];
    const breakdown = latest ? sleepScore({
      durationMin: latest.durationMin, awakenings: latest.awakenings, rested: latest.rested ?? NEUTRAL_RESTED,
      recentBedtimes: rows.slice(0, 7).map((x) => x.bedtime), routineRate: await routineRate(req.user.id, latest.date),
    }) : null;
    res.json({ data: { entries: rows.map(view), breakdown } });
  }));

  // Edit a night (also an imported one). Editing converts an imported row to a manual one, so disconnecting the device never deletes what the user corrected.
  r.patch('/:id', validate({ params: z.object({ id: z.string().uuid() }), body: z.object({
    bedtime: hhmm.optional(), wakeTime: hhmm.optional(), latencyMin: z.number().int().min(0).max(600).optional(), awakenings: z.number().int().min(0).max(20).optional(),
    rested: z.number().int().min(1).max(10).optional(), note: z.string().trim().max(2000).nullable().optional(),
  }) }), asyncHandler(async (req, res) => {
    const cur = await d.db.sleepEntry.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!cur) throw notFound('Sleep entry not found');
    const b = req.body;
    const bedtime = b.bedtime ?? cur.bedtime, wakeTime = b.wakeTime ?? cur.wakeTime;
    const durationMin = durationMinutes(bedtime, wakeTime);
    const prev = await d.db.sleepEntry.findMany({ where: { userId: req.user.id, date: { lt: cur.date } }, orderBy: { date: 'desc' }, take: 6 });
    const awakenings = b.awakenings ?? cur.awakenings, rested = b.rested ?? cur.rested;
    const result = sleepScore({ durationMin, awakenings, rested: rested ?? NEUTRAL_RESTED, recentBedtimes: [bedtime, ...prev.map((p) => p.bedtime)], routineRate: await routineRate(req.user.id, cur.date) });
    const row = await d.db.sleepEntry.update({ where: { id: cur.id }, data: {
      bedtime, wakeTime, durationMin, awakenings, rested, latencyMin: b.latencyMin ?? cur.latencyMin, score: result.score, source: 'manual',
      ...(b.note !== undefined && { noteEncrypted: b.note ? d.cipher.encrypt(b.note) : null }),
    } });
    res.json({ data: { ...view(row), breakdown: result } });
  }));

  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.sleepEntry.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Sleep entry not found');
    res.status(204).end();
  }));

  // Personalised wind-down routine + gradual bedtime shift (Kaizen applied to sleep).
  r.get('/routine', asyncHandler(async (req, res) => {
    const info = await profileInfo(req.user.id);
    const today = routineDate(info.tz);
    const [recent, evening, log] = await Promise.all([
      d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 7 }),
      d.db.checkIn.findFirst({ where: { userId: req.user.id, kind: 'EVENING' }, orderBy: { createdAt: 'desc' } }),
      d.db.routineLog.findUnique({ where: { userId_date: { userId: req.user.id, date: today } } }),
    ]);
    const tonight = gradualBedtime(recent.map((x) => x.bedtime), info.desired);
    const { doneIds, extras } = await loadLog(d.db, req.user.id, today);
    const v = composeRoutine(tonight, evening?.stress, extras, doneIds, info.locale);
    // steps: built-in wind-down steps plus any the Sleep Coach added tonight (extra:true), each with a localized label and done flag.
    // stepsDone / stepsTotal count every step except bedtime itself. `log` is read only for older clients' counters.
    res.json({ data: { desiredBedtime: info.desired, tonightBedtime: tonight, steps: v.steps, stepsDone: Math.max(v.stepsDone, log?.stepsDone ?? 0), stepsTotal: v.stepsTotal, doneIds, extras } });
  }));

  /** The routine as the app shows it, after a change (same shape as GET /routine). */
  async function routineNow(userId: string) {
    const t = await tonightFor(d.db, userId);
    const today = routineDate(t.tz);
    const bedtime = gradualBedtime(t.recent.map((x) => x.bedtime), t.desired);
    const { doneIds, extras } = await loadLog(d.db, userId, today);
    const v = composeRoutine(bedtime, t.eveningStress, extras, doneIds, t.locale);
    return { desiredBedtime: t.desired, tonightBedtime: bedtime, steps: v.steps, stepsDone: v.stepsDone, stepsTotal: v.stepsTotal, doneIds, extras };
  }

  // Mark one routine step done / not done (the undo of an automatic mark after a practice is done: false).
  r.put('/routine/done/:stepId', validate({ params: z.object({ stepId: z.string().min(1).max(40) }), body: z.object({ done: z.boolean() }) }), asyncHandler(async (req, res) => {
    const { tz } = await profileInfo(req.user.id);
    const saved = await setStepDone(d.db, req.user.id, routineDate(tz), req.params.stepId, req.body.done);
    if (!saved) throw notFound('Routine step not found');
    res.json({ data: await routineNow(req.user.id) });
  }));

  // "Add to tonight's routine" (the Sleep Coach button). stepId is one of the ROUTINE_EXTRAS ids the coach returned in `routineStep`.
  r.post('/routine/steps', validate({ body: z.object({ stepId: z.enum(Object.keys(ROUTINE_EXTRAS) as [string, ...string[]]) }) }), asyncHandler(async (req, res) => {
    const { tz } = await profileInfo(req.user.id);
    const out = await addExtra(d.db, req.user.id, routineDate(tz), req.body.stepId);
    res.status(out?.added ? 201 : 200).json({ data: { added: !!out?.added, routine: await routineNow(req.user.id) } });
  }));
  r.delete('/routine/steps/:stepId', validate({ params: z.object({ stepId: z.string().min(1).max(40) }) }), asyncHandler(async (req, res) => {
    const { tz } = await profileInfo(req.user.id);
    await removeExtra(d.db, req.user.id, routineDate(tz), req.params.stepId);
    res.json({ data: await routineNow(req.user.id) });
  }));

  r.post('/routine/log', validate({ body: z.object({ stepsDone: z.number().int().min(0).max(10), stepsTotal: z.number().int().min(1).max(10) }) }), asyncHandler(async (req, res) => {
    const { tz } = await profileInfo(req.user.id);
    const date = routineDate(tz);
    const row = await d.db.routineLog.upsert({
      where: { userId_date: { userId: req.user.id, date } }, create: { userId: req.user.id, date, ...req.body }, update: req.body,
    });
    res.json({ data: { stepsDone: row.stepsDone, stepsTotal: row.stepsTotal } });
  }));

  // AI Sleep Coach: practical suggestion from the user's own diary. Falls back to a rule-based tip if the AI is unavailable.
  // Consent is checked first (403 CONSENT_REQUIRED, like journal AI) so the diary never reaches the model without opt-in; the rule-based fallback is only for AI failures.
  r.post('/coach', d.messageLimiter, asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'The AI sleep coach needs your explicit consent to read your sleep diary');
    const info = await profileInfo(req.user.id);
    // Risk signals: the model is not called and no routine step is offered.
    if (await userHasRisk(d.db, d.cipher, req.user.id)) { res.json({ data: { text: RISK_NEUTRAL[copyLang(info.locale)], ai: false, routineStep: null, riskMode: true } }); return; }
    const rows = await d.db.sleepEntry.findMany({ where: { userId: req.user.id }, orderBy: { date: 'desc' }, take: 7 });
    if (!rows.length) {
      res.json({ data: { text: info.lang === 'bn' ? 'আগে একটি Sleep Diary এন্ট্রি যোগ করুন, তারপর আমি আপনার জন্য ব্যক্তিগত পরামর্শ দিতে পারব।' : 'Add a sleep diary entry first, then I can give you personal suggestions.', ai: false, routineStep: null, riskMode: false } });
      return;
    }
    const rested = rows.filter((x) => x.rested != null);
    const avg = (f: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + f(x), 0) / rows.length;
    const facts = `Last ${rows.length} nights. Desired bedtime ${info.desired}. Average sleep ${(avg((x) => x.durationMin) / 60).toFixed(1)} h, average awakenings ${avg((x) => x.awakenings).toFixed(1)}${rested.length ? `, average rested feeling ${(rested.reduce((t, x) => t + (x.rested ?? 0), 0) / rested.length).toFixed(1)}/10` : ''}, average score ${Math.round(avg((x) => x.score))}/100. Bedtimes: ${rows.map((x) => x.bedtime).join(', ')}.`;
    const fallback = info.lang === 'bn'
      ? `গত কয়েক রাতে গড়ে ${(avg((x) => x.durationMin) / 60).toFixed(1)} ঘণ্টা ঘুমিয়েছেন। আজ রাতে wind-down রুটিন ১৫ মিনিট আগে শুরু করে দেখবেন কি?`
      : `You slept about ${(avg((x) => x.durationMin) / 60).toFixed(1)} h on average lately. Would you like to start your wind-down routine 15 minutes earlier tonight?`;
    // "Add to tonight's routine": a rule-based pick from the same diary rows (no extra model call). POST /sleep/routine/steps { stepId } adds it.
    const extraId = coachExtraFor(rows);
    const routineStep = { stepId: extraId, label: pick(ROUTINE_EXTRAS[extraId]!.label, info.locale), minutes: ROUTINE_EXTRAS[extraId]!.minutes };
    const t0 = Date.now();
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You are the Nivora AI Sleep Coach, a calm wellness companion (not a doctor). Give ONE practical, gentle suggestion in 2-4 short sentences based only on the user's diary. Smallest useful change first (Kaizen). Never diagnose sleep disorders, never mention medication or supplements, never shame. ${LUC_SINGLE_SHOT} Reply in ${aiReplyLanguage(info.locale)}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 300 });
      const text = out.content.trim();
      // Every model output goes through checkOutput; anything flagged is replaced by the rule-based text (ai:false).
      const ok = !!text && outputOk(text);
      void d.telemetry.model(req.user.id, 'sleep_coach', Date.now() - t0, !ok);
      res.json({ data: { text: ok ? text : fallback, ai: ok, routineStep, riskMode: false } });
    } catch {
      void d.telemetry.model(req.user.id, 'sleep_coach', Date.now() - t0, true);
      res.json({ data: { text: fallback, ai: false, routineStep, riskMode: false } });
    }
  }));
  // ── Dream Decoder ─────────────────────────────────────────────────────────
  // POST /sleep/dream-decode: Poetic metaphorical interpretation of last night's sleep.
  // Consent required. No free text input — no crisis guard needed here.
  r.post('/dream-decode', validate({ body: z.object({
    durationMin: z.number().int().min(0).max(1440),
    awakenings: z.number().int().min(0).max(20),
    rested: z.number().int().min(1).max(10),
    score: z.number().int().min(0).max(100),
  }) }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Luna needs your consent to interpret your sleep data');
    const info = await profileInfo(req.user.id);
    const { decodeDream } = await import('../../services/sleepAiService.js');
    const result = await decodeDream(d.glm, { ...req.body, locale: info.locale });
    res.json({ data: result });
  }));

  // ── Moon Breath Coach ─────────────────────────────────────────────────────
  // POST /sleep/moon-breath: Select adaptive breathing pattern based on mood.
  r.post('/moon-breath', validate({ body: z.object({
    moodLevel: z.number().int().min(1).max(5),
  }) }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Luna needs your consent to guide your breathing');
    const info = await profileInfo(req.user.id);
    const { guideMoonBreath } = await import('../../services/sleepAiService.js');
    const result = await guideMoonBreath(d.glm, { moodLevel: req.body.moodLevel, locale: info.locale });
    res.json({ data: result });
  }));

  // ── Night Whisperer ───────────────────────────────────────────────────────
  // POST /sleep/night-whisper: CBT cognitive offloading before sleep.
  // guardFreeText FIRST — highest-risk endpoint.
  r.post('/night-whisper', d.messageLimiter, validate({ body: z.object({
    thought: z.string().min(1).max(500).trim(),
  }) }), asyncHandler(async (req, res) => {
    const guard = await guardInput(d.db, d.glm, req.user.id, req.body.thought); const crisis = guard.crisis;
    if (crisis) { res.json({ data: { ...crisis, riskMode: true } }); return; }
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Luna needs your consent to hold your thoughts');
    if (guard.skipAi || await userHasRisk(d.db, d.cipher, req.user.id)) {
      const info = await profileInfo(req.user.id);
      res.json({ data: { text: RISK_NEUTRAL[copyLang(info.locale)], riskMode: true } });
      return;
    }
    const info = await profileInfo(req.user.id);
    const { decodeNightWhisper } = await import('../../services/sleepAiService.js');
    const result = await decodeNightWhisper(d.glm, { thought: req.body.thought, locale: info.locale });
    res.json({ data: { ...result, riskMode: false } });
  }));

  // ── Sleep Oracle ──────────────────────────────────────────────────────────
  // POST /sleep/oracle: 7-night pattern analysis + tonight prediction.
  r.post('/oracle', validate({ body: z.object({
    entries: z.array(z.object({
      date: z.string(),
      score: z.number(),
      bedtime: z.string(),
      durationMin: z.number(),
      awakenings: z.number(),
    })).min(1).max(14),
  }) }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Luna needs your consent to read your sleep history');
    const info = await profileInfo(req.user.id);
    const { readSleepOracle } = await import('../../services/sleepAiService.js');
    const result = await readSleepOracle(d.glm, { entries: req.body.entries, locale: info.locale });
    res.json({ data: result });
  }));

  // ── Luna's Lullaby Composer ───────────────────────────────────────────────
  // POST /sleep/lullaby: AI-generated personalized sleep story.
  r.post('/lullaby', d.messageLimiter, validate({ body: z.object({
    setting: z.enum(['ocean', 'forest', 'cloud', 'mountain', 'moonlit_garden']),
    mood: z.enum(['calm', 'tired', 'anxious', 'grateful']),
    length: z.enum(['short', 'long']),
    userName: z.string().max(50).optional(),
  }) }), asyncHandler(async (req, res) => {
    const guard = await guardInput(d.db, d.glm, req.user.id, req.body.userName); // free text that goes straight into the prompt
    if (guard.crisis) { res.json({ data: guard.crisis }); return; }
    await requireConsent(d.db, req.user.id, 'WELLNESS_AI_SHARING', 'Luna needs your consent to write your story');
    const info = await profileInfo(req.user.id);
    const { composeLullaby } = await import('../../services/sleepAiService.js');
    const name = guard.skipAi ? info.locale : (req.body.userName ?? info.locale);
    const result = await composeLullaby(d.glm, { ...req.body, userName: name, locale: info.locale });
    res.json({ data: result });
  }));

  return r;
}
