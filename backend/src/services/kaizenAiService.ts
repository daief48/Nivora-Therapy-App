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

const SOCRATIC_FALLBACKS = {
  bn: 'Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÆ’Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂ¥Ã“ÂªÃ© Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ® Ã“ÂªÂ»Ã“ÂªÂ¥ Ã“ÂªÂ©Ã“ÂªÂ¥ Ã“ÂªÃ»Ã“ÂºÃ¼Ã“ÂªÂ¼Ã“ÂªÃ§ Ã“ÂªÂ©Ã“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÂ¥Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂªÃ¢Ã“ÂªÃ²Ã“Ã‘Ã± Ã“ÂªÃ¥Ã“ÂªÂ£Ã“ÂªÃ²Ã“ÂºÃ§Ã“ÂªÃ¢Ã“ÂªÃ‘ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ¡Ã“ÂºÃ§Ã“ÂªÃ¢Ã“ÂªÃ‘ Ã“ÂªÃ¥Ã“ÂªÃ¢Ã“Âªâ–â€œÃ“ÂºÃ¯Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÂ¡Ã“ÂªÂ¥Ã“ÂªÂ¼Ã“ÂºÃ¼Ã“ÂªÂ¿ Ã“ÂªÃ±Ã“ÂºÃ¯Ã”Ã‡Ã¶Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÃœÃ“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÆ’Ã“ÂªÃ¢ Ã“ÂªÃ²Ã“ÂªÃ¢ Ã“ÂªÂ©Ã“ÂªÂ«Ã“ÂºÃ¬Ã“ÂªÂ¬Ã“ÂºÃ©Ã“ÂªÃ¢Ã“ÂªÃ‘Ã“ÂªÃº Ã“ÂªÃ Ã“ÂªÂ¬Ã“ÂºÃ¬Ã“ÂªÃ¢Ã“ÂªÃ±Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÃ‘Ã“ÂªÂºÃ“ÂºÃ¬Ã“ÂªÂ» Ã“ÂªÂ©Ã“ÂªÃ±Ã“ÂºÃ¬Ã“ÂªÂ», Ã“ÂªÂ¿Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ¢ Ã“ÂªÃ…Ã“ÂªÃ¢ Ã“ÂªÂ¬Ã“ÂºÃ§Ã“ÂªÃ¸Ã“ÂªÂ¿Ã“ÂºÃ§ Ã“ÂªÃ…Ã“ÂªÃ²Ã“ÂªÆ’Ã“ÂªÃ¢ Ã“ÂªÂ¿Ã“ÂªÃ¢ Ã“ÂªÃ« Ã“ÂªÂ¼Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ»Ã“ÂºÃ¬Ã“ÂªÂ»Ã“ÂªÂ¥Ã“ÂªÃ´ Ã“ÂªÃ‘Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂªÃ±Ã“ÂºÃ§ Ã“ÂªÂ¬Ã“ÂªÂ¥Ã“ÂªÃ¢Ã“ÂªÃ‘Ã“ÂºÃ§? Ã“ÂªÃ²Ã“ÂºÃ¯Ã“ÂªÂ¿Ã“ÂºÃ¯ Ã“ÂªÂ¬Ã“ÂªÃ¢ Ã“ÂªÃ« Ã“ÂªÂ¼Ã“ÂªÂ¿Ã“ÂºÃ¬Ã“ÂªÂºÃ“ÂºÃ¼ Ã“ÂªÃ…Ã“ÂªÃ§ Ã“ÂªÂªÃ“ÂºÃ¬Ã“ÂªÂ¼Ã“ÂªÃ¢Ã“ÂªÃ‚Ã“ÂªÂºÃ“ÂªÂ¥Ã“ÂªÂ»Ã“ÂªÃ¢Ã“ÂªÃ¢ Ã“ÂªÂ¬Ã“ÂªÃ­Ã“ÂªÃ¢Ã“ÂªÃ¢Ã“Âªâ–â€œÃ“ÂºÃ§ Ã“ÂªÃ¥Ã“ÂªÂ¬Ã“ÂªÂ¿Ã“ÂªÃ¢ Ã“ÂªÃ±Ã“ÂªÂ¥Ã“ÂªÃ²Ã“ÂºÃ§ Ã“ÂªÃ²Ã“ÂºÃ‡ Ã“ÂªÂ¼Ã“ÂªÃ¢ Ã“ÂªÃ±Ã“ÂªÂºÃ“ÂºÃ§Ã“ÂªÂ¿?',
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
