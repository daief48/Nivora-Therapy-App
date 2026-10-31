import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { outputOk, parseJsonObject } from '../../services/aiOutput.js';
import { flowerTotal } from '../../services/gardenService.js';
import { buildAction, TEMPLATES, type KaizenCategory } from '../../services/kaizenEngine.js';
import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { assessSafely } from '../../services/safetyService.js';
import { crisisSafety } from '../../services/crisisResponse.js';
import { copyLang, GENTLER_FALLBACK } from '../../services/wellnessCopy.js';
import { localClock, localDate, toMinutes } from '../../utils/dates.js';
import { goalForCategory, isUniqueViolation, PRACTICE_GOAL_TITLE } from '../../services/kaizenExtras.js';
import { composeRoutine, inWindDownWindow, loadLog, routineDateFor, setStepDone, STEP_FOR_TOOL, tonightFor } from '../../services/routineSteps.js';
import { buildRoutine, gradualBedtime } from '../../services/sleepService.js';
import { requireConsent } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

type Tool = 'THOUGHT_RECORD' | 'GROUNDING' | 'BREATHING' | 'SOUNDS';
// Each tool keeps its own PAUSED Kaizen goal, so a completion grows the garden without touching the user's primary focus.
const TOOLS: Record<Tool, { category: KaizenCategory; title: string }> = {
  THOUGHT_RECORD: { category: 'REFLECTION', title: PRACTICE_GOAL_TITLE.REFLECTION! },
  GROUNDING: { category: 'GROUNDING', title: PRACTICE_GOAL_TITLE.GROUNDING! },
  BREATHING: { category: 'BREATHING', title: PRACTICE_GOAL_TITLE.BREATHING! },
  SOUNDS: { category: 'RELAXATION', title: PRACTICE_GOAL_TITLE.RELAXATION! },
};

const SUMMARY: Record<'en' | 'bn' | 'hi' | 'ne', { head: string; thought: string; feeling: string; alt: string }> = {
  en: { head: 'A thought I looked at today', thought: 'The thought', feeling: 'It felt like', alt: 'A gentler way to see it' },
  bn: { head: 'আজ একটি ভাবনাকে দেখলাম', thought: 'ভাবনাটি', feeling: 'অনুভূতি', alt: 'আরও নরমভাবে দেখলে' },
  hi: { head: 'आज मैंने एक विचार को देखा', thought: 'विचार', feeling: 'महसूस हुआ', alt: 'इसे और नरमी से देखें तो' },
  ne: { head: 'आज मैले एउटा विचारलाई हेरें', thought: 'विचार', feeling: 'महसुस भयो', alt: 'अझ कोमलतासँग हेर्दा' },
};
/** Plain-template summary of a thought record from the person's own fields (no model). */
export function thoughtSummary(b: { situation: string; thought: string; feeling?: string; alternative?: string }, locale?: string | null): string {
  const c = SUMMARY[copyLang(locale)];
  return [`${c.head}.`, b.situation, `${c.thought}: ${b.thought}`, b.feeling ? `${c.feeling}: ${b.feeling}` : '', b.alternative ? `${c.alt}: ${b.alternative}` : ''].filter(Boolean).join('\n').slice(0, 4000);
}

export function practiceRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  /** Records today's completion of a tool as a DONE Kaizen action (once per tool per day). */
  async function complete(userId: string, tool: Tool, minutes: number) {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    const today = localDate(u?.timezone);
    const def = TOOLS[tool];
    const goal = await goalForCategory(d.db, userId, def.category);
    const existing = await d.db.kaizenAction.findUnique({ where: { goalId_date: { goalId: goal.id, date: today } } });
    const counted = !existing || existing.status !== 'DONE';
    if (counted) {
      const unit = TEMPLATES[def.category].unit;
      const text = buildAction(def.category, { target: minutes, unit, micro: false, difficulty: 1, reason: 'user' }, u?.locale === 'bn' ? 'bn' : 'en');
      const data = { title: text.title, description: text.description, targetValue: minutes, unit, status: 'DONE', completedAt: new Date() };
      if (existing) await d.db.kaizenAction.update({ where: { id: existing.id }, data });
      else {
        try { await d.db.kaizenAction.create({ data: { goalId: goal.id, userId, date: today, ...data } }); }
        catch (e) { // a parallel completion created today's row first: update it instead of failing with 500
          if (!isUniqueViolation(e)) throw e;
          await d.db.kaizenAction.update({ where: { goalId_date: { goalId: goal.id, date: today } }, data });
        }
      }
    }
    return { counted, flowers: (await flowerTotal(d.db, userId)).total };
  }

  /**
   * Auto-update of tonight's routine after a practice: breathing, or sleep-related sounds, done inside the wind-down window marks the matching
   * step done. Rule-based and undoable (PUT /sleep/routine/done/:stepId { done:false }). null = nothing to mark (outside the window / other tool).
   */
  async function autoRoutine(userId: string, tool: Tool, sleepRelated: boolean) {
    const stepId = STEP_FOR_TOOL[tool];
    if (!stepId || (tool === 'SOUNDS' && !sleepRelated)) return null;
    const t = await tonightFor(d.db, userId);
    const bedtime = gradualBedtime(t.recent.map((x) => x.bedtime), t.desired);
    const clock = localClock(t.tz);
    if (!inWindDownWindow(clock.minutes, toMinutes(buildRoutine(bedtime, t.eveningStress)[0]!.at), toMinutes(bedtime))) return null;
    const { doneIds } = await loadLog(d.db, userId, routineDateFor(clock));
    if (doneIds.includes(stepId)) return { stepId, marked: false, undo: null };
    await setStepDone(d.db, userId, routineDateFor(clock), stepId, true);
    const { doneIds: ids, extras } = await loadLog(d.db, userId, routineDateFor(clock));
    const v = composeRoutine(bedtime, t.eveningStress, extras, ids, t.locale);
    return { stepId, marked: true, stepsDone: v.stepsDone, stepsTotal: v.stepsTotal, undo: { method: 'PUT', path: `/sleep/routine/done/${stepId}`, body: { done: false } } };
  }

  async function crisisPayload(userId: string, severity: string, categories: string[], text: string) {
    return { crisis: true, safety: await crisisSafety(d.db, userId, severity, categories, text) };
  }
  const isHigh = (s: string) => s === 'HIGH' || s === 'IMMINENT';

  r.post('/breathing', validate({ body: z.object({ minutes: z.number().int().min(1).max(30).default(2) }) }), asyncHandler(async (req, res) => {
    res.status(201).json({ data: { kaizen: await complete(req.user.id, 'BREATHING', req.body.minutes), routine: await autoRoutine(req.user.id, 'BREATHING', true) } });
  }));

  // Calming sounds / a sleep story listened to. Counts for the garden like the other practices; sleepRelated=true inside the wind-down window also marks the
  // routine's sounds step (undoable). Only the completion is recorded, never what was played.
  r.post('/sounds', validate({ body: z.object({ minutes: z.number().int().min(1).max(60).default(5), sleepRelated: z.boolean().default(false) }) }), asyncHandler(async (req, res) => {
    res.status(201).json({ data: { kaizen: await complete(req.user.id, 'SOUNDS', req.body.minutes), routine: await autoRoutine(req.user.id, 'SOUNDS', req.body.sleepRelated) } });
  }));

  // The content of the exercise (what the person noticed) is never sent: only the completion is recorded.
  r.post('/grounding', validate({ body: z.object({ minutes: z.number().int().min(1).max(30).default(2) }) }), asyncHandler(async (req, res) => {
    res.status(201).json({ data: { kaizen: await complete(req.user.id, 'GROUNDING', req.body.minutes) } });
  }));

  // Saved as a THOUGHT_RECORD journal entry (encrypted) and counted in the garden. Risk-checked first: high-risk text is stored nowhere.
  r.post('/thought-record', validate({ body: z.object({
    situation: z.string().trim().min(1).max(1500), thought: z.string().trim().min(1).max(1500), feeling: z.string().trim().max(300).optional(),
    alternative: z.string().trim().max(1500).optional(), moodBefore: z.number().int().min(1).max(10).optional(), moodAfter: z.number().int().min(1).max(10).optional(),
    save: z.boolean().default(true),
  }) }), asyncHandler(async (req, res) => {
    const b = req.body;
    const text = [b.situation, b.thought, b.feeling, b.alternative].filter(Boolean).join('\n');
    const a = assessSafely(text);
    if (isHigh(a.severity)) { res.json({ data: await crisisPayload(req.user.id, a.severity, a.categories, text) }); return; }
    let entryId: string | null = null;
    if (b.save) {
      const e = await d.db.journalEntry.create({ data: { userId: req.user.id, entryType: 'THOUGHT_RECORD', encryptedContent: d.cipher.encrypt(JSON.stringify({
        situation: b.situation, thought: b.thought, feeling: b.feeling ?? null, alternative: b.alternative ?? null, moodBefore: b.moodBefore ?? null, moodAfter: b.moodAfter ?? null,
      })) } });
      entryId = e.id;
    }
    // Offer (not forced): a short journal entry summarising this record, built from the person's OWN words with a fixed template (no model).
    // Not offered when the text raised any safety level. Save it with POST /journal { content: journalOffer.text, entryType: journalOffer.entryType }.
    const journalOffer = a.severity === 'NONE' ? { entryType: 'DAILY_REFLECTION', text: thoughtSummary(b, (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale) } : null;
    res.status(201).json({ data: { crisis: false, entryId, kaizen: await complete(req.user.id, 'THOUGHT_RECORD', 5), routine: null, journalOffer } });
  }));

  // AI helper: ONE gentler alternative to a thought. Consent first (the text goes to the model), then the risk check (high-risk text
  // never reaches the model and is never stored), then checkOutput; any failure returns a fixed reflective prompt with ai:false.
  r.post('/thought-record/alternative', d.messageLimiter, validate({ body: z.object({
    thought: z.string().trim().min(1).max(1500), situation: z.string().trim().max(1500).optional(),
  }) }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'JOURNAL_AI_SHARING', 'Suggesting a gentler thought with the AI needs your explicit consent');
    const { thought, situation } = req.body as { thought: string; situation?: string };
    const text = [situation, thought].filter(Boolean).join('\n');
    const a = assessSafely(text);
    if (isHigh(a.severity)) { res.json({ data: await crisisPayload(req.user.id, a.severity, a.categories, text) }); return; }
    const u = await d.db.user.findUnique({ where: { id: req.user.id } });
    const locale = /[ঀ-৿]/.test(text) ? 'bn' : /[ऀ-ॿ]/.test(text) && u?.locale !== 'ne' ? 'hi' : u?.locale;
    const fallback = () => {
      const list = GENTLER_FALLBACK[copyLang(locale)];
      return list[Math.floor(Date.now() / 86_400_000) % list.length]!;
    };
    const t0 = Date.now();
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You help a person look at one difficult thought more gently, in a private self-care app. Offer ONE gentler, balanced alternative thought, written in the first person, 1-2 short sentences, that the person could believe. Never say the thought is wrong, irrational, distorted or unhelpful; never judge it or the person; never diagnose; never mention medication or supplements; do not dismiss the feeling; no advice or instructions. Reply ONLY with JSON: {"alternative":"..."}. Reply in ${aiReplyLanguage(locale)}.` },
        { role: 'user', content: `${situation ? `Situation: ${situation.slice(0, 1000)}\n` : ''}Thought: ${thought.slice(0, 1000)}` },
      ], { maxTokens: 200 });
      const alt = parseJsonObject(out.content)?.alternative;
      if (typeof alt === 'string') {
        const t = alt.trim();
        if (t.length >= 8 && t.length <= 400 && outputOk(t)) { void d.telemetry.model(req.user.id, 'gentler_thought', Date.now() - t0, false); res.json({ data: { crisis: false, alternative: t, ai: true } }); return; }
      }
      void d.telemetry.model(req.user.id, 'gentler_thought', Date.now() - t0, true);
    } catch { void d.telemetry.model(req.user.id, 'gentler_thought', Date.now() - t0, true); /* fall through to the fixed prompt */ }
    res.json({ data: { crisis: false, alternative: fallback(), ai: false } });
  }));
  return r;
}
