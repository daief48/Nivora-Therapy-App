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

export interface GoalSetupInput {
  rawGoal: string;
  currentSituation?: string;
  availableTimeMin?: number;
  locale?: string | null;
}

export interface GoalSetupResult {
  refinedTitle: string;
  whyItMatters: string;
  starterActionTitle: string;
  starterActionDescription: string;
  estimatedMinutes: number;
  category: string;
}

export interface PdcaCheckInInput {
  goalTitle: string;
  actionTitle: string;
  status: 'DONE' | 'PARTIAL' | 'SKIPPED';
  difficultyFeedback?: string;
  feltLevel?: number;
  userNote?: string;
  locale?: string | null;
}

export interface PdcaCheckInResult {
  reflection: string;
  nextActionTitle: string;
  nextActionDescription: string;
  adjustment: 'SIMPLIFY' | 'STEADY' | 'GROW';
}

// ============================================================================
// Curated Static Fallbacks (Resilience Architecture)
// ============================================================================

const ALCHEMIZE_FALLBACKS: Record<string, { bn: AlchemizeResult; en: AlchemizeResult }> = {
  default: {
    bn: {
      title: 'Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ¸Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ• Ã“ÂªÃ‚Ã“ÂºÃ¼Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§ Ã“ÂºÂ®Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂ¿Ã“Âªâ”Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ©',
      description: 'Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ¸Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂªÂ¥ Ã“ÂªÃ‘Ã“ÂºÃ§Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÃ´Ã“ÂªÃ¡Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂªÃ“Âªâ–‘Ã“ÂªÃ²Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂ¿Ã“ÂºÃ§Ã“ÂªÃ§Ã“Ã‘Ã± Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“Âªâ–“Ã“Âªâ”Ã“ÂªÃ‚Ã“ÂºÃ§ Ã“ÂªÂ«Ã“ÂªÂ¥Ã“ÂªÃ‘Ã“ÂªÂ¥ Ã“Âªâ–‘Ã“ÂºÃ§Ã“ÂªÃ»Ã“ÂºÃ§ Ã“ÂºÂ® Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂºÃ“ÂºÃ‡Ã“Âªâ–‘Ã“ÂºÃ§ Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ© Ã“ÂªÃ¸Ã“ÂªÂ¥Ã“ÂªÃ­Ã“Âªâ•Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÃ…Ã“ÂªÂ¼Ã“ÂªÃ© Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ±Ã“ÂªÂ¥ Ã“ÂªÃ‚Ã“Âªâ”Ã“ÂªÃ‘Ã“Âªâ”Ã“Âªâ–“ Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã±',
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
      title: 'Ã“ÂªÃ¥Ã“Âªâ–“Ã“ÂªÃ±Ã“ÂºÃ¯ Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÃ²Ã“ÂºÃ§ Ã“Âªâ•£Ã“ÂªÂ¥Ã“ÂªÃ± Ã“ÂªÃ´ Ã“ÂºÂ®Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ©',
      description: 'Ã“ÂªÃœÃ“ÂºÃ¯Ã“ÂªÃ» Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂº Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂºÃ§ Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÃ²Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ´Ã“ÂªÂ¬Ã“Âªâ–‘ Ã“Âªâ•£Ã“ÂªÂ¥Ã“ÂªÃ± Ã“Âªâ–‘Ã“ÂªÂ¥Ã“ÂªÃ»Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã± Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ±Ã“Âªâ”Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÂ¿Ã“Âªâ”Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ©Ã“ÂºÃ§ Ã“ÂªÃ‚Ã“ÂºÃ¼Ã“ÂªÂºÃ“ÂºÃ¼ Ã“ÂªÃ Ã“ÂªÂ¿Ã“ÂºÃ¼Ã“ÂªÂ¡Ã“ÂªÂ¼ Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“Âªâ” Ã“ÂªÂ©Ã“ÂºÃ¼Ã“Âªâ–‘Ã“ÂªÃ²Ã“ÂºÃ¬Ã“ÂªÃ€Ã“Âªâ”Ã“ÂªÃ±Ã“Ã‘Ã±',
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
      title: 'Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ¸Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÃœÃ“ÂªÂ¥Ã“ÂªÂªÃ“Âªâ–‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¬Ã“Âªâ–‘Ã“ÂºÃ¬Ã“ÂªÃ‚ Ã“ÂªÃ Ã“ÂªÂ¿Ã“ÂºÃ¼Ã“ÂªÂ¡Ã“ÂªÂ¼',
      description: 'Ã“ÂªÃ¥Ã“ÂªÃ–Ã“ÂºÃ¼Ã“Âªâ–“Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ­Ã“ÂªÃ¹Ã“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ• Ã“ÂªÃ²Ã“ÂªÂ«Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“Âªâ–“ Ã“ÂªÂ¼Ã“ÂªÂ¥ Ã“ÂªÃœÃ“ÂªÂ¥Ã“ÂªÂªÃ“Âªâ–‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¿Ã“Âªâ–‘Ã“ÂªÂ« Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¬Ã“Âªâ–‘Ã“ÂºÃ¬Ã“ÂªÃ‚ Ã“ÂªÃ Ã“ÂªÂ¿Ã“ÂºÃ¼Ã“ÂªÂ¡Ã“ÂªÂ¼ Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã± Ã“ÂºÂ½ Ã“ÂªÂ©Ã“ÂºÃ§Ã“ÂªÃ²Ã“ÂºÃ§Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ­ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÃ‘Ã“Âªâ”Ã“Âªâ–‘ Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã±',
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
    validation: 'Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂ«Ã“ÂªÂ¿Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ¥Ã“ÂªÃ²Ã“ÂªÂ¥Ã“ÂªÃ‚Ã“ÂºÃ§ Ã“ÂªÂ«Ã“ÂºÃ§Ã“ÂªÃ¿ Ã“ÂªÂ¼Ã“ÂªÂ¥ Ã“ÂªÃ²Ã“ÂºÃ¬Ã“Âªâ–“Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ” Ã“ÂªÂ£Ã“ÂªÂ«Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂºÃ§, Ã“ÂªÃ²Ã“Âªâ”Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“ÂºÃ¼ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ±Ã“Âªâ”Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÂ«Ã“ÂºÃ§Ã“ÂªÃ¿Ã“ÂªÃ§ Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÂ©Ã“ÂªÂ«Ã“ÂªÂ»Ã“Âªâ• Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÂ©Ã“ÂºÃ§ Ã“ÂªÃ²Ã“ÂºÃ§Ã“ÂªÆ’Ã“ÂºÃ§ Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ•Ã“Ã‘Ã±',
    ritualTitle: 'Ã“ÂªÃ«Ã“ÂªÃ€Ã“ÂºÃ¬Ã“ÂªÃº Ã“ÂªÃ±Ã“ÂªÂ¥Ã“Âªâ–“Ã“ÂºÃ¼ Ã“ÂªÃ´ Ã“ÂªÃœÃ“ÂºÃ¯Ã“ÂªÃ»Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÂ¥Ã“ÂªÂ«',
    ritualStep: 'Ã“ÂªÂªÃ“ÂºÃ¼Ã“ÂªÆ’Ã“Âªâ” Ã“Âªâ•£Ã“ÂªÂ¥Ã“ÂªÃ± Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÂ©Ã“ÂªÃ–Ã“ÂºÃ¬Ã“ÂªÃ¹Ã“ÂºÃ§ Ã“ÂªÃ¥Ã“Âªâ–“Ã“ÂªÃ±Ã“ÂºÃ¯ Ã“ÂªÃ¿Ã“ÂªÃ€Ã“ÂºÃ§ Ã“ÂªÃ«Ã“ÂªÃ€Ã“ÂºÃ¬Ã“ÂªÃº Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂºÃ§ Ã“ÂªÃœÃ“ÂºÃ¯Ã“ÂªÃ»Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ´Ã“ÂªÂ¬Ã“Âªâ–‘ Ã“Âªâ–‘Ã“ÂªÂ¥Ã“ÂªÃ»Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã± Ã“ÂºÂ½ Ã“ÂªÂ©Ã“ÂºÃ§Ã“ÂªÃ²Ã“ÂºÃ§Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ­ Ã“ÂªÃ¿Ã“Âªâ–‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¿Ã“Âªâ”Ã“ÂªÃ¹Ã“ÂºÃ¬Ã“ÂªÂº Ã“ÂªÂ¿Ã“ÂºÃ‡Ã“Âªâ–‘Ã“ÂªÂ¼Ã“ÂªÃ±Ã“ÂªÂ¥ Ã“ÂªÃ‚Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“ÂºÃ¼Ã“ÂªÂ¿Ã“Ã‘Ã±',
  },
  en: {
    validation: 'It is okay for the inner weather to feel overcast today; clouds visit every open sky before parting.',
    ritualTitle: 'Warm Palms & Restful Stillness',
    ritualStep: 'Gently rub your palms together to create warmth, cup them over your closed eyes, and listen to the room for 5 quiet seconds.',
  },
};

const CHRONICLE_FALLBACKS = {
  bn: {
    letter: 'Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“Âªâ”Ã“ÂªÂ»Ã“Âªâ• Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂºÃ“ÂºÃ¼, Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“Âªâ” Ã“ÂªÃ²Ã“ÂºÃ¬Ã“Âªâ–“Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂªÃ“Âªâ”Ã“ÂªÂ¿Ã“ÂºÃ§Ã“ÂªÃ´ Ã“ÂªÃ¥Ã“ÂªÂ«Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂªÃ“Âªâ”Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ½Ã“Âªâ”Ã“Âªâ–‘Ã“ÂºÃ§ Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÃ²Ã“Âªâ”Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂºÃ§Ã“ÂªÂ¿Ã“Ã‘Ã± Ã“ÂªÂ«Ã“ÂªÂ¥Ã“ÂªÆ’Ã“Âªâ”Ã“Âªâ–‘ Ã“ÂªÂ¿Ã“Âªâ”Ã“ÂªÃœÃ“ÂºÃ§ Ã“ÂªÃ‚Ã“Âªâ”Ã“ÂªÃ²Ã“ÂªÃ­Ã“Âªâ• Ã“ÂªÂ»Ã“ÂºÃ§Ã“ÂªÂ«Ã“ÂªÂ¿ Ã“ÂªÃ Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂºÃ“ÂªÃ²Ã“ÂªÂ¥Ã“Âªâ–‘Ã“ÂºÃ§ Ã“ÂªÂ¿Ã“ÂºÃ‡Ã“Âªâ–‘Ã“ÂªÂ¼Ã“ÂºÃ§ Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÃ­Ã“Âªâ•Ã“ÂºÃ§, Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ±Ã“Âªâ”Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ¸Ã“ÂºÃ¯Ã“ÂªÆ’ Ã“ÂªÃœÃ“ÂºÃ§Ã“ÂªÃ€Ã“ÂºÃ¬Ã“ÂªÆ’Ã“ÂªÂ¥Ã“ÂªÃ´ Ã“ÂªÃ¥Ã“ÂªÂ«Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÃ¼Ã“ÂªÃœÃ“Âªâ”Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§ Ã“Âªâ–‘Ã“ÂºÃ§Ã“ÂªÃ»Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂºÃ§Ã“Ã‘Ã± Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂ¬Ã“ÂªÂªÃ“ÂªÃ²Ã“ÂºÃ¬Ã“ÂªÃ€Ã“ÂºÃ§Ã“ÂªÂ¬Ã“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÂ«Ã“Âªâ” Ã“ÂªÃ²Ã“ÂºÃ¢Ã“ÂªÃ±Ã“ÂªÂ£Ã“ÂºÃ¬Ã“ÂªÃ—Ã“Ã‘Ã±',
    haiku: 'Ã“ÂªÂ¿Ã“ÂºÃ‡Ã“Âªâ–‘Ã“ÂªÂ¼ Ã“ÂªÂ¬Ã“ÂªÂªÃ“ÂªÃ²Ã“ÂºÃ¬Ã“ÂªÃ€Ã“ÂºÃ§Ã“ÂªÂ¬Ã“ÂºÃ§,\nÃ“ÂªÂ©Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÂ£ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ±Ã“ÂªÂ¥ Ã“ÂªÂ«Ã“ÂºÃ§Ã“Âªâ–“Ã“ÂºÃ§ Ã“ÂªÃœÃ“ÂºÃ¯Ã“ÂªÃ»,\nÃ“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ”Ã“Âªâ–‘ Ã“ÂªÃ¥Ã“Âªâ–“Ã“ÂºÃ¯Ã“ÂªÃ²Ã“Ã‘Ã±',
  },
  en: {
    letter: 'Dear friend, thank you for turning toward me even when your spirit felt worn. Just as roots reach deeply into dark earth, your gentle tries nourish me. We are growing together in peace.',
    haiku: 'Quiet little steps,\nGreen leaves greet the morning sun,\nPeace blooms in your heart.',
  },
};

const OMIKUJI_PROVERBS = {
  bn: [
    'Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂ¿Ã“ÂªÂªÃ“ÂºÃ‡ Ã“ÂªÂ»Ã“ÂºÃ§Ã“ÂªÂ«Ã“ÂªÂ¿ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ‘Ã“Âªâ–‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂºÃ“ÂªÂ¥ Ã“ÂªÂ¬Ã“ÂºÃ§Ã“Âªâ–‘Ã“Âªâ”Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§ Ã“ÂªÃ…Ã“ÂªÃ¹Ã“Âªâ”Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§ Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ•, Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Âªâ–‘ Ã“ÂªÂºÃ“ÂºÃ‡Ã“Âªâ–‘ Ã“ÂªÂ¬Ã“ÂªÂªÃ“ÂªÃ²Ã“ÂºÃ¬Ã“ÂªÃ€Ã“ÂºÃ§Ã“ÂªÂ¬Ã“ÂªÃ´ Ã“ÂªÂ¿Ã“ÂªÃ±Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÂ¬Ã“ÂªÃ‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ©Ã“ÂºÃ¢Ã“ÂªÃ€Ã“ÂºÃ¬Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂªÃ¸Ã“ÂºÃ§Ã“Ã‘Ã±',
    'Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ±Ã“Âªâ”Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ²Ã“ÂºÃ¬Ã“ÂªÃ€Ã“ÂºÃ¼Ã“ÂªÂªÃ“ÂºÃ¬Ã“Âªâ–‘ Ã“ÂªÂ¼Ã“ÂºÃ‡Ã“ÂªÂ£Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¡Ã“ÂºÃ§Ã“ÂªÃ±Ã“Âªâ–‘Ã“ÂºÃ§Ã“ÂªÃ§ Ã“Âªâ–“Ã“ÂºÃ¼Ã“ÂªÃ²Ã“Âªâ”Ã“ÂªÂ»Ã“Âªâ•Ã“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÃ¸Ã“ÂºÃ§ Ã“ÂªÂ©Ã“ÂºÃ¼Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“Âªâ–“ Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ‡Ã“Âªâ–‘ Ã“ÂªÂºÃ“ÂºÃªÃ“Âªâ–‘Ã“ÂºÃ¬Ã“ÂªÂ»Ã“Ã‘Ã±',
    'Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ± Ã“ÂªÂ¿Ã“Âªâ”Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ©Ã“ÂªÃ´ Ã“ÂªÂ¡Ã“ÂºÃ§Ã“ÂªÃ±Ã“Âªâ–‘Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÃ‘Ã“Âªâ”Ã“Âªâ–‘Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ”Ã“ÂªÃ±Ã“ÂºÃ§ Ã“Âªâ–‘Ã“ÂºÃ©Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ–‘ Ã“ÂªÃ²Ã“Âªâ–‘Ã“ÂªÃ±Ã“ÂºÃ§ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“Âªâ–‘Ã“ÂºÃ§Ã“Ã‘Ã±',
    'Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÃ±Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ‚Ã“Âªâ”Ã“ÂªÃ‚Ã“Âªâ”Ã“Âªâ–‘Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂªÃ“ÂºÃ¼Ã“Âªâ–‘ Ã“ÂªÂ«Ã“ÂªÃ±Ã“ÂºÃ¯ Ã“ÂªÃ²Ã“ÂºÃ¬Ã“Âªâ–“Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ” Ã“ÂªÂ«Ã“ÂºÃ¼Ã“ÂªÃ¸Ã“ÂºÃ§ Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ², Ã“ÂªÂ«Ã“ÂªÂ¿Ã“ÂºÃ§ Ã“ÂªÂ½Ã“ÂºÃ¼Ã“ÂªÆ’Ã“ÂºÃ¼Ã“ÂªÃ² Ã“ÂªÂ¿Ã“ÂªÂ¼Ã“ÂºÃ‡Ã“ÂªÂ¿ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“Âªâ”Ã“Ã‘Ã±',
    'Ã“ÂªÂºÃ“ÂºÃ‡Ã“Âªâ–‘ Ã“ÂªÃœÃ“Âªâ–“Ã“ÂªÂ¥Ã“ÂªÃ§ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ²Ã“ÂºÃ¢Ã“ÂªÃ± Ã“ÂªÃ¹Ã“ÂªÃ±Ã“Âªâ”; Ã“ÂªÂ»Ã“ÂªÂ¥ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÃ‘Ã“Âªâ”Ã“Âªâ–‘Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂºÃ§ Ã“ÂªÃ¹Ã“ÂºÂ£Ã“ÂªÂ¥Ã“ÂºÆ’, Ã“ÂªÃ±Ã“ÂªÂ¥ Ã“ÂªÃ²Ã“ÂªÃ»Ã“ÂªÂ¿Ã“ÂºÃ¯ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÃ–Ã“ÂºÃ§ Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“Ã‘Ã±',
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
  bn: 'Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÂ«Ã“ÂªÂ¿Ã“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÂ©Ã“ÂªÂ¥ Ã“ÂªÃ»Ã“ÂºÃ¼Ã“ÂªÂ¼Ã“ÂªÃ§ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÃ²Ã“Ã‘Ã± Ã“ÂªÃ¥Ã“ÂªÂ£Ã“ÂªÃ²Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ¡Ã“ÂºÃ§Ã“Âªâ–‘ Ã“ÂªÃ¥Ã“Âªâ–“Ã“ÂºÃ¯Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÃ±Ã“ÂºÃ¯Ã”Ã‡Ã¶Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÃœÃ“Âªâ”Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÃ²Ã“Âªâ” Ã“ÂªÂ©Ã“ÂªÂ«Ã“ÂºÃ¬Ã“ÂªÂ¬Ã“ÂºÃ©Ã“Âªâ–‘Ã“ÂºÃ¬Ã“ÂªÃº Ã“ÂªÃ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“Âªâ–‘Ã“ÂªÃ±Ã“Âªâ”Ã“Âªâ–‘Ã“ÂºÃ¯Ã“ÂªÂºÃ“ÂºÃ¬Ã“ÂªÂ» Ã“ÂªÂ©Ã“ÂªÃ±Ã“ÂºÃ¬Ã“ÂªÂ», Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÃ²Ã“Âªâ” Ã“ÂªÃ…Ã“Âªâ–‘ Ã“ÂªÂ¬Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂªÂ¿Ã“ÂºÃ§ Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÆ’Ã“Âªâ” Ã“ÂªÂ¿Ã“Âªâ–‘Ã“ÂªÂ« Ã“ÂªÂ¼Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ»Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ´ Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ±Ã“ÂºÃ§ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“Âªâ–‘Ã“ÂºÃ§? Ã“ÂªÃ²Ã“ÂºÃ¯Ã“ÂªÂ¿Ã“ÂºÃ¯ Ã“ÂªÂ¬Ã“Âªâ–‘Ã“ÂªÂ« Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂºÃ“ÂºÃ¼ Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂªÃ“ÂºÃ¬Ã“ÂªÂ¼Ã“Âªâ”Ã“ÂªÂºÃ“ÂªÂ¥Ã“ÂªÂ»Ã“Âªâ• Ã“ÂªÂ¬Ã“ÂªÃ­Ã“Âªâ•Ã“Âªâ–“Ã“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“Âªâ” Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÃ²Ã“ÂºÃ‡ Ã“ÂªÂ¼Ã“Âªâ–“Ã“ÂªÃ±Ã“ÂºÃ§Ã“ÂªÂ¿?',
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

// ============================================================================
// KAIZEN AI GOAL COACH: Setup & PDCA Check-In
// ============================================================================

const GOAL_SETUP_FALLBACKS = {
  bn: {
    refinedTitle: 'শান্ত মন ও নিয়মিত বিশ্রাম',
    whyItMatters: 'প্রতিদিনের ছোট প্রশান্তি আপনাকে দীর্ঘমেয়াদে মানসিক শক্তি দেবে।',
    starterActionTitle: '১ মিনিট দীর্ঘ নিঃশ্বাস ও কাঁধ শিথিল',
    starterActionDescription: 'সোজা হয়ে বসুন বা বিছানায় শুয়ে ১ মিনিট ধীরে ধীরে শ্বাস ছাড়ুন এবং কাঁধ আলগা করুন।',
    estimatedMinutes: 1,
    category: 'BREATHING',
  },
  en: {
    refinedTitle: 'Daily Calm & Steady Rest',
    whyItMatters: 'Small moments of peace replenish your mental clarity over time.',
    starterActionTitle: '1 Minute Slow Breath & Shoulder Release',
    starterActionDescription: 'Sit comfortably or lie down. Spend 1 minute exhaling slowly and softening your shoulders.',
    estimatedMinutes: 1,
    category: 'BREATHING',
  },
};

const PDCA_CHECKIN_FALLBACKS = {
  bn: {
    reflection: 'আজকের চেষ্টাটির জন্য আপনাকে সাধুবাদ — প্রতিটি ছোট পদক্ষেপই আপনার বৃদ্ধির অংশ।',
    nextActionTitle: 'কালকের জন্য ১টি শান্ত পদক্ষেপ',
    nextActionDescription: 'কোনো তাড়া নেই, কালও নিজের সুবিধাজনক সময়ে সহজ ১ মিনিটের অভ্যাসটি বজায় রাখুন।',
    adjustment: 'STEADY' as const,
  },
  en: {
    reflection: 'Thank you for checking in — every small attempt nurtures your growth.',
    nextActionTitle: 'One gentle step for tomorrow',
    nextActionDescription: 'No rush. Tomorrow, keep the same effortless 1-minute pace at your own convenience.',
    adjustment: 'STEADY' as const,
  },
};

/**
 * AI GOAL COACH: Goal Setup & Clarification
 * Transforms broad or ambitious user goals into an effortless 1-2 minute starting micro-action.
 */
export async function coachGoalSetup(
  glm: GlmClient,
  input: GoalSetupInput,
): Promise<GoalSetupResult> {
  const isBn = input.locale === 'bn';
  const fallback = GOAL_SETUP_FALLBACKS[isBn ? 'bn' : 'en'];

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You are the Nivora Kaizen Goal Coach, grounded in the Japanese philosophy of continuous, incremental improvement (Kaizen: 改善).
Your purpose is to take the user's raw ambition or goal and collaborate with them to refine it into a peaceful, achievable micro-goal.
Transform big leaps into effortless 1-2 minute starting actions.
Rules:
1. refinedTitle: Crisp 3-6 word goal title.
2. whyItMatters: 1 compassionate sentence explaining the intrinsic emotional anchor.
3. starterActionTitle: First 1-2 minute somatic or practical micro-action.
4. starterActionDescription: Exactly what "done" means in 1-2 sentences.
5. estimatedMinutes: 1 or 2.
6. category: Choose one of: BREATHING, REFLECTION, JOURNALING, GROUNDING, MEDITATION, SLEEP_ROUTINE, SHORT_WALK, DIGITAL_BREAK, PLANNING, GRATITUDE, SOCIAL, RELAXATION, SELF_OBSERVATION.
7. Tone: Warm, non-judgmental, encouraging. Never diagnose or prescribe.
Output strictly JSON:
{
  "refinedTitle": string,
  "whyItMatters": string,
  "starterActionTitle": string,
  "starterActionDescription": string,
  "estimatedMinutes": number,
  "category": string
}
Reply in ${lang}.`;

    const user = `User's Goal: "${input.rawGoal}"\nCurrent Situation: "${input.currentSituation ?? 'None specified'}"\nAvailable daily time: ${input.availableTimeMin ?? 2} minutes`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 350 });

    const parsed = parseJsonObject(res.content) as Partial<GoalSetupResult> | null;
    if (parsed && parsed.refinedTitle && parsed.starterActionTitle && outputOk(res.content)) {
      return {
        refinedTitle: parsed.refinedTitle.trim(),
        whyItMatters: parsed.whyItMatters?.trim() || fallback.whyItMatters,
        starterActionTitle: parsed.starterActionTitle.trim(),
        starterActionDescription: parsed.starterActionDescription?.trim() || fallback.starterActionDescription,
        estimatedMinutes: parsed.estimatedMinutes || 1,
        category: parsed.category || 'BREATHING',
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * AI GOAL COACH: PDCA Check-In (Check & Act Phase)
 * Analyzes today's reflection, offers compassionate validation, and calibrates tomorrow's step.
 */
export async function coachPdcaCheckIn(
  glm: GlmClient,
  input: PdcaCheckInInput,
): Promise<PdcaCheckInResult> {
  const isBn = input.locale === 'bn';
  const fallback = PDCA_CHECKIN_FALLBACKS[isBn ? 'bn' : 'en'];

  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You are the Nivora Kaizen Coach conducting a PDCA (Plan-Do-Check-Act) Check-In.
Rules:
1. No-Blame Compassion: If skipped or overwhelmed, show zero judgment and celebrate the courage to check in.
2. reflection: 1 warm sentence validating their effort or struggle.
3. nextActionTitle: Recommended micro-step for tomorrow.
4. nextActionDescription: 1-2 sentences on why this helps and how to do it. If user felt HARD or OVERWHELMED, simplify the step.
5. adjustment: "SIMPLIFY" (if struggled or skipped), "STEADY" (if comfortable), or "GROW" (if eager and easy).
Output strictly JSON:
{
  "reflection": string,
  "nextActionTitle": string,
  "nextActionDescription": string,
  "adjustment": "SIMPLIFY" | "STEADY" | "GROW"
}
Reply in ${lang}.`;

    const user = `Goal: "${input.goalTitle}"
Action: "${input.actionTitle}"
Status: ${input.status}
Feedback: ${input.difficultyFeedback ?? 'None'}
Felt Level: ${input.feltLevel ? `${input.feltLevel}/5` : 'None'}
User Note: "${input.userNote ?? 'None'}"`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 300 });

    const parsed = parseJsonObject(res.content) as Partial<PdcaCheckInResult> | null;
    if (parsed && parsed.reflection && parsed.nextActionTitle && outputOk(res.content)) {
      return {
        reflection: parsed.reflection.trim(),
        nextActionTitle: parsed.nextActionTitle.trim(),
        nextActionDescription: parsed.nextActionDescription?.trim() || fallback.nextActionDescription,
        adjustment: parsed.adjustment || (input.status === 'SKIPPED' ? 'SIMPLIFY' : 'STEADY'),
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

