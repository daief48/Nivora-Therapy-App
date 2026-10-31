/**
 * Post-processor for replies in spoken (VOICE / video call) sessions. The prompt already asks for at most three short
 * sentences; this enforces it when the model ignores that. It keeps whole sentences only (never cuts mid-sentence) and
 * never drops a closing question.
 */
export const SPOKEN_MAX_SENTENCES = 3;
export const SPOKEN_MAX_CHARS = 320;
/** Output-token cap for spoken replies (Bangla and Devanagari need many tokens per word, so this is generous for ~3 sentences). */
export const SPOKEN_MAX_TOKENS = 260;

const END = new Set(['.', '!', '?', '\u0964', '\u0965', '\u061f', '\uff1f', '\uff01', '\u3002']); // . ! ? । ॥ ؟ ？ ！ 。
const CLOSERS = new Set(['"', "'", '\u201d', '\u2019', ')', ']', '\u00bb']);
const isQuestion = (s: string) => /[?\u061f\uff1f]["'\u201d\u2019)\]\u00bb]*$/.test(s.trim());

/** Splits into sentences on . ! ? । ॥ ؟ and line breaks. A full stop inside a number or word ("3.5", "a.m") does not split. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    let buf = '';
    for (let i = 0; i < line.length; i++) {
      buf += line[i];
      if (!END.has(line[i]!)) continue;
      while (i + 1 < line.length && (END.has(line[i + 1]!) || CLOSERS.has(line[i + 1]!))) buf += line[++i];
      if (i + 1 >= line.length || /\s/.test(line[i + 1]!)) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

// Written-register openers that sound stiff when spoken ("Furthermore, ..."). Only removed at the start of a sentence.
const FILLER_OPENER = /^(?:furthermore|moreover|additionally|nevertheless|nonetheless|consequently|thus|hence|indeed|essentially|ultimately|in addition|it is important to note that|it is worth noting that|please note that)\s*,?\s+/i;
// A reply must never end on one of these (it would sound cut off).
const DANGLING = /(?:[,;:\u2013\u2014-]|\s(?:and|but|or|so|because|that|which|while|although|though|if|as|then|yet|with|to|of|and then|\u098F\u09AC\u0982|\u0995\u09BF\u09A8\u09CD\u09A4\u09C1|\u0986\u09B0|\u0985\u09A5\u09AC\u09BE|\u0995\u09BE\u09B0\u09A3|\u0914\u0930|\u0932\u0947\u0915\u093F\u0928|\u092A\u0930|\u092F\u093E|\u0915\u094D\u092F\u094B\u0902\u0915\u093F|\u0905\u0928\u093F|\u0924\u0930|\u092F\u0926\u093F))\s*$/iu;
const TERMINAL = /[.!?\u0964\u0965\u061f\uff1f\uff01\u3002\u2026]["'\u201d\u2019)\]\u00bb]*$/;

/** Spoken-form tidy-up: drops stiff written-register openers and never leaves a reply ending on a comma or a dangling conjunction. */
export function polishSpoken(text: string): string {
  const sentences = splitSentences(text.trim());
  if (sentences.length === 0) return text.trim();
  const out = sentences.map((s) => {
    const t = s.replace(FILLER_OPENER, '');
    return t === s || !t ? s : t.charAt(0).toUpperCase() + t.slice(1);
  });
  let last = out[out.length - 1]!;
  if (!TERMINAL.test(last) && DANGLING.test(last)) {
    for (let i = 0; i < 3 && DANGLING.test(last); i++) last = last.replace(DANGLING, '');
    last = last.trimEnd();
    if (last && !TERMINAL.test(last)) last += /[ऀ-ॿঀ-৿]/.test(last) ? '।' : '.';
    out[out.length - 1] = last;
  }
  const joined = out.filter(Boolean).join(' ');
  return out.every((o, i) => o === sentences[i]) ? text.trim() : joined; // nothing to fix: keep the original spacing
}

export function shortenForSpeech(text: string, opts: { maxSentences?: number; maxChars?: number } = {}): string {
  return polishSpoken(shortenSentences(text, opts));
}

function shortenSentences(text: string, opts: { maxSentences?: number; maxChars?: number }): string {
  const maxS = opts.maxSentences ?? SPOKEN_MAX_SENTENCES, maxC = opts.maxChars ?? SPOKEN_MAX_CHARS;
  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) return trimmed;
  if (sentences.length <= maxS && trimmed.length <= maxC) return trimmed;

  const last = sentences[sentences.length - 1]!;
  const keepQuestion = sentences.length > 1 && isQuestion(last);
  const room = keepQuestion ? maxS - 1 : maxS; // front sentences allowed
  const budget = maxC - (keepQuestion ? last.length + 1 : 0);
  const kept: string[] = [];
  let used = 0;
  const frontCount = keepQuestion ? sentences.length - 1 : sentences.length;
  for (let i = 0; i < frontCount && kept.length < room; i++) {
    const s = sentences[i]!;
    const next = used + (kept.length ? 1 : 0) + s.length;
    if (kept.length >= 1 && next > budget) break;
    // keep the first one even when it alone is long: a complete sentence beats a cut one
    kept.push(s);
    used = next;
  }
  if (keepQuestion) kept.push(last);
  return kept.join(' ');
}
