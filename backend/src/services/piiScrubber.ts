/**
 * Conservative de-identification of free text before it can ever be shared for quality review.
 * Principle: when unsure, mask. Sentence structure is kept so an excerpt stays readable ("I called [phone] last night").
 * Detection runs on a copy where Bangla / Devanagari / Arabic-Indic digits are mapped 1:1 to ASCII, so every
 * pattern works the same in every script and indices line up with the original text.
 */
export interface ScrubResult { text: string; redactions: number }
export interface ScrubOptions { names?: (string | null | undefined)[] }

const DIGIT_BASES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0xff10];
/** Same length as the input; only digit code points change. */
export function asciiDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const base = DIGIT_BASES.find((b) => cp >= b && cp <= b + 9);
    out += base === undefined ? ch : String(cp - base);
  }
  return out;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const TLD = '(?:com|net|org|edu|gov|io|app|dev|info|biz|xyz|bd|np|uk|pk|lk)';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Spec { re: RegExp; label: string; group?: number; test?: (m: RegExpMatchArray) => boolean }
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

// Order matters: earlier specs claim a span first.
const SPECS: Spec[] = [
  { re: /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, label: 'email' },
  { re: /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')]+/gi, label: 'link' },
  { re: new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${TLD}\\b(?:\\/[^\\s<>"')]*)?`, 'gi'), label: 'link' },
  { re: /(?<![\w@])@[A-Za-z0-9_.]{2,30}/g, label: 'handle' },
  // dates of birth
  { re: new RegExp(`\\b(?:born|dob|d\\.o\\.b\\.?|date of birth|birth ?date|birthday)\\b[^.!?\\n]{0,40}?(?:\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{4}[/.-]\\d{1,2}[/.-]\\d{1,2}\\b|\\b(?:19|20)\\d{2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\w*|${MONTH}\\w*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?)`, 'gi'), label: 'dob' },
  { re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)?\d{2}\b/g, label: 'date' },
  { re: /\b(?:19|20)\d{2}[/.-]\d{1,2}[/.-]\d{1,2}\b/g, label: 'date' },
  { re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+(?:19|20)?\\d{2}\\b`, 'gi'), label: 'date' },
  { re: new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`, 'gi'), label: 'date' },
  // addresses
  { re: /\b(?:house|flat|apt|apartment|holding|plot|road|block|sector|section|ward|floor)\s*(?:no\.?|number|#|:)?\s*[\w/-]*\d[\w/-]*(?:,?\s*(?:road|block|sector|section|lane|ward)\s*(?:no\.?|number|#)?\s*[\w/-]+)*/gi, label: 'address' },
  { re: /\b\d{1,5}[A-Za-z]?(?:\/\d+)?,?\s+(?:[A-Za-z][\w']*\s+){0,3}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|sarani|para|gali|nagar|colony)\b\.?/gi, label: 'address' },
  { re: /(?:বাসা|বাড়ি|রোড|ব্লক|সড়ক|ফ্ল্যাট|সেক্টর|ওয়ার্ড|मकान|घर|गली|सड़क|वार्ड|घर नं|मार्ग)\s*(?:নং|নম্বর|नं|नंबर|#)?\s*\d+(?:[/-]\d+)?[A-Za-z]?/gu, label: 'address' },
  { re: /\b(?:zip|zip ?code|postcode|post code|postal(?: code)?|pin(?: ?code)?)\b\s*[:#-]?\s*\d{4,6}\b/gi, label: 'address' },
  // phones / ids / cards: any run of 7+ digits (with separators) or 6+ digits in a row
  { re: /(?<![\w])\+?\(?\d[\d\s().-]{5,}\d/g, label: 'number', test: (m) => digitCount(m[0]) >= 7 },
  { re: /\d{6,}/g, label: 'number' },
  // self-introductions
  { re: /\b(?:my name is|my name's|i am called|i'm called)\s+(\p{L}[\p{L}'-]+)/giu, label: 'name', group: 1 },
  { re: /\b[Mm]y name is \p{Lu}?\p{L}+ (\p{Lu}\p{Ll}+)/gu, label: 'name', group: 1 },
  { re: /\b(?:call me|name's)\s+(\p{L}[\p{L}'-]+)/giu, label: 'name', group: 1, test: (m) => m[1]![0] === m[1]![0]!.toUpperCase() && m[1]![0] !== m[1]![0]!.toLowerCase() },
  { re: /(?:আমার নাম|मेरा नाम|मेरो नाम)\s+(?:হলো\s+|হচ্ছে\s+)?([^\s,.।!?]{2,30})/gu, label: 'name', group: 1 },
];

interface Range { s: number; e: number; label: string }

function nameRanges(m: string, names: string[]): Range[] {
  const out: Range[] = [];
  for (const n of names) {
    const ascii = /^[\x20-\x7e]+$/.test(n);
    const re = ascii
      ? new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'giu')
      : new RegExp(esc(n), 'gu'); // inflected scripts (Bangla/Devanagari): suffixes attach to the name
    for (const x of m.matchAll(re)) out.push({ s: x.index!, e: x.index! + x[0].length, label: 'name' });
  }
  return out;
}

function nameTokens(names: (string | null | undefined)[] | undefined): string[] {
  const set = new Set<string>();
  for (const raw of names ?? []) {
    const n = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (n.length < 2) continue;
    set.add(n);
    for (const part of n.split(' ')) if (part.length >= 2) set.add(part);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

export function scrub(text: string, opts: ScrubOptions = {}): ScrubResult {
  if (!text) return { text: '', redactions: 0 };
  const m = asciiDigits(text);
  const claimed: Range[] = [];
  const free = (s: number, e: number) => !claimed.some((r) => s < r.e && e > r.s);
  const claim = (r: Range) => { if (r.e > r.s && free(r.s, r.e)) claimed.push(r); };

  for (const spec of SPECS) {
    const re = new RegExp(spec.re.source, spec.re.flags.includes('d') ? spec.re.flags : spec.re.flags + 'd');
    for (const x of m.matchAll(re)) {
      if (spec.test && !spec.test(x)) continue;
      if (spec.group) {
        const ix = (x as RegExpMatchArray & { indices?: [number, number][] }).indices?.[spec.group];
        if (ix) claim({ s: ix[0], e: ix[1], label: spec.label });
      } else claim({ s: x.index!, e: x.index! + x[0].length, label: spec.label });
    }
  }
  for (const r of nameRanges(m, nameTokens(opts.names))) claim(r);

  claimed.sort((a, b) => a.s - b.s);
  let out = '';
  let pos = 0;
  for (const r of claimed) { out += text.slice(pos, r.s) + `[${r.label}]`; pos = r.e; }
  out += text.slice(pos);
  return { text: out, redactions: claimed.length };
}
