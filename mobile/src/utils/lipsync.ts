/**
 * Mouth-openness signal (0..1 over time) for the animated avatar.
 *
 * Two sources, both purely local and both only about the SOUND OF THE AI'S OWN VOICE / its reply text:
 *  (a) amplitude: a numeric energy value (0..1) pushed in while audio plays (`pushEnergy`);
 *  (b) text fallback: syllable-like movements timed from the spoken text (`planSpeech`), so it works with no audio metering.
 * It is an animation hint, not phoneme-accurate lip-sync. It never looks at the user (no camera, no face, no voice analysis).
 * All the maths is in small pure functions so it is unit-tested; `createLipSync` just wires them to a clock.
 */

export interface Syllable { open: number; round: boolean }
export interface Beat { t0: number; t1: number; open: number; round: boolean }
export interface SpeechPlan { beats: Beat[]; duration: number }
export type Viseme = 'closed' | 'slight' | 'open' | 'wide' | 'oo';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------- syllables --------------------------------------------------------------
const LATIN_OPEN: Record<string, Syllable> = {
  a: { open: 1, round: false }, e: { open: 0.6, round: false }, i: { open: 0.4, round: false },
  o: { open: 0.75, round: true }, u: { open: 0.55, round: true }, y: { open: 0.4, round: false },
};
const R = (open: number, round = false): Syllable => ({ open, round });
// Bangla (U+098x..) and Devanagari (U+090x..): independent vowels and vowel signs (matras) by code point.
const INDEP: Record<number, Syllable> = {
  0x985: R(0.7), 0x986: R(1), 0x987: R(0.4), 0x988: R(0.4), 0x989: R(0.55, true), 0x98a: R(0.55, true), 0x98f: R(0.6), 0x990: R(0.7), 0x993: R(0.75, true), 0x994: R(0.75, true),
  0x905: R(0.7), 0x906: R(1), 0x907: R(0.4), 0x908: R(0.4), 0x909: R(0.55, true), 0x90a: R(0.55, true), 0x90f: R(0.6), 0x910: R(0.7), 0x913: R(0.75, true), 0x914: R(0.75, true),
};
const MATRA: Record<number, Syllable> = {
  0x9be: R(1), 0x9bf: R(0.4), 0x9c0: R(0.4), 0x9c1: R(0.55, true), 0x9c2: R(0.55, true), 0x9c3: R(0.4), 0x9c7: R(0.6), 0x9c8: R(0.7), 0x9cb: R(0.75, true), 0x9cc: R(0.75, true),
  0x93e: R(1), 0x93f: R(0.4), 0x940: R(0.4), 0x941: R(0.55, true), 0x942: R(0.55, true), 0x947: R(0.6), 0x948: R(0.7), 0x94b: R(0.75, true), 0x94c: R(0.75, true),
};
const INHERENT = R(0.7);
const isConsonant = (c: number) => (c >= 0x995 && c <= 0x9b9) || (c >= 0x9dc && c <= 0x9df) || (c >= 0x915 && c <= 0x939) || (c >= 0x958 && c <= 0x95f);
const isVirama = (c: number) => c === 0x9cd || c === 0x94d;

/** Syllable-like mouth targets for one word. Latin: vowel groups. Bangla/Devanagari: one per consonant cluster or independent vowel. */
export function syllablesOf(word: string): Syllable[] {
  const out: Syllable[] = [];
  const chars = Array.from(word.toLowerCase());
  let latin = '';
  const flushLatin = () => {
    if (!latin) return;
    let groups: string[] = latin.match(/[aeiouy]+/g) ?? [];
    if (groups.length > 1 && /[^aeiouy]e$/.test(latin) && !/le$/.test(latin)) groups = groups.slice(0, -1); // silent final "e"
    for (const g of groups) out.push(g.length > 1 && /^(oo|ou|ew|ue)/.test(g) ? R(0.55, true) : LATIN_OPEN[g[0]] ?? R(0.6));
    if (!groups.length && /[a-z]/.test(latin) && latin.length > 1) out.push(R(0.35)); // "hmm", "shh"
    latin = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0) ?? 0;
    if (c < 0x900 || c > 0x9ff) { if (/[a-z]/.test(chars[i])) latin += chars[i]; else flushLatin(); continue; }
    flushLatin();
    if (INDEP[c]) out.push(INDEP[c]);
    else if (isConsonant(c)) {
      if (isVirama(chars[i + 1]?.codePointAt(0) ?? 0)) { i++; continue; } // conjunct: joins the next consonant
      out.push(INHERENT);
    } else if (MATRA[c] && out.length) out[out.length - 1] = MATRA[c]; // a vowel sign replaces the inherent vowel of its consonant
  }
  flushLatin();
  return out;
}

// ------------------------------------------------------------- timing ----------------------------------------------------------------
const SYLLABLE_S = 0.19; // seconds per syllable at rate 1 (about 5 syllables a second, a calm counsellor pace)
const WORD_GAP_S = 0.05;
const SOFT_PAUSE_S = 0.2;  // , ; : –
const HARD_PAUSE_S = 0.42; // . ! ? । …

/** Pause after a token from its trailing punctuation. */
export function pauseAfter(token: string): number {
  if (/[.!?।॥…]+["')\]]*$/.test(token)) return HARD_PAUSE_S;
  if (/[,;:–—،]["')\]]*$/.test(token)) return SOFT_PAUSE_S;
  return 0;
}

/** Times syllable-like mouth movements for a spoken text. `rate` ~ the TTS rate (1 = normal). */
export function planSpeech(text: string, rate = 1): SpeechPlan {
  const sylS = SYLLABLE_S / Math.max(0.4, Math.min(2.5, rate));
  const beats: Beat[] = [];
  let t = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    for (const s of syllablesOf(token)) { beats.push({ t0: t, t1: t + sylS, open: s.open, round: s.round }); t += sylS; }
    t += WORD_GAP_S + pauseAfter(token);
  }
  return { beats, duration: t };
}

/** Target openness at time `t` (seconds since the plan started). Each syllable is a smooth hump, closed between syllables and in pauses. */
export function openAt(plan: SpeechPlan, t: number): { open: number; round: boolean } {
  const b = plan.beats;
  let lo = 0, hi = b.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < b[mid].t0) hi = mid - 1; else if (t >= b[mid].t1) lo = mid + 1;
    else { const p = (t - b[mid].t0) / (b[mid].t1 - b[mid].t0); return { open: b[mid].open * Math.pow(Math.sin(Math.PI * p), 0.8), round: b[mid].round }; }
  }
  return { open: 0, round: false };
}

// ------------------------------------------------------------- smoothing -------------------------------------------------------------
/** Exponential smoothing with a fast attack (opening) and slower release (closing), independent of frame rate. */
export function smoothMouth(cur: number, target: number, dt: number, attack = 0.04, release = 0.1): number {
  const tau = target > cur ? attack : release;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return clamp01(cur + (target - cur) * k);
}

/** Shapes a raw 0..1 audio energy into mouth openness (gentle curve, small noise floor so silence stays closed). */
export function energyToOpen(e: number): number {
  const v = clamp01((e - 0.04) / 0.9);
  return clamp01(Math.pow(v, 0.7) * 1.05);
}

/** Which of the five mouth shapes a smoothed openness corresponds to. */
export function visemeFor(open: number, round: boolean): Viseme {
  if (open < 0.1) return 'closed';
  if (round && open > 0.2) return 'oo';
  if (open < 0.35) return 'slight';
  if (open < 0.7) return 'open';
  return 'wide';
}

/** Random gap before the next blink, 2..6 seconds. `rand` is a 0..1 random number (injectable for tests). */
export const nextBlinkDelay = (rand: number = Math.random()) => 2 + clamp01(rand) * 4;

// ------------------------------------------------------------- controller ------------------------------------------------------------
export interface LipFrame { mouth: number; round: boolean; source: 'energy' | 'text' | 'none' }
const ENERGY_FRESH_S = 0.25;

/** Small stateful wrapper around the pure functions. `now` is seconds from any monotonic clock. */
export function createLipSync() {
  let plan: SpeechPlan | null = null;
  let start = 0, energy = 0, energyAt = -1e9, mouth = 0, last: number | null = null;
  return {
    /** Start text-driven movement for a reply that has just begun to be spoken. */
    speakText(text: string, now: number, rate = 1) { plan = text.trim() ? planSpeech(text, rate) : null; start = now; },
    /** Push the latest audio energy (0..1). Takes priority over the text plan while values keep arriving. */
    pushEnergy(value: number, now: number) { energy = clamp01(value); energyAt = now; },
    reset() { plan = null; energyAt = -1e9; mouth = 0; last = null; },
    step(now: number): LipFrame {
      const dt = last === null ? 0.05 : Math.min(0.25, Math.max(0, now - last));
      last = now;
      const t = now - start;
      const textNow = plan && t >= 0 && t < plan.duration ? openAt(plan, t) : null;
      let target = 0, round = false, source: LipFrame['source'] = 'none';
      if (now - energyAt < ENERGY_FRESH_S) { target = energyToOpen(energy); round = !!textNow?.round; source = 'energy'; }
      else if (plan) { target = textNow?.open ?? 0; round = textNow?.round ?? false; source = 'text'; }
      mouth = smoothMouth(mouth, target, dt);
      return { mouth, round, source };
    },
  };
}
