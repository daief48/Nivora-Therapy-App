import type { AvatarTone, Pose } from '../components/AvatarArt';

// Small, pure helpers that make replies feel less mechanical: pacing, splitting a long reply into two bubbles,
// the avatar's mood from the server's `affect` event, listening idle movement, and when a spoken filler is allowed.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ------------------------------------------------------------------ text pacing ------------------------------------------------------------------

/** The typing indicator appears this long after send (an instant one reads as a machine). */
export const TYPING_DELAY_MS = 350;
/** Minimum natural pause before the first streamed words show: 400 ms for a short reply up to 900 ms for a long one. */
export function firstWordsPauseMs(replyLen: number): number { return Math.round(clamp(400 + Math.max(0, replyLen) * 2.5, 400, 900)); }
/** Pause before the second bubble of a split reply. */
export function secondBubbleDelayMs(secondLen: number): number { return Math.round(clamp(500 + Math.max(0, secondLen) * 4, 600, 1000)); }

export const SPLIT_MIN_CHARS = 140;
const MIN_PART = 30;
/**
 * Splits a finished reply at a sentence boundary near its middle into two parts, or returns null (short, one sentence, or no good boundary).
 * Display only: callers keep one stored message. Joining the parts with a space gives back the original sentences.
 */
export function splitReply(text: string): [string, string] | null {
  const s = text.trim();
  if (s.length <= SPLIT_MIN_CHARS) return null;
  const re = /[.!?।]+["')\]”’]*(\s+)/g;
  let best: number | null = null, bestD = Infinity, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    const next = s.charAt(end);
    if (/[a-z]/.test(next)) continue; // "e.g. foo", "3. then": not a sentence start
    const cut = m.index + m[0].length - m[1]!.length; // end of the punctuation
    if (cut < MIN_PART || s.length - end < MIN_PART) continue;
    const d = Math.abs(cut - s.length / 2);
    if (d < bestD) { bestD = d; best = end; }
  }
  if (best === null) return null;
  const a = s.slice(0, best).trim(), b = s.slice(best).trim();
  return a && b ? [a, b] : null;
}

// ------------------------------------------------------------------ affect -> avatar mood ------------------------------------------------------------------

export interface Affect { emotion: string; intensity: number }
/** Reads an `affect` event defensively; unknown fields are ignored, anything malformed gives null. */
export function parseAffect(m: unknown): Affect | null {
  if (!m || typeof m !== 'object') return null;
  const { emotion, intensity } = m as { emotion?: unknown; intensity?: unknown };
  if (typeof emotion !== 'string' || !emotion.trim()) return null;
  const n = typeof intensity === 'number' ? intensity : Number(intensity);
  if (!Number.isFinite(n)) return null;
  return { emotion: emotion.trim().toLowerCase(), intensity: clamp(Math.round(n), 1, 5) };
}

const HEAVY = new Set(['sad', 'sadness', 'anxious', 'anxiety', 'grief', 'grieving', 'fear', 'afraid', 'scared', 'worried', 'worry', 'distress', 'distressed', 'hopeless', 'despair', 'lonely', 'loneliness', 'overwhelmed', 'stressed', 'panic', 'shame', 'guilt', 'hurt', 'angry', 'anger', 'depressed']);
const LIGHT = new Set(['joy', 'happy', 'happiness', 'calm', 'content', 'contentment', 'hopeful', 'hope', 'grateful', 'gratitude', 'relieved', 'relief', 'proud', 'pride', 'excited', 'neutral', 'peaceful', 'curious']);

export interface Mood { pose: Partial<Pose>; blinkScale: number; distressed: boolean; tone: AvatarTone }
/** Facial mood for an affect. null = no opinion (unknown emotion). */
export function moodFor(a: Affect | null): Mood | null {
  if (!a) return null;
  const e = a.emotion;
  if (HEAVY.has(e)) {
    if (a.intensity >= 4) return { pose: { smile: -0.15, brow: -0.7, lid: 0.22, tilt: 2, lookY: 0.6, blush: 0.05 }, blinkScale: 1.6, distressed: true, tone: 'concerned' };
    if (a.intensity === 3) return { pose: { smile: 0, brow: -0.45, lid: 0.12, tilt: 1.5 }, blinkScale: 1.25, distressed: true, tone: 'concerned' };
    return { pose: { smile: 0.1, brow: -0.25, lid: 0.06 }, blinkScale: 1.1, distressed: false, tone: 'warm' };
  }
  if (LIGHT.has(e)) return { pose: { smile: 0.5, brow: 0.12, blush: 0.2 }, blinkScale: 1, distressed: false, tone: 'warm' };
  return null;
}

/** Blends a mood over a pose (weight 0..1) and never lets the face smile broadly while the person is distressed. */
export function applyMood(pose: Pose, mood: Mood | null, weight = 1): Pose {
  if (!mood) return pose;
  const out = { ...pose };
  for (const k of Object.keys(mood.pose) as (keyof Pose)[]) out[k] = pose[k] + (mood.pose[k]! - pose[k]) * weight;
  if (mood.distressed) { out.smile = Math.min(out.smile, 0.1); out.sparkle = 0; out.joy = 0; out.blush = Math.min(out.blush, 0.15); }
  return out;
}

/** Seconds until the next blink: random, slower when the mood is heavy, a touch longer while listening. */
export function blinkGap(rand: number, scale = 1, listening = false): number { return (2 + clamp(rand, 0, 1) * 4) * scale * (listening ? 1.15 : 1); }

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** "Active listening" idle movement while the user speaks: a slow subtle nod every few seconds and small gaze shifts. `now` in seconds. */
export function listeningIdle(now: number): { nod: number; lookX: number; lookY: number } {
  const period = 5.3, ph = (now % period) / period;
  const nod = ph < 0.22 ? Math.sin((ph / 0.22) * Math.PI) * 1.6 : 0;
  const i = Math.floor(now / 3.1);
  return { nod, lookX: (hash(i) - 0.5) * 2.4, lookY: (hash(i + 99) - 0.5) * 1.2 };
}

// ------------------------------------------------------------------ call fillers ------------------------------------------------------------------

export type FillerKind = 'mm' | 'achha' | 'listening';
export const parseFiller = (m: unknown): FillerKind | null => {
  const k = (m as { kind?: unknown } | null)?.kind;
  return k === 'mm' || k === 'achha' || k === 'listening' ? k : null;
};
/** What a filler may do. Sound never plays when the last affect intensity is 4 or more; 'listening' is a visual nod only. */
export function fillerPolicy(kind: FillerKind, last: Affect | null): { nod: boolean; sound: boolean } {
  const heavy = !!last && last.intensity >= 4;
  return { nod: true, sound: kind !== 'listening' && !heavy };
}
type Lang = 'en' | 'bn' | 'hi' | 'ne';
export const FILLER_TEXT: Record<Lang, Record<'mm' | 'achha', string>> = {
  en: { mm: 'Mm.', achha: 'I see.' },
  bn: { mm: 'হুম।', achha: 'আচ্ছা।' },
  hi: { mm: 'हम्म।', achha: 'अच्छा।' },
  ne: { mm: 'हम्म।', achha: 'अँ, हो।' },
};
export const fillerText = (lang: string, kind: 'mm' | 'achha'): string => (FILLER_TEXT[lang as Lang] ?? FILLER_TEXT.en)[kind];
