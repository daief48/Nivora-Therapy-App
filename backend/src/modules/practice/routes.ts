import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { outputOk, parseJsonObject } from '../../services/aiOutput.js';
import { flowerTotal } from '../../services/gardenService.js';
import { buildAction, TEMPLATES, type KaizenCategory } from '../../services/kaizenEngine.js';
import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { assessSafely, crisisMessage, getResources, pickLang } from '../../services/safetyService.js';
import { copyLang, GENTLER_FALLBACK } from '../../services/wellnessCopy.js';
import { localDate } from '../../utils/dates.js';
import { requireConsent } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

type Tool = 'THOUGHT_RECORD' | 'GROUNDING' | 'BREATHING';
// Each tool keeps its own PAUSED Kaizen goal, so a completion grows the garden without touching the user's primary focus.
const TOOLS: Record<Tool, { category: KaizenCategory; title: string }> = {
  THOUGHT_RECORD: { category: 'REFLECTION', title: 'Thought record' },
  GROUNDING: { category: 'GROUNDING', title: 'Grounding 5-4-3-2-1' },
  BREATHING: { category: 'BREATHING', title: 'Breathing' },
};

export function practiceRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  /** Records today's completion of a tool as a DONE Kaizen action (once per tool per day). */
  async function complete(userId: string, tool: Tool, minutes: number) {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    const today = localDate(u?.timezone);
    const def = TOOLS[tool];
    const goal = (await d.db.kaizenGoal.findFirst({ where: { userId, title: def.title, category: def.category } }))
      ?? await d.db.kaizenGoal.create({ data: { userId, title: def.title, category: def.category, status: 'PAUSED', currentTarget: TEMPLATES[def.category].start } });
    const existing = await d.db.kaizenAction.findUnique({ where: { goalId_date: { goalId: goal.id, date: today } } });
    const counted = !existing || existing.status !== 'DONE';
    if (counted) {
      const unit = TEMPLATES[def.category].unit;
      const text = buildAction(def.category, { target: minutes, unit, micro: false, difficulty: 1, reason: 'user' }, u?.locale === 'bn' ? 'bn' : 'en');
      const data = { title: text.title, description: text.description, targetValue: minutes, unit, status: 'DONE', completedAt: new Date() };
      if (existing) await d.db.kaizenAction.update({ where: { id: existing.id }, data });
      else await d.db.kaizenAction.create({ data: { goalId: goal.id, userId, date: today, ...data } });
    }
    return { counted, flowers: (await flowerTotal(d.db, userId)).total };
  }

  async function crisisPayload(userId: string, severity: string, categories: string[], text: string) {
    const profile = await d.db.userProfile.findUnique({ where: { userId } });
    const resources = await getResources(d.db, profile?.countryCode);
    await d.db.safetyEvent.create({ data: { userId, severity, category: categories.join(',') || null, actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    return { crisis: true, safety: { severity, crisis: true, resources, message: crisisMessage(severity as 'HIGH' | 'IMMINENT', pickLang('mixed', text), resources) } };
  }
  const isHigh = (s: string) => s === 'HIGH' || s === 'IMMINENT';

  r.post('/breathing', validate({ body: z.object({ minutes: z.number().int().min(1).max(30).default(2) }) }), asyncHandler(async (req, res) => {
    res.status(201).json({ data: { kaizen: await complete(req.user.id, 'BREATHING', req.body.minutes) } });
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
    res.status(201).json({ data: { crisis: false, entryId, kaizen: await complete(req.user.id, 'THOUGHT_RECORD', 5) } });
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
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You help a person look at one difficult thought more gently, in a private self-care app. Offer ONE gentler, balanced alternative thought, written in the first person, 1-2 short sentences, that the person could believe. Never say the thought is wrong, irrational, distorted or unhelpful; never judge it or the person; never diagnose; never mention medication or supplements; do not dismiss the feeling; no advice or instructions. Reply ONLY with JSON: {"alternative":"..."}. Reply in ${aiReplyLanguage(locale)}.` },
        { role: 'user', content: `${situation ? `Situation: ${situation.slice(0, 1000)}\n` : ''}Thought: ${thought.slice(0, 1000)}` },
      ], { maxTokens: 200 });
      const alt = parseJsonObject(out.content)?.alternative;
      if (typeof alt === 'string') {
        const t = alt.trim();
        if (t.length >= 8 && t.length <= 400 && outputOk(t)) { res.json({ data: { crisis: false, alternative: t, ai: true } }); return; }
      }
    } catch { /* fall through to the fixed prompt */ }
    res.json({ data: { crisis: false, alternative: fallback(), ai: false } });
  }));
  return r;
}
