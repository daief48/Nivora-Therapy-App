import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { assessSafely, checkOutput, crisisMessage, getResources, pickLang } from '../../services/safetyService.js';
import { consentRequired } from '../../utils/errors.js';
import { activeConsents } from '../consents/consentService.js';
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

// Tiny offline lexicon so the feature still works (softly) when the AI is unavailable.
const LEXICON: { en: string; bn: string; match: RegExp }[] = [
  { en: 'tired', bn: 'ক্লান্ত', match: /tired|exhaust|drain|ক্লান্ত|অবসন্ন/i },
  { en: 'anxious', bn: 'উদ্বিগ্ন', match: /anxi|worr|nervous|panic|scared|afraid|চিন্তা|ভয়|উদ্বিগ্ন/i },
  { en: 'sad', bn: 'মন খারাপ', match: /\bsad\b|down|cry|lonely|empty|মন খারাপ|কষ্ট|একা/i },
  { en: 'angry', bn: 'রাগ', match: /angry|mad\b|furious|annoy|irritat|রাগ|বিরক্ত/i },
  { en: 'grateful', bn: 'কৃতজ্ঞ', match: /grate|thank|appreciat|কৃতজ্ঞ|ধন্যবাদ/i },
  { en: 'hopeful', bn: 'আশাবাদী', match: /hope|better|look forward|আশা/i },
  { en: 'calm', bn: 'শান্ত', match: /calm|peace|relax|শান্ত|স্বস্তি/i },
  { en: 'happy', bn: 'খুশি', match: /happy|joy|glad|excited|খুশি|আনন্দ/i },
  { en: 'overwhelmed', bn: 'ভারাক্রান্ত', match: /overwhelm|too much|stress|pressure|চাপ|ভারাক্রান্ত/i },
];

const SUGGESTIONS: Record<Lang, string> = {
  en: 'If it feels right, take three slow breaths and let your shoulders drop.',
  bn: 'ভালো লাগলে তিনটি ধীর শ্বাস নিন আর কাঁধ আলগা করে দিন।',
};

function parseJson(raw: string): any | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

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
    const lang = await langOf(req.user.id, topic);
    const aiLang = await aiLangOf(req.user.id, topic);
    const sev = topic ? assessSafely(topic).severity : 'NONE';
    if (sev === 'HIGH' || sev === 'IMMINENT') { res.json({ data: { prompts: pickStatic(lang), ai: false } }); return; }
    try {
      const facts = [mood ? `Mood ${mood}/10.` : '', stress ? `Stress ${stress}/10.` : '', topic ? `Topic: ${topic}` : ''].filter(Boolean).join(' ') || 'No details.';
      const out = await d.glm.chat([
        { role: 'system', content: `You write gentle journaling prompts for a wellness app. Give exactly 3 short, open, non-judgmental prompts (one sentence each), no diagnosis, no advice, suitable for someone who may be low on energy. Reply ONLY with JSON: {"prompts":["...","...","..."]}. Language: ${aiLang}.` },
        { role: 'user', content: facts },
      ], { maxTokens: 300 });
      const list = (parseJson(out.content)?.prompts as unknown[] | undefined)?.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && checkOutput(x).ok).map((x) => x.trim().slice(0, 240)).slice(0, 3);
      if (list && list.length === 3) { res.json({ data: { prompts: list, ai: true } }); return; }
    } catch { /* fall through to the static list */ }
    res.json({ data: { prompts: pickStatic(lang), ai: false } });
  }));

  r.post('/emotions', d.messageLimiter, validate({ body: z.object({ text: z.string().trim().min(1).max(6000) }) }), asyncHandler(async (req, res) => {
    const text = req.body.text as string;
    if (!(await activeConsents(d.db, req.user.id)).has('JOURNAL_AI_SHARING')) throw consentRequired('Reading your writing with the AI needs your explicit consent');
    // Safety first: high-risk text never reaches the model and is never stored.
    const a = assessSafely(text);
    if (a.severity === 'HIGH' || a.severity === 'IMMINENT') {
      const profile = await d.db.userProfile.findUnique({ where: { userId: req.user.id } });
      const resources = await getResources(d.db, profile?.countryCode);
      await d.db.safetyEvent.create({ data: { userId: req.user.id, severity: a.severity, category: a.categories.join(',') || null, actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
      res.json({ data: { crisis: true, safety: { severity: a.severity, crisis: true, resources, message: crisisMessage(a.severity, pickLang('mixed', text), resources) } } });
      return;
    }
    const lang = await langOf(req.user.id, text);
    const aiLang = await aiLangOf(req.user.id, text);
    const fallback = () => {
      const emotions = LEXICON.filter((x) => x.match.test(text)).slice(0, 6).map((x) => (lang === 'bn' ? x.bn : x.en));
      return {
        emotions,
        reflection: emotions.length
          ? (lang === 'bn' ? `আপনার লেখায় এই শব্দগুলো উঠে এসেছে: ${emotions.join(', ')}।` : `These words showed up in your writing: ${emotions.join(', ')}.`)
          : (lang === 'bn' ? 'আপনার লেখা থেকে নির্দিষ্ট কোনো অনুভূতির শব্দ পাওয়া যায়নি, আর সেটাও ঠিক আছে।' : 'No clear feeling words showed up, and that is okay.'),
        suggestion: SUGGESTIONS[lang], ai: false,
      };
    };
    try {
      const out = await d.glm.chat([
        { role: 'system', content: `You help a person notice feeling words in their private journal. List up to 6 emotion words that appear or are gently implied in the text, a one-line neutral reflection phrased as "words that showed up in your writing" (never a clinical reading, never a diagnosis, no judgement), and ONE tiny, optional, Kaizen-style suggestion that takes under two minutes. Reply ONLY with JSON: {"emotions":["..."],"reflection":"...","suggestion":"..."}. Language: ${aiLang}.` },
        { role: 'user', content: text.slice(0, 4000) },
      ], { maxTokens: 350 });
      const j = parseJson(out.content);
      const emotions = Array.isArray(j?.emotions) ? (j.emotions as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 30)).slice(0, 6) : [];
      const reflection = typeof j?.reflection === 'string' ? j.reflection.trim().slice(0, 300) : '';
      const suggestion = typeof j?.suggestion === 'string' ? j.suggestion.trim().slice(0, 300) : '';
      if (emotions.length && reflection && checkOutput([...emotions, reflection, suggestion].join(' ')).ok) {
        res.json({ data: { crisis: false, emotions, reflection, suggestion: suggestion || SUGGESTIONS[lang], ai: true } });
        return;
      }
    } catch { /* fall back to the offline word list */ }
    res.json({ data: { crisis: false, ...fallback() } });
  }));
  return r;
}
