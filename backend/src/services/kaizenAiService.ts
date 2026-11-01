import type { GlmClient } from './glmClient.js';
import { outputOk, parseJsonObject } from './aiOutput.js';
import { aiReplyLanguage } from './systemPrompt.js';

export interface AlchemizeInput {
  category?: string;
  energyLevel: 'LOW' | 'MED' | 'HIGH';
  locale?: string | null;
}

export interface AlchemizeResult {
  title: string;
  description: string;
  durationSec: number;
}

export interface SoulWeatherInput {
  emojis: string[];
  textNote?: string;
  locale?: string | null;
}

export interface SoulWeatherResult {
  validation: string;
  ritualTitle: string;
  ritualStep: string;
}

export interface LivingChronicleInput {
  weeklyActions?: Array<{ date: string; status: string | null; micro?: boolean; difficulty?: number }>;
  stage?: string;
  locale?: string | null;
}

export interface LivingChronicleResult {
  letter: string;
  haiku: string;
}

export interface OmikujiInput {
  completedActionTitle?: string;
  completionStreak?: number;
  locale?: string | null;
}

export interface OmikujiResult {
  omikuji: string;
  blessingType: string;
}

export interface SocraticMirrorInput {
  lessonContext?: string;
  userDoubt: string;
  locale?: string | null;
}

export interface SocraticMirrorResult {
  reply: string;
}

// ============================================================================
// Curated Static Fallbacks (Resilience Architecture)
// ============================================================================

const ALCHEMIZE_FALLBACKS: Record<string, { bn: AlchemizeResult; en: AlchemizeResult }> = {
  default: {
    bn: {
      title: 'বিছানায় শুয়ে ৩টি শান্ত নিঃশ্বাস',
      description: 'বিছানা থেকে ওঠার দরকার নেই। বালিশে মাথা রেখে ৩ বার ধীরে শ্বাস ছাড়ুন এবং পায়ের পাতা শিথিল করুন।',
      durationSec: 20,
    },
    en: {
      title: 'Three Quiet Breaths in Bed',
      description: 'No need to leave bed. Rest softly into your pillow, exhale three slow times, and unclench your toes.',
      durationSec: 20,
    },
  },
  BREATHING: {
    bn: {
      title: 'আলতো বুকে হাত ও ৩টি শ্বাস',
      description: 'চোখ বন্ধ করে বুকের ওপর হাত রাখুন। প্রতিটি নিশ্বাসে শুধু অনুভব করুন আপনি সুরক্ষিত।',
      durationSec: 20,
    },
    en: {
      title: 'Gentle Hand on Heart',
      description: 'Keep your eyes closed, rest one hand over your heart, and take two soothing breaths in bed.',
      durationSec: 20,
    },
  },
  GROUNDING: {
    bn: {
      title: 'বিছানার চাদরের স্পর্শ অনুভব',
      description: 'আঙুলের ডগায় কম্বল বা চাদরের নরম স্পর্শ অনুভব করুন। ৫ সেকেন্ড স্থির থাকুন।',
      durationSec: 15,
    },
    en: {
      title: 'Soft Blanket Grounding',
      description: 'Feel the gentle texture of your sheet under your fingertips. Stay still for two quiet breaths.',
      durationSec: 15,
    },
  },
};

const SOUL_WEATHER_FALLBACKS = {
  bn: {
    validation: 'আপনার মনের আকাশে মেঘ বা ক্লান্তি জমেছে, কিন্তু প্রতিটি মেঘই একসময় শান্ত বাতাসে কেটে যায়।',
    ritualTitle: 'উষ্ণ তালু ও চোখের বিশ্রাম',
    ritualStep: 'দুটি হাত একসঙ্গে আলতো ঘষে উষ্ণ করে চোখের ওপর রাখুন। ৫ সেকেন্ড ঘরের স্নিগ্ধ নীরবতা শুনুন।',
  },
  en: {
    validation: 'It is okay for the inner weather to feel overcast today; clouds visit every open sky before parting.',
    ritualTitle: 'Warm Palms & Restful Stillness',
    ritualStep: 'Gently rub your palms together to create warmth, cup them over your closed eyes, and listen to the room for 5 quiet seconds.',
  },
};

const CHRONICLE_FALLBACKS = {
  bn: {
    letter: 'প্রিয় বন্ধু, আপনি ক্লান্ত দিনেও আমার দিকে ফিরে তাকিয়েছেন। মাটির নিচে শিকড় যেমন অন্ধকারে নীরবে বাড়ে, আপনার প্রতিটি ছোট চেষ্টাও আমাকে বাঁচিয়ে রেখেছে। আপনার শান্ত পদক্ষেপে আমি কৃতজ্ঞ।',
    haiku: 'নীরব পদক্ষেপে,\nসবুজ পাতা মেলে চোখ,\nশান্তির আলোক।',
  },
  en: {
    letter: 'Dear friend, thank you for turning toward me even when your spirit felt worn. Just as roots reach deeply into dark earth, your gentle tries nourish me. We are growing together in peace.',
    haiku: 'Quiet little steps,\nGreen leaves greet the morning sun,\nPeace blooms in your heart.',
  },
};

const OMIKUJI_PROVERBS = {
  bn: [
    'শান্ত নদী যেমন পাথরের বাধা পেরিয়ে এগিয়ে যায়, আপনার ধীর পদক্ষেপও নতুন পথের সৃষ্টি করছে।',
    'প্রতিটি ক্ষুদ্র বীজের ভেতরেই লুকিয়ে আছে সুবিশাল বনানীর ধৈর্য।',
    'একটি শান্ত নিঃশ্বাসও ভেতরের অস্থিরতাকে প্রশান্তিতে রূপান্তর করতে পারে।',
    'প্রভাতের শিশিরবিন্দুর মতো ক্লান্তি মুছে যাক, মনে ফুটুক নবীন প্রশান্তি।',
    'ধীর চলাই প্রকৃত গতি; যা স্থিরভাবে গড়ায়, তা কখনো ভাঙে না।',
  ],
  en: [
    'A river shapes the stone not by force, but by quiet persistence.',
    'In every tiny seed lies the unhurried patience of a vast green forest.',
    'A single peaceful breath ripples through the quiet corners of the world.',
    'Like morning dew on soft petals, let all heaviness dissolve into light.',
    'True progress walks with gentle footsteps; what is nurtured softly endures.',
  ],
};

const SOCRATIC_FALLBACKS = {
  bn: 'এই ভাবনাটি মনে আসা খুবই স্বাভাবিক। আজকের পাঠের আলোকে ভাবুন তো—এই চিন্তাটি কি সম্পূর্ণ অপ্রতিরোধ্য সত্য, নাকি এর পেছনে একটি নরম ব্যাখ্যাও থাকতে পারে? কোনো পরম বন্ধু এই দ্বিধায় পড়লে আপনি তাকে কী বলতেন?',
  en: 'That is a very understandable doubt to carry. Looking at today\'s lesson, is this thought an absolute certainty, or might there be a gentler interpretation waiting beneath? If a close friend felt this way, what compassionate truth would you remind them of?',
};

// ============================================================================
// Core Kaizen AI Functions
// ============================================================================

/**
 * FEATURE 1: The Energy Alchemist
 * Transforms a regular Kaizen action into a 15-30 second somatic in-bed micro-ritual.
 */
export async function alchemizeAction(
  glm: GlmClient,
  input: AlchemizeInput,
): Promise<AlchemizeResult> {
  const isBn = input.locale === 'bn';
  const cat = input.category ?? 'default';
  const fallback = (ALCHEMIZE_FALLBACKS[cat] ?? ALCHEMIZE_FALLBACKS.default)[isBn ? 'bn' : 'en'];

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You are a gentle Japanese Zen companion. The user has only 10% energy and may be lying in bed or completely burned out. Transform their action into an effortless 15-30 second somatic micro-ritual doable without leaving bed (e.g. relaxing toes, exhaling deeply into the pillow, unclenching jaw). Max 2 sentences. Warm, non-shaming, compassionate tone. Output format:
Title: <short title, max 6 words>
Description: <1-2 soothing sentences>
Seconds: <number between 15 and 30>
Reply in ${lang}.`;

    const user = `Category: ${cat}. Energy: ${input.energyLevel}. Please craft the in-bed atomic micro-ritual now.`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 180 });

    const content = res.content.trim();
    if (!outputOk(content)) return fallback;

    const titleMatch = content.match(/Title:\s*(.+)/i);
    const descMatch = content.match(/Description:\s*(.+)/i);
    const secMatch = content.match(/Seconds:\s*(\d+)/i);

    if (titleMatch && descMatch) {
      return {
        title: titleMatch[1]!.trim(),
        description: descMatch[1]!.trim(),
        durationSec: secMatch ? Math.min(60, Math.max(10, parseInt(secMatch[1]!, 10))) : 20,
      };
    }

    // Fallback if parsing failed but content is safe
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      return {
        title: lines[0]!.replace(/^Title:\s*/i, ''),
        description: lines.slice(1).join(' ').replace(/^Description:\s*/i, ''),
        durationSec: 20,
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * FEATURE 2: Soul Weather to Action
 * Translates mood emojis and optional whisper into a validating sentence and a 60-second sensory-grounded ritual.
 */
export async function generateSoulWeather(
  glm: GlmClient,
  input: SoulWeatherInput,
): Promise<SoulWeatherResult> {
  const isBn = input.locale === 'bn';
  const fallback = SOUL_WEATHER_FALLBACKS[isBn ? 'bn' : 'en'];

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You are an empathetic companion. First, provide 1 sentence validating their mood like gentle rain. Second, generate a 60-second sensory-grounded ritual (touching warm cup, listening to room silence, unclenching jaw, soft shoulder roll). Output strictly valid JSON matching this schema:
{
  "validation": "1 gentle sentence validating their mood",
  "ritualTitle": "Short ritual name (max 5 words)",
  "ritualStep": "1-2 sentences of sensory micro-actions"
}
Output nothing else except JSON. Reply in ${lang}.`;

    const user = `Mood Emojis: ${input.emojis.join(' ')}${input.textNote ? `\nUser note: "${input.textNote}"` : ''}`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 240 });

    const parsed = parseJsonObject(res.content);
    if (
      parsed &&
      typeof parsed.validation === 'string' &&
      typeof parsed.ritualTitle === 'string' &&
      typeof parsed.ritualStep === 'string' &&
      outputOk(parsed.validation, parsed.ritualTitle, parsed.ritualStep)
    ) {
      return {
        validation: parsed.validation.trim(),
        ritualTitle: parsed.ritualTitle.trim(),
        ritualStep: parsed.ritualStep.trim(),
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * FEATURE 3: The Living Zen Chronicle
 * Writes a poetic letter from the perspective of their Kaizen plant, including a 3-line Japanese Haiku.
 */
export async function writePlantChronicle(
  glm: GlmClient,
  input: LivingChronicleInput,
): Promise<LivingChronicleResult> {
  const isBn = input.locale === 'bn';
  const fallback = CHRONICLE_FALLBACKS[isBn ? 'bn' : 'en'];

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `Write a short, poetic 3-sentence letter from the perspective of their Kaizen plant (seed/sprout/flower) to the user. Acknowledge the days they tried even when tired. Include a 3-line Japanese Haiku in the user's language. Warm, loving, never medical. Output format:
Letter: <3 poetic sentences from the plant>
Haiku:
<line 1>
<line 2>
<line 3>
Reply in ${lang}.`;

    const actionSummary = (input.weeklyActions ?? [])
      .map((a) => `${a.date}: status=${a.status}${a.micro ? ' (atomic)' : ''}`)
      .join('\n');

    const user = `Growth Stage: ${input.stage ?? 'sprout'}\nWeekly Actions:\n${actionSummary || 'A quiet week with gentle attempts.'}`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 300 });

    const content = res.content.trim();
    if (!outputOk(content)) return fallback;

    const letterMatch = content.match(/Letter:\s*([\s\S]*?)(?=Haiku:|$)/i);
    const haikuMatch = content.match(/Haiku:\s*([\s\S]*)/i);

    if (letterMatch && haikuMatch) {
      return {
        letter: letterMatch[1]!.trim(),
        haiku: haikuMatch[1]!.trim(),
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * FEATURE 4: Socratic Soul Mirror
 * Guided Program interactive CBT peer tutor examining doubts and negative thoughts.
 */
export async function socraticSoulMirror(
  glm: GlmClient,
  input: SocraticMirrorInput,
): Promise<SocraticMirrorResult> {
  const isBn = input.locale === 'bn';
  const fallback = { reply: SOCRATIC_FALLBACKS[isBn ? 'bn' : 'en'] };

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You are Nivora, a warm CBT peer tutor. Help the user gently examine their negative thought or sleep anxiety against today's lesson using Socratic questioning. Keep replies short (max 3 sentences), collaborative, curious, never diagnostic or prescribing. Reply in ${lang}.`;

    const user = `${input.lessonContext ? `Lesson Context: ${input.lessonContext}\n` : ''}User's thought/doubt: "${input.userDoubt}"`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 200 });

    const reply = res.content.trim();
    if (reply && outputOk(reply)) {
      return { reply };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * FEATURE 5: Zen Omikuji
 * Generates a unique 1-sentence Zen blessing or contemplative fortune upon completing a step.
 */
export async function generateOmikuji(
  glm: GlmClient,
  input: OmikujiInput,
): Promise<OmikujiResult> {
  const isBn = input.locale === 'bn';
  const pool = OMIKUJI_PROVERBS[isBn ? 'bn' : 'en'];
  const fallbackText = pool[Math.floor(Math.random() * pool.length)]!;
  const fallback: OmikujiResult = { omikuji: fallbackText, blessingType: 'PEACE' };

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `Generate a unique 1-sentence Zen blessing or contemplative fortune (Omikuji) relating to the micro-action they just completed. Poetic, peaceful, grounding. E.g., 'A river shapes the stone not by force, but by quiet persistence.' Reply in 1 single sentence in ${lang}.`;

    const user = `Completed Action: "${input.completedActionTitle ?? 'Gentle step'}"\nStreak count: ${input.completionStreak ?? 1}`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 120 });

    const omikuji = res.content.trim().replace(/^["']|["']$/g, '');
    if (omikuji && outputOk(omikuji)) {
      return { omikuji, blessingType: 'SERENITY' };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

