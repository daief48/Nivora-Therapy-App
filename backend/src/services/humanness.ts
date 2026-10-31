import { splitSentences } from './spokenReply.js';

/**
 * "Does the AI sound human?" as numbers. Pure functions (no I/O, no logging) over a list of assistant replies in conversation
 * order plus the user messages they answered (userMessages[i] answered by replies[i]; shorter lists are tolerated).
 * Language-agnostic: tokenising uses Unicode letter/mark/number classes, so Bangla, Devanagari (Hindi/Nepali) and Latin all work.
 *
 * THRESHOLDS (a check fails when crossed):
 *   openingRepeatRate    < 0.20  share of replies (from the 2nd) whose first 2 words equal the opening of one of the previous 3 replies
 *   questionEndingRate   <= 0.55 share of replies whose LAST sentence is a question
 *   maxQuestionStreak    <= 2    longest run of consecutive replies ending in a question
 *   medianLengthRatio    0.4..4  median of reply chars / max(user chars, 40)
 *   stockPhraseRate      <= 0.15 replies containing a robotic phrase (or a repeated validation line) / replies
 *   sentenceLengthCv     >= 0.25 coefficient of variation of sentence length in words (uniform sentences read as machine-made)
 *
 * humannessScore (0..100) = sum of weighted components, each 0..1: full marks inside its threshold, linear fall-off to 0 at the
 * "zero point" below. WEIGHTS: opening 20, questionEnding 20, streak 15, length 15, stock 20, variance 10.
 * A transcript PASSES when no check fails AND score >= PASS_SCORE (70).
 */
export const THRESHOLDS = {
  openingRepeatMax: 0.2, openingRepeatZero: 0.6, openingWords: 2, openingWindow: 3,
  questionEndingMax: 0.55, questionEndingZero: 1,
  questionStreakMax: 2,
  lengthRatioMin: 0.4, lengthRatioMax: 4, userCharFloor: 40,
  stockRateMax: 0.15, stockRateZero: 0.5,
  sentenceCvMin: 0.25,
  passScore: 70,
} as const;
export const WEIGHTS = { opening: 20, questionEnding: 20, streak: 15, length: 15, stock: 20, variance: 10 } as const;
export const PASS_SCORE = THRESHOLDS.passScore;

/** Phrases that read as a script. Matched on normalised text (lower-case, punctuation stripped, single spaces). Extend freely. */
export const STOCK_PHRASES: Record<'en' | 'bn' | 'hi' | 'ne', string[]> = {
  en: ['i understand how you feel', 'as an ai', 'it is important to', 'its important to', 'it is important that', 'remember that', 'i am here to help', 'i am here to listen',
    'thank you for sharing', 'it is completely normal', 'it is okay to feel', 'your feelings are valid', 'i hear you', 'seek professional help', 'i am sorry to hear that'],
  bn: ['আমি আপনার অনুভূতি বুঝতে পারছি', 'আপনার অনুভূতি বুঝতে পারছি', 'মনে রাখবেন', 'এটা গুরুত্বপূর্ণ যে', 'এটি গুরুত্বপূর্ণ', 'শেয়ার করার জন্য ধন্যবাদ',
    'আপনার অনুভূতি বৈধ', 'একজন এআই হিসেবে', 'এআই হিসাবে', 'আমি আপনাকে সাহায্য করতে এখানে আছি', 'এটা সম্পূর্ণ স্বাভাবিক'],
  hi: ['मैं आपकी भावनाओं को समझ सकता हूँ', 'मैं आपकी भावनाओं को समझ सकती हूँ', 'मैं समझता हूँ कि आप कैसा महसूस', 'याद रखें', 'यह महत्वपूर्ण है', 'साझा करने के लिए धन्यवाद',
    'आपकी भावनाएँ वैध हैं', 'आपकी भावनाएं वैध हैं', 'एक एआई के रूप में', 'मैं आपकी मदद के लिए यहाँ हूँ', 'यह बिल्कुल सामान्य है'],
  ne: ['म तपाईंको भावना बुझ्छु', 'म तपाईंको भावनालाई बुझ्छु', 'याद राख्नुहोस्', 'यो महत्त्वपूर्ण छ', 'यो महत्वपूर्ण छ', 'साझा गरेकोमा धन्यवाद',
    'तपाईंका भावनाहरू वैध छन्', 'एआई को रूपमा', 'म तपाईंलाई मद्दत गर्न यहाँ छु', 'यो पूर्ण रूपमा सामान्य छ'],
};
/** Fine once, robotic when it is the reply's standard move: counted from the 2nd occurrence across the transcript. */
export const REPEAT_ONLY_PHRASES: string[] = [
  'that sounds really hard', 'that sounds really difficult', 'that sounds really tough', 'that sounds really heavy', 'that must be so hard', 'that must be really hard',
  'এটা সত্যিই কঠিন', 'এটা খুব কঠিন', 'এটা সত্যিই কষ্টের', 'यह सच में मुश्किल', 'यह वाकई मुश्किल', 'यो साँच्चै गाह्रो',
];

export interface HumannessMetrics {
  replyCount: number;
  openingRepeatRate: number;
  questionEndingRate: number;
  maxQuestionStreak: number;
  /** Median of reply chars / max(user chars, floor). 0 when no user messages are supplied. */
  medianLengthRatio: number;
  /** Median of reply sentences / user sentences (min 1). Informational, not scored. */
  medianSentenceRatio: number;
  stockPhraseHits: number;
  stockPhraseRate: number;
  sentenceLengthVariance: number;
  sentenceLengthCv: number;
}
export type CheckName = 'openingRepeat' | 'questionEnding' | 'questionStreak' | 'lengthRatio' | 'stockPhrases' | 'sentenceVariety';
export interface HumannessSummary {
  metrics: HumannessMetrics;
  components: Record<'opening' | 'questionEnding' | 'streak' | 'length' | 'stock' | 'variance', number>;
  humannessScore: number;
  failingChecks: CheckName[];
  pass: boolean;
}

// ---------- primitives ----------

const QUESTION_END = /[?؟？]["'”’)\]»\s]*$/;

/** Lower-case, strip everything that is not a letter, mark, number or space (keeps Indic combining marks), collapse spaces. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export const words = (text: string): string[] => normalise(text).split(' ').filter(Boolean);
export const isQuestion = (sentence: string): boolean => QUESTION_END.test(sentence.trim());
const lastSentence = (reply: string): string => { const s = splitSentences(reply.trim()); return s[s.length - 1] ?? ''; };
export const endsWithQuestion = (reply: string): boolean => isQuestion(lastSentence(reply));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- metrics ----------

export function openingKey(reply: string, n: number = THRESHOLDS.openingWords): string {
  return words(reply).slice(0, n).join(' ');
}

/** Share of replies (from the 2nd on) opening with the same first words as any of the previous `window` replies. */
export function openingRepeatRate(replies: string[], n: number = THRESHOLDS.openingWords, window: number = THRESHOLDS.openingWindow): number {
  if (replies.length < 2) return 0;
  const keys = replies.map((r) => openingKey(r, n));
  let rep = 0;
  for (let i = 1; i < keys.length; i++) {
    if (!keys[i]) continue;
    if (keys.slice(Math.max(0, i - window), i).includes(keys[i]!)) rep++;
  }
  return rep / (keys.length - 1);
}

export function questionEndingRate(replies: string[]): number {
  return replies.length ? replies.filter(endsWithQuestion).length / replies.length : 0;
}

export function maxQuestionStreak(replies: string[]): number {
  let best = 0, cur = 0;
  for (const r of replies) { cur = endsWithQuestion(r) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

export function lengthRatios(replies: string[], userMessages: string[]): { chars: number[]; sentences: number[] } {
  const chars: number[] = [], sentences: number[] = [];
  for (let i = 0; i < Math.min(replies.length, userMessages.length); i++) {
    const u = userMessages[i]!.trim(), r = replies[i]!.trim();
    chars.push(r.length / Math.max(u.length, THRESHOLDS.userCharFloor));
    sentences.push(splitSentences(r).length / Math.max(1, splitSentences(u).length));
  }
  return { chars, sentences };
}

/** Counts robotic phrase occurrences. `extra` adds custom phrases (any language); phrases are normalised the same way as replies. */
export function stockPhraseHits(replies: string[], extra: string[] = []): { hits: number; repliesWithHit: number } {
  const always = [...Object.values(STOCK_PHRASES).flat(), ...extra].map(normalise).filter(Boolean);
  const repeat = REPEAT_ONLY_PHRASES.map(normalise).filter(Boolean);
  const seenRepeat = new Map<string, number>();
  let hits = 0, repliesWithHit = 0;
  for (const reply of replies) {
    const t = normalise(reply);
    let h = 0;
    for (const p of always) if (t.includes(p)) h++;
    for (const p of repeat) {
      if (!t.includes(p)) continue;
      const n = (seenRepeat.get(p) ?? 0) + 1;
      seenRepeat.set(p, n);
      if (n >= 2) h++;
    }
    hits += h;
    if (h) repliesWithHit++;
  }
  return { hits, repliesWithHit };
}

export function sentenceLengths(replies: string[]): number[] {
  return replies.flatMap((r) => splitSentences(r)).map((s) => words(s).length).filter((n) => n > 0);
}
export function sentenceLengthStats(replies: string[]): { variance: number; cv: number } {
  const ls = sentenceLengths(replies);
  if (ls.length < 2) return { variance: 0, cv: 0 };
  const m = mean(ls), v = mean(ls.map((x) => (x - m) ** 2));
  return { variance: v, cv: m ? Math.sqrt(v) / m : 0 };
}

// ---------- combine ----------

export function summarize(replies: string[], userMessages: string[] = [], opts: { extraStockPhrases?: string[] } = {}): HumannessSummary {
  const T = THRESHOLDS;
  const n = replies.length;
  const { chars, sentences } = lengthRatios(replies, userMessages);
  const stock = stockPhraseHits(replies, opts.extraStockPhrases);
  const sv = sentenceLengthStats(replies);
  const metrics: HumannessMetrics = {
    replyCount: n,
    openingRepeatRate: round(openingRepeatRate(replies)),
    questionEndingRate: round(questionEndingRate(replies)),
    maxQuestionStreak: maxQuestionStreak(replies),
    medianLengthRatio: round(median(chars)),
    medianSentenceRatio: round(median(sentences)),
    stockPhraseHits: stock.hits,
    stockPhraseRate: round(n ? stock.repliesWithHit / n : 0),
    sentenceLengthVariance: round(sv.variance, 2),
    sentenceLengthCv: round(sv.cv),
  };
  const lr = metrics.medianLengthRatio, hasLen = chars.length > 0;
  const components = {
    opening: clamp01(1 - (metrics.openingRepeatRate - T.openingRepeatMax) / (T.openingRepeatZero - T.openingRepeatMax)),
    questionEnding: clamp01(1 - (metrics.questionEndingRate - T.questionEndingMax) / (T.questionEndingZero - T.questionEndingMax)),
    streak: metrics.maxQuestionStreak <= T.questionStreakMax ? 1 : metrics.maxQuestionStreak === T.questionStreakMax + 1 ? 0.5 : 0,
    length: !hasLen ? 1 : lr > T.lengthRatioMax ? clamp01(1 - (lr - T.lengthRatioMax) / T.lengthRatioMax) : lr < T.lengthRatioMin ? clamp01(lr / T.lengthRatioMin) : 1,
    stock: clamp01(1 - (metrics.stockPhraseRate - T.stockRateMax) / (T.stockRateZero - T.stockRateMax)),
    variance: sv.cv >= T.sentenceCvMin || n < 2 ? 1 : clamp01(sv.cv / T.sentenceCvMin),
  };
  const humannessScore = Math.round(
    components.opening * WEIGHTS.opening + components.questionEnding * WEIGHTS.questionEnding + components.streak * WEIGHTS.streak
    + components.length * WEIGHTS.length + components.stock * WEIGHTS.stock + components.variance * WEIGHTS.variance,
  );
  const failingChecks: CheckName[] = [];
  if (n >= 2 && metrics.openingRepeatRate >= T.openingRepeatMax) failingChecks.push('openingRepeat');
  if (metrics.questionEndingRate > T.questionEndingMax) failingChecks.push('questionEnding');
  if (metrics.maxQuestionStreak > T.questionStreakMax) failingChecks.push('questionStreak');
  if (hasLen && (lr > T.lengthRatioMax || lr < T.lengthRatioMin)) failingChecks.push('lengthRatio');
  if (metrics.stockPhraseRate > T.stockRateMax) failingChecks.push('stockPhrases');
  if (n >= 4 && sv.cv < T.sentenceCvMin) failingChecks.push('sentenceVariety');
  return { metrics, components, humannessScore, failingChecks, pass: failingChecks.length === 0 && humannessScore >= PASS_SCORE };
}
