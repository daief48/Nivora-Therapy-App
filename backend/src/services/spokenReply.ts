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

export function shortenForSpeech(text: string, opts: { maxSentences?: number; maxChars?: number } = {}): string {
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
