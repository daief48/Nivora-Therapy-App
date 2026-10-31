import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { assessSafely } from '../../services/safetyService.js';
import { crisisSafety } from '../../services/crisisResponse.js';
import { outputOk } from '../../services/aiOutput.js';
import { userHasRisk } from '../../services/riskState.js';
import { journalEmotions, parseJson } from '../../services/journalEmotions.js';
import { requireConsent } from '../consents/consentService.js';
import { buildStep, saveReading } from '../../services/journalReading.js';
import type { Deps } from '../deps.js';

type Lang = 'en' | 'bn';

const STATIC_PROMPTS: Record<Lang, string[]> = {
  en: [
    'What is one small thing that felt okay today, even for a moment?',
    'What is on your mind right now? Write it down without fixing it.',
    'What would you say to a friend who felt the way you do today?',
    'What did your body need today, and what is one gentle way to give it?',
    'Name one thing you are quietly grateful for.',
  ],
  bn: [
    'আজ ছোট কোন একটি জিনিস, এক মুহূর্তের জন্যও, ভালো লেগেছে?',
    'এখন মনে কী ঘুরছে? ঠিক করার চেষ্টা না করে শুধু লিখে ফেলুন।',
    'আপনার মতো অনুভব করা কোনো বন্ধুকে আপনি কী বলতেন?',
    'আজ আপনার শরীর কী চেয়েছিল, আর তাকে একটু যত্ন দেওয়ার সহজ উপায় কী?',
    'নীরবে কৃতজ্ঞ এমন একটি জিনিসের নাম লিখুন।',
  ],
};

export function journalAiRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function langOf(userId: string, text = ''): Promise<Lang> {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    if (/[ঀ-৿]/.test(text)) return 'bn';
    return u?.locale === 'bn' ? 'bn' : 'en';
  }
  /** Reply language for the model: the user's locale, or Devanagari text in a non-Devanagari locale defaults to Hindi. */
  async function aiLangOf(userId: string, text = ''): Promise<string> {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    if (/[ঀ-৿]/.test(text)) return aiReplyLanguage('bn');
    if (/[ऀ-ॿ]/.test(text) && u?.locale !== 'ne') return aiReplyLanguage('hi');
    return aiReplyLanguage(u?.locale);
  }
  const pickStatic = (lang: Lang) => {
    const day = Math.floor(Date.now() / 86_400_000);
    return [0, 1, 2].map((i) => STATIC_PROMPTS[lang][(day + i) % STATIC_PROMPTS[lang].length]!);
  };

  r.post('/prompts', d.messageLimiter, validate({ body: z.object({
    mood: z.number().int().min(1).max(10).optional(), stress: z.number().int().min(1).max(10).optional(), topic: z.string().trim().max(200).optional(),
  }) }), asyncHandler(async (req, res) => {
    const { mood, stress, topic } = req.body as { mood?: number; stress?: number; topic?: string };
    // Mood/stress and the free-text topic go to the model, so consent is required up front (403 like /emotions), never a silent static fallback.
    await requireConsent(d.db, req.user.id, 'JOURNAL_AI_SHARING', 'Personalised prompts with the AI need your explicit consent');
    const lang = await langOf(req.user.id, topic);
    const aiLang = await aiLangOf(req.user.id, topic);
    const sev = topic ? assessSafely(topic).severity : 'NONE';
    if (sev === 'HIGH' || sev === 'IMMINENT') { res.json({ data: { prompts: pickStatic(lang), ai: false } }); return; }
    const t0 = Date.now();
    try {
      const facts = [mood ? `Mood ${mood}/10.` : '', stress ? `Stress ${stress}/10.` : '', topic ? `Topic: ${topic}` : ''].filter(Boolean).join(' ') || 'No details.';
      const out = await d.glm.chat([
        { role: 'system', content: `You write gentle journaling prompts for a wellness app. Give exactly 3 short, open, non-judgmental prompts (one sentence each), no diagnosis, no advice, suitable for someone who may be low on energy. Reply ONLY with JSON: {"prompts":["...","...","..."]}. Language: ${aiLang}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 300 });
      const list = (parseJson(out.content)?.prompts as unknown[] | undefined)?.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && outputOk(x)).map((x) => x.trim().slice(0, 240)).slice(0, 3);
      void d.telemetry.model(req.user.id, 'journal_prompts', Date.now() - t0, !(list && list.length === 3));
      if (list && list.length === 3) { res.json({ data: { prompts: list, ai: true } }); return; }
    } catch { void d.telemetry.model(req.user.id, 'journal_prompts', Date.now() - t0, true); /* fall through to the static list */ }
    res.json({ data: { prompts: pickStatic(lang), ai: false } });
  }));

  // entryId (optional, own entry): the reading and its 2-minute step are saved with the entry; add the step to Kaizen with POST /journal/:id/kaizen-step.
  r.post('/emotions', d.messageLimiter, validate({ body: z.object({ text: z.string().trim().min(1).max(6000), entryId: z.string().uuid().optional() }) }), asyncHandler(async (req, res) => {
    const text = req.body.text as string;
    await requireConsent(d.db, req.user.id, 'JOURNAL_AI_SHARING', 'Reading your writing with the AI needs your explicit consent');
    // Safety first: high-risk text never reaches the model and is never stored.
    const a = assessSafely(text);
    if (a.severity === 'HIGH' || a.severity === 'IMMINENT') {
      res.json({ data: { crisis: true, safety: await crisisSafety(d.db, req.user.id, a.severity, a.categories, text) } });
      return;
    }
    const lang = await langOf(req.user.id, text);
    const aiLang = await aiLangOf(req.user.id, text);
    const t0 = Date.now();
    // Under risk signals (rule: no feature proposes a task) the feeling words stay but there is no suggestion and no 2-minute step.
    const riskMode = await userHasRisk(d.db, d.cipher, req.user.id);
    const w0 = await journalEmotions(d.glm, text, lang, aiLang);
    const w = riskMode ? { ...w0, suggestion: '' } : w0;
    void d.telemetry.model(req.user.id, 'emotion_words', Date.now() - t0, !w.ai);
    const loc = (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale;
    const step = riskMode ? null : buildStep(w.emotions, text, loc); // null when the text raised any safety level or risk signals exist
    let saved = false;
    if (req.body.entryId) saved = await saveReading(d.db, d.cipher, req.user.id, req.body.entryId, { ...w, step });
    res.json({ data: { crisis: false, riskMode, ...w, step, saved } });
  }));
  return r;
}
