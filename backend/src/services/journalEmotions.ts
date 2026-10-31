import type { GlmClient } from './glmClient.js';
import { outputOk } from './aiOutput.js';
import { hasFeeling } from './feelingMatch.js';

export type Lang = 'en' | 'bn';

// Tiny offline lexicon so the feature still works (softly) when the AI is unavailable.
// Word boundaries, negation-aware (see feelingMatch.ts). "hopeless" is listed before "hopeful" and bhopeb does not match inside it.
const LEXICON: { en: string; bn: string; match: RegExp }[] = [
  { en: 'tired', bn: 'ক্লান্ত', match: /\btired\b|\bexhaust(?:ed|ing)?\b|\bdrained?\b|ক্লান্ত|অবসন্ন/i },
  { en: 'anxious', bn: 'উদ্বিগ্ন', match: /\banxi(?:ous|ety)\b|\bworr(?:y|ied|ies|ying)\b|\bnervous\b|\bpanic(?:king|ked)?\b|\bscared\b|\bafraid\b|চিন্তা|ভয়|উদ্বিগ্ন/i },
  { en: 'sad', bn: 'মন খারাপ', match: /\bsad\b|\b(?:feel(?:ing)?|felt|am|i'm|so|really|very) down\b|\bcry(?:ing)?\b|\bcried\b|\blonely\b|\b(?:feel(?:ing)?|felt|so|very|all|am|i'm) alone\b|\bempty\b|মন খারাপ|কষ্ট|একা/i },
  { en: 'hopeless', bn: 'হতাশ', match: /\bhopeless(?:ness)?\b|হতাশ|আশা নেই/i },
  { en: 'angry', bn: 'রাগ', match: /\bangry\b|\bmad\b|\bfurious\b|\bannoy(?:ed|ing)\b|\birritat(?:ed|ing)\b|রাগ|বিরক্ত/i },
  { en: 'grateful', bn: 'কৃতজ্ঞ', match: /\bgrateful\b|\bgratitude\b|\bthank(?:s|ful| you)?\b|\bappreciat(?:e|ed|ive)\b|কৃতজ্ঞ|ধন্যবাদ/i },
  { en: 'hopeful', bn: 'আশাবাদী', match: /\bhopeful\b|\bhope\b|\blook(?:ing)? forward\b|\bfeel(?:ing)? better\b|আশাবাদী/i },
  { en: 'calm', bn: 'শান্ত', match: /\bcalm\b|\bpeace(?:ful)?\b|\brelax(?:ed|ing)?\b|শান্ত|স্বস্তি/i },
  { en: 'happy', bn: 'খুশি', match: /\bhappy\b|\bjoy(?:ful)?\b|\bglad\b|\bexcited\b|খুশি|আনন্দ/i },
  { en: 'overwhelmed', bn: 'ভারাক্রান্ত', match: /\boverwhelm(?:ed|ing)?\b|\btoo much\b|\bstress(?:ed|ful)?\b|\bpressure\b|চাপ|ভারাক্রান্ত/i },
];

export const SUGGESTIONS: Record<Lang, string> = {
  en: 'If it feels right, take three slow breaths and let your shoulders drop.',
  bn: 'ভালো লাগলে তিনটি ধীর শ্বাস নিন আর কাঁধ আলগা করে দিন।',
};

export function parseJson(raw: string): any | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export interface EmotionWords { emotions: string[]; reflection: string; suggestion: string; ai: boolean }

/**
 * Emotion words for one piece of journal writing. The caller must already have checked JOURNAL_AI_SHARING consent and the risk check
 * (HIGH / IMMINENT text must never get here). Model output goes through checkOutput; any failure returns the offline word list (ai:false).
 */
export async function journalEmotions(glm: GlmClient, text: string, lang: Lang, aiLang: string): Promise<EmotionWords> {
  const fallback = (): EmotionWords => {
    const emotions = LEXICON.filter((x) => hasFeeling(x.match, text)).slice(0, 6).map((x) => (lang === 'bn' ? x.bn : x.en));
    return {
      emotions,
      reflection: emotions.length
        ? (lang === 'bn' ? `আপনার লেখায় এই শব্দগুলো উঠে এসেছে: ${emotions.join(', ')}।` : `These words showed up in your writing: ${emotions.join(', ')}.`)
        : (lang === 'bn' ? 'আপনার লেখা থেকে নির্দিষ্ট কোনো অনুভূতির শব্দ পাওয়া যায়নি, আর সেটাও ঠিক আছে।' : 'No clear feeling words showed up, and that is okay.'),
      suggestion: SUGGESTIONS[lang], ai: false,
    };
  };
  try {
    const out = await glm.chat([
      { role: 'system', content: `You help a person notice feeling words in their private journal. List up to 6 emotion words that appear or are gently implied in the text, a one-line neutral reflection phrased as "words that showed up in your writing" (never a clinical reading, never a diagnosis, no judgement), and ONE tiny, optional, Kaizen-style suggestion that takes under two minutes. Reply ONLY with JSON: {"emotions":["..."],"reflection":"...","suggestion":"..."}. Language: ${aiLang}.` },
      { role: 'user', content: text.slice(0, 4000) },
    ], { maxTokens: 350 });
    const j = parseJson(out.content);
    const emotions = Array.isArray(j?.emotions) ? (j.emotions as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 30)).slice(0, 6) : [];
    const reflection = typeof j?.reflection === 'string' ? j.reflection.trim().slice(0, 300) : '';
    const suggestion = typeof j?.suggestion === 'string' ? j.suggestion.trim().slice(0, 300) : '';
    if (emotions.length && reflection && outputOk(...emotions, reflection, suggestion)) {
      return { emotions, reflection, suggestion: suggestion || SUGGESTIONS[lang], ai: true };
    }
  } catch { /* fall back to the offline word list */ }
  return fallback();
}
