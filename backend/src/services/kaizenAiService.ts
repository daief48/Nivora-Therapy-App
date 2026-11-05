import type { GlmClient } from './glmClient.js';
import { outputOk, parseJsonObject } from './aiOutput.js';
import { aiReplyLanguage } from './systemPrompt.js';

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

export interface SuggestedGoal {
  title: string;
  category: string;
  whyItMatters: string;
  startMinutes?: number;
}

export interface TherapyGoalSuggestionInput {
  /** Session summary (decrypted) when available; the rule layer decides, this only phrases. */
  sessionSummary?: string;
  /** Deterministic condition signals, e.g. HIGH_STRESS, SLEEP_LOW, MOOD_IMPROVED. */
  signals: string[];
  locale?: string | null;
}

export interface TherapyGoalSuggestionResult {
  reason: string;
  goals: SuggestedGoal[];
}

// ============================================================================
// Curated Static Fallbacks (Resilience Architecture)
// ============================================================================

const SOCRATIC_FALLBACKS = {
  bn: 'Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÆ’Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÃ© Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ® Ã“ÂªÂ»Ã“ÂªÂ¥ Ã“ÂªÂ©Ã“ÂªÂ¥ Ã“ÂªÃ»Ã“ÂºÃ¼Ã“ÂªÂ¼Ã“ÂªÃ§ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂªÃ¢Ã“ÂªÃ²Ã“Ã‘Ã± Ã“ÂªÃ¥Ã“ÂªÂ£Ã“ÂªÃ²Ã“ÂºÃ§Ã“ÂªÃ¢Ã“ÂªÃ‘ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ¡Ã“ÂºÃ§Ã“ÂªÃ¢Ã“ÂªÃ‘ Ã“ÂªÃ¥Ã“ÂªÃ¢Ã“Âªâ–â€œÃ“ÂºÃ¯Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÃ±Ã“ÂºÃ¯Ã”Ã‡Ã¶Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÃœÃ“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÆ’Ã“ÂªÃ¢ Ã“ÂªÃ²Ã“ÂªÃ¢ Ã“ÂªÂ©Ã“ÂªÂ«Ã“ÂºÃ¬Ã“ÂªÂ¬Ã“ÂºÃ©Ã“ÂªÃ¢Ã“ÂªÃ‘Ã“ÂªÃº Ã“ÂªÃ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“ÂªÃ¢Ã“ÂªÃ±Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÃ‘Ã“ÂªÂºÃ“ÂºÃ¬Ã“ÂªÂ» Ã“ÂªÂ©Ã“ÂªÃ±Ã“ÂºÃ¬Ã“ÂªÂ», Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ¢ Ã“ÂªÃ…Ã“ÂªÃ¢ Ã“ÂªÂ¬Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂªÂ¿Ã“ÂºÃ§ Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÆ’Ã“ÂªÃ¢ Ã“ÂªÂ¿Ã“ÂªÃ¢ Ã“ÂªÃ« Ã“ÂªÂ¼Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ»Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ´ Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ±Ã“ÂºÃ§ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ¢Ã“ÂªÃ‘Ã“ÂºÃ§? Ã“ÂªÃ²Ã“ÂºÃ¯Ã“ÂªÂ¿Ã“ÂºÃ¯ Ã“ÂªÂ¬Ã“ÂªÃ¢ Ã“ÂªÃ« Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂºÃ“ÂºÃ¼ Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂªÃ“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂºÃ“ÂªÂ¥Ã“ÂªÂ»Ã“ÂªÃ¢Ã“ÂªÃ¢ Ã“ÂªÂ¬Ã“ÂªÃ­Ã“ÂªÃ¢Ã“ÂªÃ¢Ã“Âªâ–â€œÃ“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÃ¢ Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÃ²Ã“ÂºÃ‡ Ã“ÂªÂ¼Ã“ÂªÃ¢ Ã“ÂªÃ±Ã“ÂªÂºÃ“ÂºÃ§Ã“ÂªÂ¿?',
  en: 'That is a very understandable doubt to carry. Looking at today\'s lesson, is this thought an absolute certainty, or might there be a gentler interpretation waiting beneath? If a close friend felt this way, what compassionate truth would you remind them of?',
};

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

/** Rule-based suggestions keyed by condition signal; the deterministic fallback when the model fails or is not consented to. */
const THERAPY_GOAL_FALLBACKS: SuggestedGoal[] = [
  { title: 'Steady breathing pause', category: 'BREATHING', whyItMatters: 'A short daily pause helps your body settle when stress runs high.', startMinutes: 2 },
  { title: 'Gentle sleep wind-down', category: 'SLEEP_ROUTINE', whyItMatters: 'A calm evening routine makes rest come a little easier.', startMinutes: 5 },
  { title: 'Small daily walk', category: 'SHORT_WALK', whyItMatters: 'A few minutes outside gently lifts a heavy mood.', startMinutes: 3 },
  { title: 'Evening reflection', category: 'REFLECTION', whyItMatters: 'Writing for a moment helps untangle racing thoughts.', startMinutes: 2 },
];

const THERAPY_REASON_FALLBACKS = {
  bn: 'আপনার সেশনের পর ছোট ছোট পদক্ষেপ দিয়ে নিজেকে সাহায্য করার সুযোগ আছে মনে হচ্ছে।',
  en: 'After this session, a few small steps could help you keep feeling steadier.',
};

/** Signal -> fallback suggestion indexes (first match wins; duplicates removed). */
const SIGNAL_GOAL_MAP: Record<string, number[]> = {
  HIGH_STRESS: [0, 3],
  SLEEP_LOW: [1, 0],
  LOW_MOOD_AFTER: [2, 3],
  MOOD_DROPPED: [2, 0],
  KAIZEN_STALLED: [0, 3],
};

export function therapyGoalFallback(signals: string[], locale?: string | null): TherapyGoalSuggestionResult {
  const isBn = locale === 'bn';
  const picks: number[] = [];
  for (const s of signals) for (const i of SIGNAL_GOAL_MAP[s] ?? []) if (!picks.includes(i)) picks.push(i);
  const goals = (picks.length ? picks : [0]).slice(0, 3).map((i) => THERAPY_GOAL_FALLBACKS[i]!);
  return { reason: THERAPY_REASON_FALLBACKS[isBn ? 'bn' : 'en'], goals };
}

/**
 * Phrases 1-3 suggested Kaizen goals from the deterministic condition signals.
 * The rule layer has ALREADY decided that a goal should be offered; this never decides.
 * Every string passes outputOk; anything flagged falls back to the curated suggestions.
 */
export async function suggestTherapyGoals(
  glm: GlmClient,
  input: TherapyGoalSuggestionInput,
): Promise<TherapyGoalSuggestionResult> {
  const fallback = therapyGoalFallback(input.signals, input.locale);
  try {
    const lang = aiReplyLanguage(input.locale);
    const system = `You phrase Kaizen goals for a therapy companion. The rule engine has ALREADY decided the user's condition would benefit from small goals; you only word them.
Rules:
1. 1-3 goals, each built from ONE small daily practice (Kaizen: tiny steps, no pressure, never shame).
2. category: exactly one of BREATHING, REFLECTION, JOURNALING, GROUNDING, MEDITATION, SLEEP_ROUTINE, SHORT_WALK, DIGITAL_BREAK, PLANNING, GRATITUDE, SOCIAL, RELAXATION, SELF_OBSERVATION.
3. title: 3-6 words, concrete and kind.
4. whyItMatters: 1 warm sentence tied to how the user has been feeling.
5. startMinutes: 1-5 (the first step must be tiny).
6. reason: 1-2 gentle sentences explaining why a goal might help now; no diagnosis, no "you should", no mention of scores or risk.
Output strictly JSON: {"reason": string, "goals": [{"title": string, "category": string, "whyItMatters": string, "startMinutes": number}]}
Reply in ${lang}.`;

    const user = `Condition signals: ${input.signals.join(', ') || 'none'}\n${input.sessionSummary ? `Session summary: ${input.sessionSummary}` : 'No session summary available.'}`;

    const res = await glm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 400 });

    const parsed = parseJsonObject(res.content) as Partial<TherapyGoalSuggestionResult> | null;
    if (
      parsed && typeof parsed.reason === 'string' && Array.isArray(parsed.goals) && parsed.goals.length > 0
      && parsed.goals.slice(0, 3).every((g) => g && typeof g.title === 'string' && typeof g.category === 'string')
      && outputOk(parsed.reason, ...parsed.goals.map((g) => `${g.title} ${g.whyItMatters ?? ''}`))
    ) {
      return {
        reason: parsed.reason.trim(),
        goals: parsed.goals.slice(0, 3).map((g) => ({
          title: g.title.trim().slice(0, 120),
          category: g.category.trim(),
          whyItMatters: (g.whyItMatters ?? '').trim().slice(0, 300),
          startMinutes: Math.min(5, Math.max(1, Math.round(Number(g.startMinutes) || 2))),
        })),
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}


/**
 * Socratic Soul Mirror
 * Guided Program interactive CBT peer tutor examining doubts and negative thoughts.
 */
// ============================================================================
// Guided-program CBT peer tutor
// ============================================================================

/**
 * Socratic Soul Mirror
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

// ============================================================================
// KAIZEN AI GOAL COACH: Setup & PDCA Check-In
// ============================================================================

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
