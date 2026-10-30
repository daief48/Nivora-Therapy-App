// Pure helpers that keep the live voice call honest and recoverable. Everything here is side-effect free (except keepAwake) and unit-tested.

export type CallPhase = 'listening' | 'thinking' | 'speaking';

// ------------------------------------------------------------------ pre-roll ring buffer ------------------------------------------------------------------

export interface RingBuffer {
  push(f: Float32Array): void;
  /** Everything kept, oldest first, and empties the buffer. */
  drain(): Float32Array;
  size(): number;
  clear(): void;
}
/** Keeps only the most recent `max` samples (about 600 ms of 24 kHz PCM) so the first words are not lost while the link is busy. */
export function createRingBuffer(max: number): RingBuffer {
  const buf = new Float32Array(max);
  let write = 0, len = 0;
  return {
    push(f) {
      if (f.length >= max) { buf.set(f.subarray(f.length - max)); write = 0; len = max; return; }
      for (let i = 0; i < f.length; i++) { buf[write] = f[i]!; write = (write + 1) % max; }
      len = Math.min(max, len + f.length);
    },
    drain() {
      const out = new Float32Array(len);
      const start = (write - len + max) % max;
      for (let i = 0; i < len; i++) out[i] = buf[(start + i) % max]!;
      write = 0; len = 0;
      return out;
    },
    size: () => len,
    clear() { write = 0; len = 0; },
  };
}
export const PREROLL_SAMPLES = Math.round(24000 * 0.6);

// ------------------------------------------------------------------ reconnect backoff ------------------------------------------------------------------

export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 4000] as const;
/** Delay before reconnect attempt `attempt` (0-based); null once the tries are used up and the turn-based path should take over. */
export function backoffDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < RECONNECT_DELAYS_MS.length ? RECONNECT_DELAYS_MS[attempt]! : null;
}
export const TOKEN_REFRESH_EVERY_MS = 10 * 60 * 1000;
export const isAuthErrorCode = (code: unknown): boolean => code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED';

// ------------------------------------------------------------------ phase reconciliation + watchdog ------------------------------------------------------------------

export const THINKING_LIMIT_MS = 25_000;
export const SPEAKING_STALL_MS = 8_000;

/** The server is the source of truth. The one exception: it says "listening" while the last sound is still draining here. */
export function reconcilePhase(server: CallPhase | string, local: { audioPlaying: boolean }): CallPhase {
  if (server === 'speaking') return 'speaking';
  if (server === 'thinking') return local.audioPlaying ? 'speaking' : 'thinking';
  return local.audioPlaying ? 'speaking' : 'listening';
}

export interface WatchdogInput {
  phase: CallPhase;
  now: number;
  /** When the UI entered the current phase. */
  phaseSince: number;
  /** Last time an audio frame arrived or was played (0 = never). */
  lastAudioAt: number;
  /** When assistant_done arrived for the current reply (0 = not yet). */
  doneAt: number;
  playing: boolean;
}
/** 'recover' = go back to listening, tell the server to stop, show the soft hint. */
export function watchdogDecision(i: WatchdogInput): 'ok' | 'recover' {
  if (i.phase === 'thinking') return i.now - i.phaseSince > THINKING_LIMIT_MS ? 'recover' : 'ok';
  if (i.phase === 'speaking' && !i.playing && i.doneAt) {
    return i.now - Math.max(i.doneAt, i.lastAudioAt) > SPEAKING_STALL_MS ? 'recover' : 'ok';
  }
  return 'ok';
}

// ------------------------------------------------------------------ loudness for the avatar mouth ------------------------------------------------------------------

/** Root-mean-square of an AnalyserNode time-domain byte buffer (128 = silence), 0..1. */
export function rmsOfBytes(b: ArrayLike<number>): number {
  if (!b.length) return 0;
  let s = 0;
  for (let i = 0; i < b.length; i++) { const v = (b[i]! - 128) / 128; s += v * v; }
  return Math.sqrt(s / b.length);
}
/** Quick attack, slower release, scaled so normal speech reaches ~0.6-1. */
export function smoothEnergy(prev: number, rms: number): number {
  const target = Math.max(0, Math.min(1, rms * 4));
  const k = target > prev ? 0.6 : 0.25;
  const v = prev + (target - prev) * k;
  return v < 0.02 ? 0 : v;
}

// ------------------------------------------------------------------ misc heuristics ------------------------------------------------------------------

/** Device labels (only readable after mic permission) that suggest headphones, earbuds or a headset. */
export function looksLikeHeadset(labels: string[]): boolean {
  return labels.some((l) => /head(set|phone)|earphone|earbud|airpod|buds|bluetooth|hands-?free|wired/i.test(l));
}
export const LONG_CALL_SECS = 30 * 60;
export const ECHO_FRAMES_FOR_HINT = 2;
/** One-time headphones hint: echo was reported by the server, or (web) no headset was detected. */
export function shouldShowEchoHint(i: { alreadyShown: boolean; echoFrames: number; headset: boolean | null }): boolean {
  if (i.alreadyShown) return false;
  return i.echoFrames >= ECHO_FRAMES_FOR_HINT || i.headset === false;
}

/** Keeps the screen awake during a call. Silently does nothing where unsupported (web, tests). */
export function setKeepAwake(on: boolean): void {
  try {
    const k = require('expo-keep-awake');
    const p = on ? k.activateKeepAwakeAsync?.('nivora-call') : k.deactivateKeepAwake?.('nivora-call');
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* not available */ }
}
