// Pure, testable voice-activity logic for the cloud recorder (no React, no native modules).
import { endOfSpeechMs } from './speech';

export const POLL_MS = 120;
/** Audio kept before the first loud sample, so soft word onsets ("I...", "ম...") that the level meter misses are still inside the clip. */
export const PRE_ROLL_MS = 600;
export const DEFAULT_MIN_SPEECH_MS = 350;
/** Even the loudest sample of a clip must reach this level (dBFS) or the clip is treated as room noise. */
export const MIN_PEAK_DB = -42;

/**
 * Fixed-size window of recent meter levels: the "pre-roll". The recorder keeps recording from the moment the turn opens (so the audio
 * itself is never missing the first words); this window tells us where speech really began so a clip's lead-in can be reasoned about.
 */
export class PreRoll {
  private levels: { t: number; db: number }[] = [];
  constructor(private readonly keepMs = PRE_ROLL_MS) {}
  push(t: number, db: number) {
    this.levels.push({ t, db });
    while (this.levels.length && t - this.levels[0]!.t > this.keepMs) this.levels.shift();
  }
  get size() { return this.levels.length; }
  /** Earliest time still held (the clip start that includes the pre-roll). */
  get startsAt() { return this.levels.length ? this.levels[0]!.t : 0; }
  clear() { this.levels = []; }
}

export interface GateSummary {
  /** Total time the level was above the speech threshold. */
  speechMs: number;
  /** Time of the first loud sample minus the pre-roll (never < 0): where a trimmed clip would start. */
  trimStartMs: number;
  /** Time of the last loud sample plus a short tail: where a trimmed clip would end. */
  trimEndMs: number;
  peakDb: number;
  /** Number of meter samples seen (0 = the platform gives no metering: the gate cannot judge, so it never discards). */
  samples: number;
}

/**
 * Voice-activity decision from recorder metering. Learns the room's background level from the first few samples, then calls a sample
 * "voice" when it is clearly above that floor (and above an absolute minimum).
 */
export class SpeechGate {
  private floor = 0;
  private seen = 0;
  private voiceMs = 0;
  private first = -1;
  private last = -1;
  private peak = -160;
  private roll = new PreRoll();
  constructor(private readonly pollMs = POLL_MS, private readonly learn = 4) {}

  /** Feed one metering sample at `t` ms since the recording began. Returns true if this sample counts as voice. */
  feed(t: number, db: number): boolean {
    if (!(typeof db === 'number') || db <= -159) return false;
    this.seen += 1;
    this.roll.push(t, db);
    if (this.seen <= this.learn) { this.floor = this.seen === 1 ? db : Math.min(this.floor, db); return false; }
    this.peak = Math.max(this.peak, db);
    const loud = db > Math.max(-45, this.floor + 12);
    if (loud) { this.voiceMs += this.pollMs; if (this.first < 0) this.first = t; this.last = t; }
    return loud;
  }
  get speechMs() { return this.voiceMs; }
  get lastVoiceAt() { return this.last; }
  get samples() { return this.seen; }
  summary(preRollMs = PRE_ROLL_MS, tailMs = 300): GateSummary {
    return {
      speechMs: this.voiceMs,
      trimStartMs: this.first < 0 ? 0 : Math.max(0, this.first - preRollMs),
      trimEndMs: this.last < 0 ? 0 : this.last + tailMs,
      peakDb: this.peak, samples: this.seen,
    };
  }
}

/**
 * Should the clip be uploaded? Silent, too-short or very quiet clips are discarded BEFORE upload (saves cost, and speech models invent
 * text from silence). With no metering at all we cannot judge, so we upload (never risk dropping a real word).
 */
export function shouldUploadClip(s: GateSummary, minSpeechMs = DEFAULT_MIN_SPEECH_MS, minPeakDb = MIN_PEAK_DB): boolean {
  if (s.samples === 0) return true;
  return s.speechMs >= minSpeechMs && s.peakDb >= minPeakDb;
}

// ------------------------------------------------------------------ adaptive end of speech ------------------------------------------------------------------

/** Words that, when they are the LAST thing said, usually mean the speaker is not finished (en, bn, hi, ne). */
const CONTINUATION = new Set([
  'and', 'but', 'because', 'so', 'or', 'then', 'that', 'which', 'if', 'when', 'while', 'like', 'um', 'uh', 'hmm', 'well', 'to', 'of', 'the', 'a', 'i', 'my', 'is', 'am', 'was', 'with', 'for', 'about',
  'আর', 'এবং', 'কিন্তু', 'কারণ', 'তাই', 'যে', 'যদি', 'তবে', 'তখন', 'মানে', 'আমার', 'আমি', 'এই', 'সেই', 'আসলে', 'উম', 'হুম',
  'और', 'लेकिन', 'क्योंकि', 'तो', 'या', 'कि', 'अगर', 'जब', 'मेरा', 'मैं', 'मतलब', 'हम्म',
  'र', 'तर', 'किनभने', 'त्यसैले', 'भने', 'मेरो', 'म', 'अनि',
]);
const TERMINAL = /[.!?।॥…]["')\]]*\s*$/u;
const TRAILING_OPEN = /(?:[,;:\-–—،]|\.\.\.|…)\s*$/u;

export type Finish = 'finished' | 'open' | 'unknown';

/** Does the (partial) text sound finished, or mid-thought? Platforms usually give no punctuation, so the last word is the main hint. */
export function sentenceFinish(text: string | undefined): Finish {
  const t = (text ?? '').trim();
  if (!t) return 'unknown';
  if (TRAILING_OPEN.test(t)) return 'open';
  if (TERMINAL.test(t)) return 'finished';
  const words = t.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const lastWord = words[words.length - 1];
  if (lastWord && CONTINUATION.has(lastWord)) return 'open';
  return 'unknown';
}

/**
 * Silence (ms) that ends the user's turn. Default range 700-1300 ms: shorter after a finished-sounding sentence, longer when the last words
 * suggest more is coming; otherwise the length-based endOfSpeechMs().
 */
export function adaptiveEndOfSpeechMs(speechMs: number, partialText?: string, range: { min: number; max: number } = { min: 700, max: 1300 }): number {
  const base = endOfSpeechMs(speechMs);
  const f = sentenceFinish(partialText);
  const v = f === 'finished' ? Math.round(base * 0.8) : f === 'open' ? Math.round(base * 1.3) : base;
  return Math.min(range.max, Math.max(range.min, v));
}
