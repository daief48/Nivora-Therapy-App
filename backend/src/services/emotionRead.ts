import { z } from 'zod';
import type { GlmClient } from './glmClient.js';

/** Private pre-reply read of what the person feels and needs. Never shown to the user, never stored, never logged. */
export const EMOTION_READ_TIMEOUT_MS = 2500;

export const emotionReadSchema = z.object({
  emotions: z.array(z.string().trim().min(1).max(40)).max(3),
  intensity: z.coerce.number().int().min(1).max(5),
  need: z.enum(['listen', 'validate', 'perspective', 'practical', 'comfort', 'unclear']),
  theme: z.string().trim().max(80).default(''),
  userWords: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
});
export type EmotionRead = z.infer<typeof emotionReadSchema>;

const SYSTEM = `You read the emotional content of one message from a person talking to a wellness companion. Reply with ONE JSON object only, no prose:
{"emotions":[up to 3 short feeling words, in the SAME language and script as the message],"intensity":1-5,"need":"listen|validate|perspective|practical|comfort|unclear","theme":"short phrase in the message's language","userWords":[up to 3 exact short phrases copied from the message that express the feeling]}
need: listen = wants to be heard; validate = wants to know the feeling is okay; perspective = wants another view; practical = explicitly asks what to do; comfort = hurting and needs warmth; unclear = cannot tell. Use "practical" only if they ask for advice or steps. Do not diagnose. Do not add anything else.`;

export function parseEmotionRead(raw: string): EmotionRead | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const r = emotionReadSchema.safeParse(JSON.parse(m[0]));
    return r.success ? r.data : null;
  } catch { return null; }
}

/** Fail-safe: any error, timeout or malformed output returns null and the reply simply goes ahead without the read. */
export async function readEmotion(
  glm: GlmClient, text: string, opts: { signal?: AbortSignal; timeoutMs?: number; previousUser?: string } = {},
): Promise<EmotionRead | null> {
  if (!text.trim()) return null;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? EMOTION_READ_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const user = opts.previousUser ? `Earlier message (context only): ${opts.previousUser.slice(0, 300)}\n\nMessage to read: ${text.slice(0, 1500)}` : text.slice(0, 1500);
    const r = await glm.chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], { signal, maxTokens: 160 });
    return parseEmotionRead(r.content);
  } catch { return null; }
}

/** Short private block for the system prompt. */
export function emotionBlock(read: EmotionRead | null): string {
  if (!read) return '';
  const quiet = read.need === 'listen' || read.need === 'validate' || read.need === 'comfort';
  const lines = [
    'EMOTION READ (private, never mention it):',
    `- Feeling: ${read.emotions.join(', ') || 'unclear'} (intensity ${read.intensity}/5)${read.theme ? `; about: ${read.theme}` : ''}.`,
  ];
  if (read.userWords.length) lines.push(`- Their own words for it: ${read.userWords.map((w) => `"${w}"`).join(', ')}. Reflect the feeling using these words, not clinical ones.`);
  if (read.intensity >= 4) lines.push('- Intensity is high: be gentle and slow, very short, no questions that push; stay with them first.');
  lines.push(quiet
    ? `- They need: ${read.need}. Do NOT give solutions, tips or explanations now. Reflect, validate, at most one open question.`
    : `- They need: ${read.need}. Still reflect the feeling first; offer only what fits that need, briefly.`);
  return lines.join('\n');
}
