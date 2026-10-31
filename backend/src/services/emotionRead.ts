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

/** The form of the next reply. Chosen in code (no extra model call) so replies stop all having the same "feeling + sympathy + question" shape. */
export type ReplyShape = 'ack' | 'reflect' | 'reflect_ask' | 'invite' | 'connect';
/** Above this share of recent assistant replies ending in a question, the next one must not. */
export const MAX_QUESTION_SHARE = 0.55;

const ENDS_WITH_QUESTION = /[?؟？]["'”’)\]]*\s*$/;
export function endsWithQuestion(text: string): boolean { return ENDS_WITH_QUESTION.test(text.trim()); }

/**
 * Deterministic reply-shape choice. `recent` = the last assistant replies, oldest first (only the last 3 count). Works with a null read
 * (falls back on how recent replies ended). Rules: never 3 questions in a row, at most ~55% question endings, intensity >= 4 means
 * no pushing question, 'connect' only when the context really has something earlier to link to (`hasContext`).
 */
export function pickReplyShape(read: EmotionRead | null, recent: string[] = [], opts: { hasContext?: boolean; userText?: string } = {}): ReplyShape {
  const last = recent.slice(-3);
  const qCount = last.filter(endsWithQuestion).length;
  const noQuestion = last.length > 0 && qCount / last.length > MAX_QUESTION_SHARE;
  const seed = (last.at(-1)?.length ?? 0) + last.length; // deterministic variety without randomness
  const pick = <T,>(xs: T[]): T => xs[seed % xs.length]!;
  if (read && read.intensity >= 4) return read.intensity >= 5 ? 'ack' : 'reflect';
  if (read?.need === 'practical' || read?.need === 'perspective') return noQuestion ? 'reflect' : 'reflect_ask';
  const words = (opts.userText ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (opts.userText !== undefined && words > 0 && words <= 3) return pick(['ack', 'invite']);
  if (opts.hasContext && !noQuestion && seed % 4 === 0) return 'connect';
  if (opts.hasContext && noQuestion && seed % 3 === 0) return 'connect';
  if (noQuestion) return pick<ReplyShape>(['reflect', 'ack', 'invite']);
  if (read?.need === 'listen' || read?.need === 'comfort') return pick<ReplyShape>(['reflect', 'reflect_ask', 'invite']);
  return pick<ReplyShape>(['reflect_ask', 'reflect', 'reflect_ask']);
}

/** Short private instruction for the system prompt. */
export function shapeBlock(shape: ReplyShape): string {
  const how: Record<ReplyShape, string> = {
    ack: 'ONE short acknowledgement (a few words to one short sentence). No question. Just let them know you heard.',
    reflect: 'Reflect what they feel in their own words, 1-2 short sentences. Do NOT end with a question.',
    reflect_ask: 'Reflect the feeling briefly, then ONE soft open question at the end.',
    invite: 'Warmly invite them to say more or take their time, as a statement, not a question. No question mark.',
    connect: 'Briefly link what they say now to something they told you earlier, if it truly fits; otherwise just reflect. Do not recite, and do not push.',
  };
  return `REPLY SHAPE (private, never mention it): ${how[shape]} Keep it as short as their message allows.`;
}
