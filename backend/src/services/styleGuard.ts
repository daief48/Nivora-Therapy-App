import { splitSentences } from './spokenReply.js';

/**
 * Deterministic check of a text-chat reply against the therapy style (no definitions, lists, lectures, stacked questions,
 * early advice). Only violation CODES are ever logged, never text. The patterns are heuristics: they only trigger one
 * corrective regeneration, never a block. Bangla / Hindi / Nepali patterns need native review.
 */
export type StyleViolation = 'DEFINITION' | 'LIST' | 'MULTI_QUESTION' | 'TOO_LONG' | 'FILLER' | 'EARLY_ADVICE';

export const MAX_TEXT_SENTENCES = 5;
/** Advice is held back until the person has been heard for this many earlier turns. */
export const ADVICE_AFTER_USER_TURNS = 2;

const SENT_START = '(?:^|[.!?\\u0964\\u0965]\\s+|\\n\\s*)';
const EN_SKIP = '(?!(?:that|this|it|there|here|what|which|who|he|she|you|your|i|we|they|my|our|his|her|their|the|a|an|so|and|but)\\b)';
const DEFINITION: RegExp[] = [
  // English: "Anxiety is a ...", "Burnout refers to ...", "X is defined as ..."
  new RegExp(`${SENT_START}${EN_SKIP}[a-z-]+(?:\\s[a-z-]+){0,2}\\s+(?:is|are)\\s+(?:a|an|the|when|defined|characterized|characterised|one of)\\b`, 'i'),
  /\b(?:refers to|is defined as|can be defined as|is known as|is a term)\b/i,
  // Bangla: "X হলো একটি ...", "বলতে ... বোঝায়", "এক ধরনের মানসিক ..."
  /[ঀ-৿]+(?:\s+[ঀ-৿]+){0,2}\s+(?:হলো|হল|হচ্ছে|হয়)\s+(?:একটি|একটা|এক ধরনের|এমন|সেই|যখন)/,
  /বলতে\s[^।?!]{0,40}বোঝায়/,
  /এক ধরনের\s+(?:মানসিক|অনুভূতি|অবস্থা|আবেগ)/,
  // Hindi: "X एक ... है", "... कहलाता है", "... के रूप में परिभाषित"
  new RegExp(`${SENT_START}(?!(?:यह|वह|ये|वो|मैं|आप|तुम|यही)\\s)[\\u0900-\\u097F]+(?:\\s[\\u0900-\\u097F]+){0,1}\\s+एक\\s[^।?!]{0,60}?\\s(?:है|होता है|होती है|हैं)`),
  /(?:कहलाता है|कहलाती है|के रूप में परिभाषित|को कहते हैं)/,
  // Nepali: "X एउटा ... हो", "भन्नाले ... बुझिन्छ"
  new RegExp(`${SENT_START}(?!(?:यो|त्यो|म|तपाईं|हामी)\\s)[\\u0900-\\u097F]+(?:\\s[\\u0900-\\u097F]+){0,1}\\s+एउटा\\s[^।?!]{0,60}?\\s(?:हो|हुन्)`),
  /भन्नाले\s[^।?!]{0,40}बुझिन्छ|भनेको\s[^।?!]{0,40}(?:अवस्था|भावना)\s+हो/,
];

const LIST = /(?:^|\n)\s*(?:[-*•]|\d{1,2}[.)]|[০-৯]+[.)।]|[०-९]+[.)।])\s+\S/;
// Inline enumerations ("1. ... 2. ...") that stay on one line.
const INLINE_LIST = /(?:^|\s)(?:1|১|१)[.)।]\s[^\n]{3,}?\s(?:2|২|२)[.)।]\s/;

const FILLER: RegExp[] = [
  new RegExp(`${SENT_START}(?:it'?s|it is)\\s+(?:so |really |very )?important\\b`, 'i'),
  /\b(?:remember that|remember,|here are (?:some|a few)|let me explain|let'?s break (?:this|it) down|you should|you must)\b/i,
  /গুরুত্বপূর্ণ হলো|মনে রাখবেন|মনে রাখুন|মনে রেখো|আপনার উচিত|আপনাকে.{0,20}করতেই হবে/,
  /महत्वपूर्ण है कि|महत्वपूर्ण यह है|याद रखें|याद रखिए|ध्यान रखें कि|आपको चाहिए कि/,
  /महत्त्वपूर्ण कुरा|सम्झनुहोस्|याद राख्नुहोस्|तपाईंले.{0,25}पर्छ/,
  /everything will be (?:fine|okay|ok|alright)|সব ঠিক হয়ে যাবে|সবকিছু ঠিক হয়ে যাবে|सब ठीक हो जाएगा|सब ठीक हुन्छ|सबै ठीक हुन्छ/i,
];

const ADVICE: RegExp[] = [
  /\b(?:you could try|try (?:a|an|some|the)|i suggest|i recommend|why don'?t you|have you tried|consider (?:\w+ing|a|an|the)|one thing you can do|a tip)\b/i,
  /চেষ্টা করুন|করে দেখুন|করে দেখতে পারেন|করতে পারেন|পরামর্শ|চেষ্টা করে দেখো/,
  /कोशिश करें|कोशिश कीजिए|आज़मा कर देखें|आजमाकर देखें|सलाह|कर सकते हैं/,
  /प्रयास गर्नुहोस्|कोसिस गर्नुहोस्|गर्न सक्नुहुन्छ|सुझाव/,
];

const QUESTION_MARKS = /[?؟？]/g;

/** Text inside quotation marks is the user's own words being echoed; its question marks do not count as extra questions. */
const QUOTED = /[“"«「][^”"»」]{0,240}[”"»」]/g;

/** True when the user's message directly asks something (what is X / why / what should I do), so a short plain answer is wanted. */
export function userAskedDirectly(userText: string): boolean {
  const t = userText.trim();
  return /[?؟？]/.test(t) || /(\bwhat is\b|\bwhat's\b|\bwhy\b|\bhow (?:do|can|should)\b|\bexplain\b|\bwhat should i\b|\bis (?:it|that) normal\b|কী করব|কেন|বুঝিয়ে|কি করব|কি রোগ|क्यों|समझा|क्या है|किन|के गर्नु|के हो)/i.test(t);
}

export function detectViolations(text: string, opts: { priorUserTurns?: number; userAsked?: boolean } = {}): StyleViolation[] {
  const out: StyleViolation[] = [];
  const t = text.trim();
  if (!t) return out;
  if (!opts.userAsked && DEFINITION.some((r) => r.test(t))) out.push('DEFINITION'); // a direct question earns a short plain answer
  if (LIST.test(t) || INLINE_LIST.test(t)) out.push('LIST');
  if ((t.replace(QUOTED, ' ').match(QUESTION_MARKS) ?? []).length > 1) out.push('MULTI_QUESTION');
  if (splitSentences(t).length > MAX_TEXT_SENTENCES) out.push('TOO_LONG');
  if (FILLER.some((r) => r.test(t))) out.push('FILLER');
  if (!opts.userAsked && (opts.priorUserTurns ?? 99) < ADVICE_AFTER_USER_TURNS && ADVICE.some((r) => r.test(t))) out.push('EARLY_ADVICE');
  return out;
}

/** Private note appended to the system prompt for the single corrective regeneration. */
export function correctiveNote(violations: StyleViolation[]): string {
  const why: Record<StyleViolation, string> = {
    DEFINITION: 'it explained or defined a concept',
    LIST: 'it used a list or bullets',
    MULTI_QUESTION: 'it asked more than one question',
    TOO_LONG: 'it was too long',
    FILLER: 'it lectured or used filler such as "it is important" or "remember that"',
    EARLY_ADVICE: 'it gave advice before the feeling was heard',
  };
  return `CORRECTION (private, never mention it): your previous draft was rejected because ${violations.map((v) => why[v]).join('; ')}. Write it again: 2-4 short sentences of plain talk, name the feeling in the person's own words, validate it, then at most ONE open question. No definitions, no lists, no tips, no advice, no "it is important", no "remember that".`;
}
