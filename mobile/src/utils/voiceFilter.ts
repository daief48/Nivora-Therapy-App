// Pure helpers that decide whether a transcript is worth acting on. The app's crisis detection reads the transcript, so these are
// deliberately conservative: they only drop empty text, lone fillers, punctuation, known silence hallucinations and the assistant's own
// voice coming back through the speaker. Anything else (even one real word such as "help" or "no") always passes.

/** Lowercased words, letters/marks/digits only. Works for Latin, Bangla and Devanagari (marks are kept so words stay intact). */
export function normWords(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

const FILLERS = new Set([
  'um', 'umm', 'uh', 'uhh', 'uhm', 'hmm', 'hm', 'hmmm', 'mm', 'mmm', 'ah', 'aah', 'er', 'erm', 'huh', 'eh', 'oh',
  'আ', 'আঁ', 'আঁআঁ', 'উম', 'উমম', 'হুম', 'হুমম', 'আহ', 'হম্ম', 'হ্যাঁ', 'এ', 'অ',
  'हम्म', 'हम', 'हूं', 'हूँ', 'उम', 'आ', 'अं', 'अह', 'आह',
]);
// "হ্যাঁ" (yes) is a real answer, never a filler.
FILLERS.delete('হ্যাঁ');

/** Phrases speech models invent from silence or music (normalised: lowercase, no punctuation). Matched as whole-text or as the start/end. */
const HALLUCINATIONS = [
  'thank you for watching', 'thanks for watching', 'thank you for watching this video', 'thanks for watching this video',
  'please subscribe', 'please like and subscribe', 'subscribe to my channel', 'subtitles by', 'subtitles by the amara org community',
  'subtitled by', 'amara org', 'transcribed by', 'see you in the next video', 'thank you so much for watching',
  'ধন্যবাদ ভিডিওটি দেখার জন্য', 'দেখার জন্য ধন্যবাদ', 'ভিডিওটি দেখার জন্য ধন্যবাদ', 'সাবস্ক্রাইব করুন', 'চ্যানেলটি সাবস্ক্রাইব করুন', 'পরবর্তী ভিডিওতে দেখা হবে',
  'देखने के लिए धन्यवाद', 'वीडियो देखने के लिए धन्यवाद', 'सब्सक्राइब करें', 'चैनल को सब्सक्राइब करें', 'अगले वीडियो में मिलते हैं',
  'हेर्नुभएकोमा धन्यवाद', 'हेरेकोमा धन्यवाद', 'च्यानल सब्सक्राइब गर्नुहोस्',
  // The transcription prompt leaking into the text for silent clips (Bangla / Devanagari conversation hints).
  'এটি বাংলা ভাষায় একটি কথোপকথন', 'এটি একটি বাংলা কথোপকথন', 'यह हिंदी में बातचीत है', 'यो नेपाली भाषामा कुराकानी हो',
];
const HALL_NORM = HALLUCINATIONS.map((h) => normWords(h).join(' '));

const MUSIC = /[♪♫♬♩🎵🎶]/u;

export type RejectReason = 'empty' | 'punctuation' | 'filler' | 'hallucination' | 'repeated';

/** Why a transcript should be thrown away, or null if it should be used. */
export function transcriptRejection(text: string): RejectReason | null {
  const raw = (text ?? '').trim();
  if (!raw) return 'empty';
  if (MUSIC.test(raw)) return 'hallucination';
  const words = normWords(raw);
  if (words.length === 0) return 'punctuation';
  if (words.every((w) => FILLERS.has(w))) return 'filler'; // "um", "hmm hmm", "উম"
  const joined = words.join(' ');
  for (const h of HALL_NORM) {
    if (joined === h || (h.length >= 12 && (joined.startsWith(h + ' ') || joined.endsWith(' ' + h)) && words.length <= h.split(' ').length + 2)) return 'hallucination';
  }
  const compact = joined.replace(/\s+/g, '');
  if (compact.length >= 4 && new Set([...compact]).size === 1) return 'repeated'; // "aaaa", "...."
  // one word repeated many times ("you you you you") is a classic silence artefact; two or three repeats can be real emphasis
  if (words.length >= 4 && new Set(words).size === 1 && !['no', 'না', 'नहीं', 'help'].includes(words[0]!)) return 'repeated';
  return null;
}
export const isGarbageTranscript = (text: string) => transcriptRejection(text) !== null;

// ------------------------------------------------------------------ echo similarity ------------------------------------------------------------------

const trigrams = (words: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  const s = ` ${words.join(' ')} `;
  for (let i = 0; i + 3 <= s.length; i++) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
};

export interface Similarity {
  /** Dice coefficient of the word sets (symmetric, 0..1). */
  dice: number;
  /** Share of the HEARD words that appear in the reference (0..1). */
  containment: number;
  /** Share of the heard text's character trigrams found in the reference: robust to recogniser spelling/inflection differences and to scripts without clear word spacing. */
  trigram: number;
}

/** Language-agnostic similarity between what the recogniser heard and a reference text (the assistant's words). */
export function textSimilarity(heard: string, reference: string): Similarity {
  const h = normWords(heard), r = normWords(reference);
  if (!h.length || !r.length) return { dice: 0, containment: 0, trigram: 0 };
  const hs = new Set(h), rs = new Set(r);
  let common = 0;
  for (const w of hs) if (rs.has(w)) common++;
  const dice = (2 * common) / (hs.size + rs.size);
  const containment = h.filter((w) => rs.has(w)).length / h.length;
  const ht = trigrams(h), rt = trigrams(r);
  let inter = 0, tot = 0;
  for (const [g, n] of ht) { tot += n; inter += Math.min(n, rt.get(g) ?? 0); }
  return { dice, containment, trigram: tot ? inter / tot : 0 };
}

/** True when `heard` is (mostly) a repeat of `reference`. Requires `minWords` heard words so a lone "okay" is never called an echo by this alone. */
export function looksLikeEcho(heard: string, reference: string, minWords = 2): boolean {
  if (normWords(heard).length < minWords) return false;
  const s = textSimilarity(heard, reference);
  return s.containment >= 0.7 || s.trigram >= 0.78 || s.dice >= 0.75;
}

// ------------------------------------------------------------------ barge-in gate (device recogniser, assistant speaking) ------------------------------------------------------------------

export interface BargeInInput {
  text: string;
  /** 0..1 as reported by the recogniser; 0 / undefined / -1 mean "not provided". */
  confidence?: number;
  /** Milliseconds since the first result of this monitoring session (a sustained voice, not a click). */
  sinceFirstMs: number;
  /** The assistant's text currently/recently being spoken. */
  spoken: string;
  suppressEcho?: boolean;
}

/**
 * Whether speech noticed while the assistant is talking is a real interruption. Stricter than a normal turn because the speaker feeds the
 * assistant's own voice back into the microphone: needs real words, some confidence (when the platform gives one), a short sustained
 * duration, and must not read like the assistant's own text.
 */
export function isRealBargeIn(i: BargeInInput): boolean {
  const words = normWords(i.text);
  if (words.length === 0 || transcriptRejection(i.text)) return false;
  if (i.suppressEcho === false) return words.length >= 1;
  const conf = typeof i.confidence === 'number' && i.confidence > 0 ? i.confidence : null;
  if (conf !== null && conf < 0.45) return false;
  if (words.length < 2 && i.sinceFirstMs < 400) return false;
  if (words.length < 3 && i.sinceFirstMs < 250) return false;
  if (looksLikeEcho(i.text, i.spoken)) return false;
  return true;
}

/** Should a finished cloud transcript be discarded because it is just the assistant's recent words? Stricter (needs 4 words and high overlap): a real user repeating one short phrase must still get through. */
export function isCloudEcho(transcript: string, assistantText: string): boolean {
  if (!assistantText.trim() || normWords(transcript).length < 4) return false;
  const s = textSimilarity(transcript, assistantText);
  return s.containment >= 0.85 && s.trigram >= 0.8;
}
