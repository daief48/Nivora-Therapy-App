// Pure text helpers for the realtime relay: drop transcripts that are not the user speaking (silence hallucinations, fillers, the assistant's
// own voice coming back through the speaker) and decide how long to wait for the user to carry on. No I/O, language-agnostic where possible.

export type TranscriptClass = 'ok' | 'empty' | 'noise';

/** Lower-case word tokens (letters, combining marks, digits) of any script. */
export function tokens(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

const FILLERS = new Set([
  'um', 'umm', 'uh', 'uhh', 'uhm', 'hmm', 'hm', 'hmmm', 'mm', 'mmm', 'mhm', 'ah', 'aah', 'ahh', 'er', 'erm', 'eh', 'oh', 'huh',
  'আ', 'আহ', 'আহা', 'উম', 'উমম', 'হুম', 'হুমম', 'হুঁ', 'হ্যাম', 'হম',
  'हम्म', 'हम', 'हूं', 'हूँ', 'अं', 'अह', 'आह', 'उम', 'ऊं',
  'हम्', 'ह्म', 'उँ',
]);
const FILLER_SHAPE = /^(h?m{2,}|hm|u+h*m+|u+h+|a+h+|e+r+m*|o+h+|mhm+|e+h+)$/u;

// Typical hallucinations of speech models on silence / background music (matched on the normalised text).
const HALLUCINATIONS: RegExp[] = [
  /^(thank you|thanks) for (watching|listening|your attention)( this video)?$/,
  /^(please )?(like and )?subscribe( to (my|the) channel)?$/,
  /^see you (in the )?next (video|time)$/,
  /\b(subtitles?|captions?|transcribed|translated) by\b/,
  /\bamara org\b/,
  /^you$/,
  /^(দেখার জন্য ধন্যবাদ|দেখার জন্য আপনাকে ধন্যবাদ|সাবটাইটেল.*|সাবস্ক্রাইব.*|চ্যানেলটি সাবস্ক্রাইব.*)$/,
  /^(देखने के लिए धन्यवाद|वीडियो देखने के लिए धन्यवाद|सब्सक्राइब.*|सबटाइटल.*|उपशीर्षक.*)$/,
  /^(हेर्नु भएकोमा धन्यवाद|हेरेकोमा धन्यवाद|हेर्नुभएकोमा धन्यवाद|सब्सक्राइब.*|सबटाइटल.*)$/,
];

/** empty: nothing to say; noise: not speech from the user. Everything else is 'ok'. */
export function classifyTranscript(text: string): TranscriptClass {
  const raw = text.trim();
  if (!raw) return 'empty';
  const toks = tokens(raw);
  if (toks.length === 0) return /[♪♫♬🎵🎶]/u.test(raw) ? 'noise' : 'empty'; // only punctuation / symbols
  if (/[♪♫♬🎵🎶]/u.test(raw)) return 'noise';
  if (toks.every((t) => FILLERS.has(t) || FILLER_SHAPE.test(t))) return 'noise';
  const joined = toks.join(' ');
  if (HALLUCINATIONS.some((r) => r.test(joined))) return 'noise';
  // One character (or one short word) repeated: "aaaa", "ااا", "no no no no no no" is NOT noise, a long run of one letter is.
  if (/^(\p{L}\p{M}*)\1{3,}$/u.test(joined.replace(/\s+/g, ''))) return 'noise';
  return 'ok';
}

// ---- echo ----

export interface SpokenText { text: string; at: number; live: boolean }

const dice = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a); const sb = new Set(b);
  let hit = 0; for (const t of sa) if (sb.has(t)) hit++;
  return (2 * hit) / (sa.size + sb.size);
};

/** True when the transcript (near-)duplicates, or is a fragment of, text the assistant spoke in the last `windowMs` (or is still speaking). */
export function isEcho(transcript: string, spoken: SpokenText[], nowMs: number, windowMs = 12_000): boolean {
  const t = tokens(transcript);
  if (!t.length) return false;
  const recent = spoken.filter((s) => s.live || nowMs - s.at <= windowMs);
  if (!recent.length) return false;
  const tj = ` ${t.join(' ')} `;
  const corpusTokens = recent.flatMap((s) => tokens(s.text));
  const corpus = ` ${corpusTokens.join(' ')} `;
  if (t.length >= 3 && corpus.includes(tj)) return true; // a fragment of what was said
  // Short replies ("yes") only count when they equal a whole spoken chunk.
  if (t.length < 3) return recent.some((s) => ` ${tokens(s.text).join(' ')} ` === tj);
  const candidates = [...recent.map((s) => tokens(s.text)), corpusTokens];
  if (candidates.some((c) => dice(t, c) >= 0.7)) return true;
  // Speech models mis-hear a word or two of the assistant's voice: nearly every word is from the spoken text.
  const set = new Set(corpusTokens);
  const covered = t.filter((x) => set.has(x)).length / t.length;
  return t.length >= 5 && covered >= 0.9;
}

// ---- end of speech ----

export type ThoughtKind = 'complete' | 'open' | 'mid';

const CONTINUATION = new Set([
  'and', 'but', 'or', 'because', 'if', 'which', 'while', 'with', 'to', 'of', 'the', 'a', 'my',
  'কিন্তু', 'আর', 'এবং', 'তাই', 'কারণ', 'যে', 'যদি', 'তারপর',
  'और', 'लेकिन', 'क्योंकि', 'कि', 'अगर', 'फिर',
  'तर', 'र', 'अनि', 'किनभने', 'यदि',
]);

/** complete: ends a sentence or a question. mid: ends with a comma, ellipsis or a conjunction. open: no clear signal. */
export function thoughtKind(text: string): ThoughtKind {
  const s = text.trim();
  if (/(\.{2,}|…|[,;:\-–—،])\s*["'”’)\]]*$/u.test(s)) return 'mid';
  if (/[।॥.?!؟][\s"'”’)\]]*$/u.test(s)) return 'complete';
  const toks = tokens(s);
  const last = toks[toks.length - 1];
  if (last && CONTINUATION.has(last)) return 'mid';
  return 'open';
}

export const MAX_HOLD_MS = 1600;

/** Hold time after a final transcript: shortest for a finished sentence, longest when the speaker was probably mid-thought. */
export function holdDelay(text: string, baseMs: number, o: { completeMs?: number; openMs?: number; midMs?: number } = {}): number {
  if (baseMs <= 0) return 0;
  const cap = Math.max(baseMs, MAX_HOLD_MS);
  const k = thoughtKind(text);
  const ms = k === 'complete' ? (o.completeMs ?? baseMs) : k === 'mid' ? (o.midMs ?? baseMs * 2.5) : (o.openMs ?? baseMs * 1.5);
  return Math.max(0, Math.min(ms, cap));
}
