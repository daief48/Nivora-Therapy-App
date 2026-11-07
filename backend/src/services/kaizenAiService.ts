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

// ============================================================================
// Curated Static Fallbacks (Resilience Architecture)
// ============================================================================

export const SOCRATIC_FALLBACKS = {
  bn: 'এই সন্দেহটা মনে আসা খুবই স্বাভাবিক। আজকের পাঠের আলোকে ভাবুন, এই চিন্তাটা কি একেবারে নিশ্চিত সত্য, নাকি এর নিচে আরও কোমল একটা ব্যাখ্যা লুকিয়ে আছে? কোনো কাছের বন্ধু যদি ঠিক এভাবে অনুভব করত, তাকে আপনি কোন সহমর্মী সত্যটা মনে করিয়ে দিতেন?',
  en: 'That is a very understandable doubt to carry. Looking at today\'s lesson, is this thought an absolute certainty, or might there be a gentler interpretation waiting beneath? If a close friend felt this way, what compassionate truth would you remind them of?',
};

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
