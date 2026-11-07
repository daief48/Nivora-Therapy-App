import type { GlmClient } from './glmClient.js';
import { outputOk, parseJsonObject } from './aiOutput.js';
import { aiReplyLanguage } from './systemPrompt.js';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface DreamDecodeInput {
  durationMin: number;
  awakenings: number;
  rested: number;       // 1–10
  score: number;        // 0–100
  locale?: string | null;
}
export interface DreamDecodeResult {
  metaphor: string;
  archetype: string;
  archetypeEmoji: string;
}

export interface MoonBreathInput {
  moodLevel: number;    // 1–5
  locale?: string | null;
}
export interface MoonBreathResult {
  pattern: 'box' | '4-7-8' | 'coherent';
  cycles: number;
  inhale: number;
  hold: number;
  exhale: number;
  holdOut: number;
  closingAffirmation: string;
}

export interface NightWhisperInput {
  thought: string;
  locale?: string | null;
}
export interface NightWhisperResult {
  validation: string;
  reframe: string;
  release: string;
}

export interface SleepOracleInput {
  entries: Array<{ date: string; score: number; bedtime: string; durationMin: number; awakenings: number }>;
  locale?: string | null;
}
export interface SleepOracleResult {
  insight: string;
  bestDay: string;
  worstDay: string;
  trend: 'improving' | 'declining' | 'stable';
  tonightPrediction: { low: number; high: number };
  actionTip: string;
}

export interface LullabyInput {
  setting: 'ocean' | 'forest' | 'cloud' | 'mountain' | 'moonlit_garden';
  mood: 'calm' | 'tired' | 'anxious' | 'grateful';
  length: 'short' | 'long';
  userName?: string;
  locale?: string | null;
}
export interface LullabyResult {
  title: string;
  body: string;
}

// ── Static Fallbacks ──────────────────────────────────────────────────────────

// DREAM_DECODE_FALLBACKS: keyed by archetype
// Archetypes: River Night (score 65-79), Storm Rider (awakenings >= 3), Blossom Rest (rested >= 8), Dark Moon (score < 50), Starlit Ease (score >= 80)
// Each has { bn, en } with metaphor, archetype, archetypeEmoji
const DREAM_DECODE_FALLBACKS: Record<string, { bn: DreamDecodeResult; en: DreamDecodeResult }> = {
  'Starlit Ease': {
    bn: { metaphor: 'গতকাল রাতের ঘুম ছিল শান্ত নক্ষত্রের মতো — আলো কম, কিন্তু টেকসই ও গভীর।', archetype: 'Starlit Ease', archetypeEmoji: '⭐' },
    en: { metaphor: 'Last night your sleep was like steady starlight — quiet, deep, and lasting.', archetype: 'Starlit Ease', archetypeEmoji: '⭐' },
  },
  'River Night': {
    bn: { metaphor: 'তোমার ঘুম একটি শান্ত নদীর মতো — শুরু হয়তো দেরিতে, কিন্তু শেষটা মসৃণ ও স্নিগ্ধ।', archetype: 'River Night', archetypeEmoji: '🌊' },
    en: { metaphor: 'Your sleep was like a calm river — a late start, but the flow was gentle and smooth.', archetype: 'River Night', archetypeEmoji: '🌊' },
  },
  'Storm Rider': {
    bn: { metaphor: 'গতকাল রাতের ঘুম ছিল ঝড়ের মধ্য দিয়ে যাওয়ার মতো — কিন্তু তুমি পার হয়েছ।', archetype: 'Storm Rider', archetypeEmoji: '⛈️' },
    en: { metaphor: 'Last night felt like riding through a storm — but you made it through.', archetype: 'Storm Rider', archetypeEmoji: '⛈️' },
  },
  'Blossom Rest': {
    bn: { metaphor: 'তোমার ঘুম ছিল ফুলের মতো — নরম, পরিপূর্ণ ও সুবাসিত।', archetype: 'Blossom Rest', archetypeEmoji: '🌸' },
    en: { metaphor: 'Your sleep was like a blossom — soft, full, and quietly fragrant.', archetype: 'Blossom Rest', archetypeEmoji: '🌸' },
  },
  'Dark Moon': {
    bn: { metaphor: 'গতকাল রাত ছিল অন্ধকার চাঁদের মতো — সংক্ষিপ্ত, কিন্তু আজ নতুন আলো আসবে।', archetype: 'Dark Moon', archetypeEmoji: '🌑' },
    en: { metaphor: 'Last night was like a dark moon — brief, but a new light is already coming.', archetype: 'Dark Moon', archetypeEmoji: '🌑' },
  },
};

const MOON_BREATH_FALLBACKS: Record<string, { bn: MoonBreathResult; en: MoonBreathResult }> = {
  box: {
    bn: { pattern: 'box', cycles: 4, inhale: 4, hold: 4, exhale: 4, holdOut: 4, closingAffirmation: 'আপনি নিরাপদ। শ্বাস আপনার সঙ্গে আছে।' },
    en: { pattern: 'box', cycles: 4, inhale: 4, hold: 4, exhale: 4, holdOut: 4, closingAffirmation: 'You are safe. Your breath is with you.' },
  },
  '4-7-8': {
    bn: { pattern: '4-7-8', cycles: 3, inhale: 4, hold: 7, exhale: 8, holdOut: 0, closingAffirmation: 'রাতের শান্তি আপনাকে স্বাগত জানাচ্ছে।' },
    en: { pattern: '4-7-8', cycles: 3, inhale: 4, hold: 7, exhale: 8, holdOut: 0, closingAffirmation: 'The quiet of the night welcomes you.' },
  },
  coherent: {
    bn: { pattern: 'coherent', cycles: 5, inhale: 5, hold: 0, exhale: 5, holdOut: 0, closingAffirmation: 'আপনার হৃদয় এখন ছন্দময়। বিশ্রাম নিন।' },
    en: { pattern: 'coherent', cycles: 5, inhale: 5, hold: 0, exhale: 5, holdOut: 0, closingAffirmation: 'Your heart is in rhythm now. Rest.' },
  },
};

const NIGHT_WHISPER_FALLBACKS: { bn: NightWhisperResult; en: NightWhisperResult } = {
  bn: { validation: 'এই চিন্তাটি স্বাভাবিক — মন মাঝে মাঝে ঘুমের আগে বেশি সক্রিয় হয়।', reframe: 'এই মুহূর্তে এই ভাবনার কোনো সমাধান নেই, এবং সেটা ঠিকই আছে।', release: 'কল্পনা করুন এই চিন্তাটি একটি মেঘের মতো রাতের আকাশে ভেসে চলে গেল।' },
  en: { validation: 'This thought is natural — the mind often becomes more active just before sleep.', reframe: 'There is no solution needed for this right now, and that is perfectly okay.', release: 'Imagine this thought floating away like a cloud drifting across the night sky.' },
};

const SLEEP_ORACLE_FALLBACKS: { bn: SleepOracleResult; en: SleepOracleResult } = {
  bn: { insight: 'আপনার ঘুমের প্যাটার্ন বিশ্লেষণ করা হচ্ছে। নিয়মিত লগ করলে আরও সঠিক পূর্বাভাস পাবেন।', bestDay: 'বুধবার', worstDay: 'রবিবার', trend: 'stable' as const, tonightPrediction: { low: 60, high: 75 }, actionTip: 'আজ রাতে ১৫ মিনিট আগে wind-down রুটিন শুরু করুন।' },
  en: { insight: 'Your sleep patterns are being analyzed. Regular logging unlocks more accurate forecasts.', bestDay: 'Wednesday', worstDay: 'Sunday', trend: 'stable' as const, tonightPrediction: { low: 60, high: 75 }, actionTip: 'Start your wind-down routine 15 minutes earlier tonight.' },
};

const LULLABY_FALLBACKS: Record<string, { bn: LullabyResult; en: LullabyResult }> = {
  ocean: {
    bn: { title: 'সমুদ্রের ডাক', body: 'তুমি বালির ধারে শুয়ে আছ। ঢেউয়ের শব্দ দূর থেকে ভেসে আসছে, নরম তালে। বাতাসে নোনা গন্ধ। তোমার পা দুটো ভারী, আরামদায়কভাবে বালিতে গেঁথে। প্রতিটি ঢেউ একটি ভাবনা নিয়ে যায়, ফিরিয়ে দেয় শুধু শান্তি। তুমি নিরাপদ। তুমি বিশ্রামে।' },
    en: { title: 'The Ocean\'s Call', body: 'You are lying by the shore. Waves arrive softly in the distance, in a slow and gentle rhythm. The air carries a cool salt breeze. Your legs are heavy and warm, resting in the sand. Each wave carries one small thought away, returning only stillness. You are safe. You are at rest.' },
  },
  forest: {
    bn: { title: 'বনের নিঃশ্বাস', body: 'গাছের পাতায় রাতের বাতাস ফিসফিস করছে। মাটির গন্ধ ঠান্ডা ও মিষ্টি। তুমি শুয়ে আছ নরম ঘাসের ওপর, গাছের ছায়ায়। ঝিঁঝিঁর ডাক দূর থেকে আসে, একটানা সুরে। তোমার শ্বাস গাছের শ্বাসের সাথে মিশে যায়। ঘুমের দিকে যাও।' },
    en: { title: 'The Forest\'s Breath', body: 'Night wind whispers through the leaves above you. The earth smells cool and sweet. You lie on soft grass, sheltered in the shade of old trees. Crickets sing a steady, distant song. Your breath joins the breathing of the forest. Drift into sleep.' },
  },
  moonlit_garden: {
    bn: { title: 'চাঁদের বাগান', body: 'চাঁদের আলোয় বাগানটি রুপার মতো চকচক করছে। ফুলের সুবাস ভেসে আসছে আলতো বাতাসে। তুমি একটি নরম আসনে বসে আছ, হাত দুটো শিথিল। চাঁদ তোমার দিকে তাকিয়ে আছে শান্তভাবে। তুমিও চোখ বুজলে, পুরো বাগানটা তোমার স্বপ্নে চলে আসে।' },
    en: { title: 'The Moonlit Garden', body: 'The garden shimmers silver in the moonlight. A faint floral scent drifts on the cool air. You sit on a soft bench, hands loose and warm. The moon watches you quietly. As you close your eyes, the garden blooms gently inside your dream.' },
  },
  cloud: {
    bn: { title: 'মেঘের উপরে', body: 'তুমি মেঘের উপরে ভাসছ, তুলোর মতো নরম। নিচে পৃথিবী ছোট, শান্ত। তোমার হাত-পা ভারহীন। আকাশ হালকা নীল। প্রতিটি শ্বাসে তুমি আরও হালকা হও। ভাবনারা দূরে সরে যায়। শুধু নীলাকাশ ও তুমি।' },
    en: { title: 'Above the Clouds', body: 'You are floating on a cloud, soft as cotton. The world below is small and quiet. Your arms and legs are weightless. The sky is a pale blue. With every breath you grow lighter. Thoughts drift away. Only sky and stillness remain.' },
  },
  mountain: {
    bn: { title: 'পাহাড়ের নিস্তব্ধতা', body: 'পাহাড়ের চূড়ায় রাতের বাতাস শীতল ও পরিষ্কার। তারাগুলো কাছে মনে হয়, হাত বাড়ালেই ছোঁয়া যায়। তোমার পিঠ পাথরে হেলান দেওয়া, দৃঢ় ও স্থির। নিচে উপত্যকা ঘুমিয়ে আছে। তুমিও ঘুমাও।' },
    en: { title: 'Mountain Stillness', body: 'At the mountaintop the night air is cool and clean. The stars seem close enough to touch. Your back rests against solid stone, steady and still. The valley below is already asleep. Let yourself sleep too.' },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve 'bn' or 'en' from any locale string. */
function lang(locale?: string | null): 'bn' | 'en' {
  return locale === 'bn' ? 'bn' : 'en';
}

/** Determine archetype from sleep data. */
function dreamArchetype(input: Pick<DreamDecodeInput, 'score' | 'awakenings' | 'rested'>): string {
  if (input.score >= 80) return 'Starlit Ease';
  if (input.awakenings >= 3) return 'Storm Rider';
  if (input.rested >= 8) return 'Blossom Rest';
  if (input.score < 50) return 'Dark Moon';
  return 'River Night';
}

/** Day-of-week name from an ISO date string (YYYY-MM-DD). */
function dayName(date: string, locale?: string | null): string {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    return d.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', { weekday: 'long', timeZone: 'UTC' });
  } catch {
    return date;
  }
}

// ── AI Functions ──────────────────────────────────────────────────────────────

/**
 * decodeDream: Poetic metaphorical interpretation of last night's sleep data.
 * Assigns one of 5 archetypes and returns a 2-sentence metaphor. Falls back
 * to curated static copy on any AI error.
 */
export async function decodeDream(glm: GlmClient, input: DreamDecodeInput): Promise<DreamDecodeResult> {
  const archetype = dreamArchetype(input);
  const l = lang(input.locale);
  const replyLang = aiReplyLanguage(input.locale);
  const signal = AbortSignal.timeout(45_000);
  try {
    const out = await glm.chat([
      {
        role: 'system',
        content: `You are Luna, a poetic sleep companion. Generate a 2-sentence metaphorical interpretation of this sleep data as if reading the user's dream weather. Then assign one archetype: Starlit Ease (score>=80), Storm Rider (awakenings>=3), Blossom Rest (rested>=8), Dark Moon (score<50), River Night (otherwise). Output JSON: { metaphor: string, archetype: string, archetypeEmoji: string }. Never use clinical language. Warm, gentle. Reply in ${replyLang}.`,
      },
      {
        role: 'user',
        content: `Sleep duration: ${input.durationMin} min, awakenings: ${input.awakenings}, rested feeling: ${input.rested}/10, score: ${input.score}/100.`,
      },
    ], { signal, maxTokens: 300 });
    const parsed = parseJsonObject(out.content);
    if (
      parsed &&
      typeof parsed.metaphor === 'string' && parsed.metaphor.trim() &&
      typeof parsed.archetype === 'string' && parsed.archetype.trim() &&
      typeof parsed.archetypeEmoji === 'string' && parsed.archetypeEmoji.trim() &&
      outputOk(parsed.metaphor)
    ) {
      return { metaphor: parsed.metaphor.trim(), archetype: parsed.archetype.trim(), archetypeEmoji: parsed.archetypeEmoji.trim() };
    }
    return DREAM_DECODE_FALLBACKS[archetype]?.[l] ?? DREAM_DECODE_FALLBACKS['River Night'][l];
  } catch {
    return DREAM_DECODE_FALLBACKS[archetype]?.[l] ?? DREAM_DECODE_FALLBACKS['River Night'][l];
  }
}

/**
 * guideMoonBreath: Select adaptive breathing pattern based on mood level and
 * generate a personalised closing affirmation. Falls back to full static entry.
 */
export async function guideMoonBreath(glm: GlmClient, input: MoonBreathInput): Promise<MoonBreathResult> {
  const pattern: MoonBreathResult['pattern'] =
    input.moodLevel <= 2 ? 'box' : input.moodLevel === 3 ? '4-7-8' : 'coherent';
  const l = lang(input.locale);
  const base = MOON_BREATH_FALLBACKS[pattern][l];
  const replyLang = aiReplyLanguage(input.locale);
  const signal = AbortSignal.timeout(45_000);
  try {
    const out = await glm.chat([
      {
        role: 'system',
        content: `You are Luna, a gentle breathing coach. The user has a mood level of ${input.moodLevel}/5 before sleep. Return a closing 1-sentence affirmation for the end of their ${pattern} breathing practice. Output JSON: { closingAffirmation: string }. Peaceful, grounding. Reply in ${replyLang}.`,
      },
      {
        role: 'user',
        content: `Mood level: ${input.moodLevel}/5. Breathing pattern: ${pattern}.`,
      },
    ], { signal, maxTokens: 150 });
    const parsed = parseJsonObject(out.content);
    if (parsed && typeof parsed.closingAffirmation === 'string' && parsed.closingAffirmation.trim() && outputOk(parsed.closingAffirmation)) {
      return { ...base, closingAffirmation: parsed.closingAffirmation.trim() };
    }
    return base;
  } catch {
    return base;
  }
}

/**
 * decodeNightWhisper: CBT-style cognitive offloading before sleep.
 * Validates the feeling, reframes, and offers a letting-go invitation.
 * Falls back to static copy on any AI error.
 */
export async function decodeNightWhisper(glm: GlmClient, input: NightWhisperInput): Promise<NightWhisperResult> {
  const l = lang(input.locale);
  const replyLang = aiReplyLanguage(input.locale);
  const signal = AbortSignal.timeout(45_000);
  try {
    const out = await glm.chat([
      {
        role: 'system',
        content: `You are Luna, a gentle bedtime CBT companion. The user has a racing thought just before sleep. 1) Validate their feeling (1 warm sentence). 2) Offer a gentle cognitive reframe (1 sentence, not toxic positivity). 3) A short letting-go invitation with peaceful imagery (1 sentence). Output JSON: { validation: string, reframe: string, release: string }. Never diagnose. Max 3 sentences total. In "validation" name the feeling in the user's own words; word "reframe" as a gentle check (a tentative reading ending in a short question such as "does that fit?"), never as a verdict; "release" is an invitation they may take or leave. Reply in ${replyLang}.`,
      },
      {
        role: 'user',
        content: input.thought,
      },
    ], { signal, maxTokens: 300 });
    const parsed = parseJsonObject(out.content);
    if (
      parsed &&
      typeof parsed.validation === 'string' && parsed.validation.trim() &&
      typeof parsed.reframe === 'string' && parsed.reframe.trim() &&
      typeof parsed.release === 'string' && parsed.release.trim() &&
      outputOk(parsed.validation, parsed.reframe, parsed.release)
    ) {
      return {
        validation: parsed.validation.trim(),
        reframe: parsed.reframe.trim(),
        release: parsed.release.trim(),
      };
    }
    return NIGHT_WHISPER_FALLBACKS[l];
  } catch {
    return NIGHT_WHISPER_FALLBACKS[l];
  }
}

/**
 * readSleepOracle: 7-night (up to 14) pattern analysis with tonight's prediction.
 * Computes best/worst day and trend from entries; merges with AI insight & action tip.
 */
export async function readSleepOracle(glm: GlmClient, input: SleepOracleInput): Promise<SleepOracleResult> {
  const l = lang(input.locale);
  const { entries } = input;

  // Compute best/worst day
  const byDay = new Map<string, number[]>();
  for (const e of entries) {
    const name = dayName(e.date, input.locale);
    const arr = byDay.get(name) ?? [];
    arr.push(e.score);
    byDay.set(name, arr);
  }
  const dayAvgs = [...byDay.entries()].map(([d, scores]) => ({ d, avg: scores.reduce((a, b) => a + b, 0) / scores.length }));
  dayAvgs.sort((a, b) => b.avg - a.avg);
  const bestDay = dayAvgs[0]?.d ?? SLEEP_ORACLE_FALLBACKS[l].bestDay;
  const worstDay = dayAvgs[dayAvgs.length - 1]?.d ?? SLEEP_ORACLE_FALLBACKS[l].worstDay;

  // Compute trend (last 3 avg vs first 3 avg)
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const first3 = sorted.slice(0, 3).map((e) => e.score);
  const last3 = sorted.slice(-3).map((e) => e.score);
  const avg3 = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  let trend: SleepOracleResult['trend'] = 'stable';
  if (first3.length >= 2 && last3.length >= 2) {
    const diff = avg3(last3) - avg3(first3);
    if (diff >= 5) trend = 'improving';
    else if (diff <= -5) trend = 'declining';
  }

  // Compute tonight prediction
  const avgScore = entries.reduce((s, e) => s + e.score, 0) / entries.length;
  const tonightPrediction = {
    low: Math.max(0, Math.round(avgScore - 10)),
    high: Math.min(100, Math.round(avgScore + 10)),
  };

  const replyLang = aiReplyLanguage(input.locale);
  const signal = AbortSignal.timeout(45_000);
  const entrySummary = entries.map((e) => `${e.date}: score=${e.score}, bedtime=${e.bedtime}, duration=${e.durationMin}min, awakenings=${e.awakenings}`).join('; ');

  try {
    const out = await glm.chat([
      {
        role: 'system',
        content: `You are Luna, a wise sleep analyst. Analyze these ${entries.length} nights of sleep data and give ONE actionable insight in 2-3 sentences. Be specific, warm, practical. Output JSON: { insight: string, actionTip: string }. Never diagnose. Reply in ${replyLang}.`,
      },
      {
        role: 'user',
        content: entrySummary,
      },
    ], { signal, maxTokens: 350 });
    const parsed = parseJsonObject(out.content);
    if (
      parsed &&
      typeof parsed.insight === 'string' && parsed.insight.trim() &&
      typeof parsed.actionTip === 'string' && parsed.actionTip.trim() &&
      outputOk(parsed.insight, parsed.actionTip)
    ) {
      return { insight: parsed.insight.trim(), actionTip: parsed.actionTip.trim(), bestDay, worstDay, trend, tonightPrediction };
    }
    return { ...SLEEP_ORACLE_FALLBACKS[l], bestDay, worstDay, trend, tonightPrediction };
  } catch {
    return { ...SLEEP_ORACLE_FALLBACKS[l], bestDay, worstDay, trend, tonightPrediction };
  }
}

/**
 * composeLullaby: AI-generated personalised sleep story set in a chosen scene.
 * Returns { title, body }. Falls back to curated static lullaby on any AI error.
 */
export async function composeLullaby(glm: GlmClient, input: LullabyInput): Promise<LullabyResult> {
  const l = lang(input.locale);
  const name = input.userName?.trim() || 'you';
  const wordCount = input.length === 'long' ? 180 : 120;
  const replyLang = aiReplyLanguage(input.locale);
  const signal = AbortSignal.timeout(45_000);
  try {
    const out = await glm.chat([
      {
        role: 'system',
        content: `Write a ${wordCount}-word sleep story for ${name} set in a ${input.setting.replace('_', ' ')}. Tone: gentle, slow-paced, second-person ('you'). The protagonist's name is ${name !== 'you' ? name : 'the listener'}. End with a natural drift into sleep. Include 2-3 sensory details (smell, texture, temperature). Never include anything that increases anxiety. Reply in ${replyLang}.`,
      },
      {
        role: 'user',
        content: `Setting: ${input.setting.replace('_', ' ')}. Mood: ${input.mood}. Story length: ${input.length}.`,
      },
    ], { signal, maxTokens: 500 });
    const raw = out.content.trim();
    if (!raw || !outputOk(raw)) {
      return LULLABY_FALLBACKS[input.setting]?.[l] ?? LULLABY_FALLBACKS['ocean'][l];
    }
    // Extract title from first line if the model provides one (e.g. "## Title" or "Title\n\n...").
    const lines = raw.split('\n').map((ln) => ln.trim()).filter(Boolean);
    let title: string;
    let body: string;
    // Treat as titled if the first line is short (≤60 chars) and the rest is longer body text.
    if (lines.length >= 2 && lines[0].length <= 60 && lines.slice(1).join(' ').length > lines[0].length) {
      title = lines[0].replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
      body = lines.slice(1).join(' ').trim();
    } else {
      // Use setting-based fallback title, body is full output.
      title = (LULLABY_FALLBACKS[input.setting]?.[l] ?? LULLABY_FALLBACKS['ocean'][l]).title;
      body = raw;
    }
    return { title, body };
  } catch {
    return LULLABY_FALLBACKS[input.setting]?.[l] ?? LULLABY_FALLBACKS['ocean'][l];
  }
}
