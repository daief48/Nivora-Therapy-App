/**
 * Rule-based crisis safety layer. It deliberately does NOT depend on the language model.
 *
 * LIMITATIONS (must be reviewed by qualified clinicians before public launch):
 *  - Keyword/phrase matching is fallible: it has false negatives (indirect, metaphorical, misspelled or
 *    unseen-dialect phrasing) and false positives (e.g. negated or quoted statements).
 *  - It is intentionally conservative: ambiguity and internal errors resolve to a HIGHER severity.
 *  - The phrase lists below are a starting point, not a clinically validated instrument.
 */
import type { Db } from '../config/database.js';
import { lexiconSignals } from './lexiconMatch.js';

export type Severity = 'NONE' | 'ELEVATED' | 'HIGH' | 'IMMINENT';
export type SafetyCategory = 'SUICIDE' | 'SELF_HARM' | 'VIOLENCE' | 'ABUSE' | 'HOPELESSNESS' | 'CLASSIFIER_ERROR';
export interface SafetyAssessment { severity: Severity; categories: SafetyCategory[] }

const RANK: Record<Severity, number> = { NONE: 0, ELEVATED: 1, HIGH: 2, IMMINENT: 3 };
const maxSev = (a: Severity, b: Severity) => (RANK[a] >= RANK[b] ? a : b);

interface Rule { category: SafetyCategory; severity: Severity; patterns: RegExp[] }

// English + Bangla script + romanized Bangla ("Banglish"). Bangla script has no \b, so plain substrings are used.
const RULES: Rule[] = [
  {
    category: 'SUICIDE', severity: 'HIGH',
    patterns: [
      /\bsuicid(e|al)\b/, /\bkill(ing)? myself\b/, /\bend(ing)? my (own )?life\b/,/\bwant(ed)? to die\b/,
      /\bwish i (was|were) dead\b/, /\bbetter off (dead|without me)\b/, /\bdon'?t want to (live|be alive|wake up)\b/,
      /\bno reason to live\b/, /\btake my own life\b/, /\bend it all\b/,
      // passive ideation and means/lethality questions (found by the eval harness)
      /\bnot worth living\b/, /\bwant(ed)? to (disappear|vanish)\b/, /\bwish i (could )?(disappear|never (woke|existed|was born|been born))\b/,
      /\bdon'?t want to exist\b/, /\bhow (many|much) (pills|tablets|meds)\b[^.?!]{0,50}\b(die|dead|kill|overdose|fatal|lethal)\b/,
      /\bhow (can|do|would|should) i (die|kill myself|end it)\b/, /\b(lethal|fatal) (dose|amount)\b/,
      /আত্মহত্যা/, /আত্মঘাতী/, /মরে যেতে চাই/, /মরতে চাই/, /বাঁচতে চাই না/, /বাঁচতে ইচ্ছে করে না/, /বাঁচতে ইচ্ছা করে না/,
      /নিজেকে শেষ/, /নিজেকে মেরে ফেল/, /জীবন শেষ করে/, /আমি না থাকলেই ভাল/, /বেঁচে থাকার কোন মানে নেই/, /বেঁচে থাকার কোনো মানে নেই/,
      /\batmohott?ya\b/, /\bmorte chai\b/, /\bmere felte chai\b/, /\bbachte chai na\b/, /\bbachte ichche kore na\b/,
      /\bnijeke shesh\b/, /\bnijeke mere\b/, /\bsuicide korbo\b/, /\bmore jete chai\b/, /\bjibon shesh\b/,
      // Hindi / Nepali (Devanagari). Conservative starting list; needs review by native-speaking clinicians.
      /जीना नहीं है/, /मुझे मर जाना/, /मर जाऊँ/, /मर जाऊं/, /मरने का मन/, /जीने की इच्छा नहीं/, /जीने का कोई मतलब नहीं/,
      /मर्न मन छ/, /मलाई मर्न/, /मर्ने मन/, /बाँच्न मन लाग्दैन/, /बाच्न मन लाग्दैन/, /बाँच्नुको कुनै अर्थ छैन/, /जीवन समाप्त/,
      /आत्महत्या/, /आत्मघात/, /मरना चाहत/, /मर जाना चाहत/, /जीना नहीं चाहत/, /जीने का मन नहीं/, /जीने की इच्छा नहीं/, /खुद को (खत्म|ख़त्म|मार)/,
      /अपनी जान (दे|ले)/, /मर्न चाहन्छु/, /मर्न मन लाग्छ/, /बाँच्न मन छैन/, /बाच्न मन छैन/, /बाँच्न चाहन्न/, /आफूलाई (सिध्या|मार)/, /ज्यान दिन/,
    ],
  },
  {
    category: 'SELF_HARM', severity: 'HIGH',
    patterns: [
      /\bhurt(ing)? myself\b/, /\bcut(ting)? myself\b/, /\bharm(ing)? myself\b/, /\bself[- ]?harm\b/, /\boverdos(e|ing)\b/,
      /নিজেকে কষ্ট দিতে চাই/, /নিজেকে আঘাত/, /নিজেকে কেটে/, /হাত কেটে/,
      /\bnijeke kosto dite chai\b/, /\bnijeke ghat\b/, /\bhat kat(te|bo)\b/,
      /खुद को (चोट|नुकसान)/, /नस काट/, /आफूलाई (चोट|हानि)/,
    ],
  },
  {
    category: 'VIOLENCE', severity: 'HIGH',
    patterns: [
      /\b(kill|hurt|harm|stab|shoot) (him|her|them|someone|my (wife|husband|mother|father|boss|child|kids?))\b/,
      /\bwant to kill (him|her|them|someone|everyone)\b/, /\bgoing to (kill|hurt|stab|shoot)\b/,
      /খুন করব/, /মেরে ফেলব/, /মেরে ফেলতে চাই/, /\bmere felbo\b/, /\bkhun korbo\b/,
      /मार डालूँगा/, /मार डालूंगा/, /जान से मार/, /मार्ने छु/,
    ],
  },
  {
    category: 'ABUSE', severity: 'ELEVATED',
    patterns: [
      /\b(beats?|hits?|hitting|beating|abus(es|ed|ing)) me\b/, /\bi('| a)?m being (abused|beaten|hit)\b/, /\bdomestic violence\b/,
      /\bsexual(ly)? (abused|assaulted)\b/, /\braped?\b/, /\bunsafe at home\b/, /\bafraid (of|for) my (life|safety)\b/,
      /আমাকে মারধর/, /আমাকে মারে/, /নির্যাতন/, /ধর্ষণ/, /বাসায় নিরাপদ না/,
      /\bamake mare\b/, /\bamake marto\b/, /\bnirjaton\b/, /\bdhorshon\b/,
    ],
  },
  {
    category: 'HOPELESSNESS', severity: 'ELEVATED',
    patterns: [
      /\bhopeless\b/, /\bno way out\b/, /\bcan'?t go on\b/, /\bcan'?t take (it|this) anymore\b/, /\bgive up on (life|everything)\b/,
      /\bno one would (care|notice|miss me)\b/, /\bburden to (everyone|everybody|my family)\b/,
      /আশা নেই/, /আর পারছি না/, /সব শেষ/, /কেউ খেয়াল করবে না/, /\bar parchi na\b/, /\bsob shesh\b/, /\basha nei\b/,
      /कोई उम्मीद नहीं/, /अब और नहीं सह/, /सब खत्म/, /आशा छैन/, /सहन सक्दिन/, /सबै सकियो/,
    ],
  },
];

// Near-miss variants: spellings and splits that speech recognition and keyboards commonly produce for the highest-risk phrases.
// Deliberately conservative (bias to over-triggering): a clear variant is HIGH, a vague one is ELEVATED, never silently NONE.
// Hindi / Nepali / Bangla variants need review by native-speaking clinicians. Matched against the ZWNJ/nukta-folded text too.
const VARIANT_RULES: Rule[] = [
  {
    category: 'SUICIDE', severity: 'HIGH',
    patterns: [
      /\bkill(ing|ed)? (my|me|mi) (self|selves)\b(?!-| (doubt|esteem|care|worth|image|confidence|criticism|sabotage|talk|love|pity|conscious|help|improvement))/, /\bkill(ing)? mai?self\b/, /\bwann?a die\b/, /\bwant(ed)? too die\b/,
      /\b(want|wanna|wants|going|gonna|ready|thinking|think(ing)?) (to |of |about )?(commit(ting)? )?(sue|sew|soo) ?(side|cide)\b/, /\b(commit|committing) (sue|sew) ?(side|cide)\b/,
      /\b(do not|dont|don't) wann?a (live|be alive|wake up|exist)\b/, /\bdo not want to (live|be alive|wake up|exist)\b/,
      /\bhang(ing)? (my|me) ?self\b/,
      // Bangla script variants (hasanta / spacing / chandrabindu / common ASR confusions)
      /আত্?ম\s?হো?ত্?য/, /আত্মহনন/, /অা?ত্মহত্যা/, /আত্ম\s?ঘাত/,
      /মর(তে|ে যেতে)\s?(চাই|চাইছি|চাচ্ছি)/, /মর(তে|ে যেতে)\s?(ইচ্ছ[ে]?|ইচ্ছা)\s?(করে|করছে|হয়)/, /মোরতে\s?চাই/,
      /বাঁ?চতে\s?(চাই|ইচ্ছ[ে]?|ইচ্ছা)\s?(না|করে না|করছে না)/, /বেঁ?চে\s?থাকতে\s?(চাই|ইচ্ছ[ে]?|ইচ্ছা)\s?(না|করে না)/,
      // Hindi / Nepali (Devanagari) variants
      /आत्?म\s?ा?\s?हत्?य/, /आत्?म\s?घात/, /मर\s?जाने\s?का\s?मन/, /मरने\s?की\s?इच्छा/, /मर\s?जाना\s?चाह/, /मरना\s?चाह/,
      /जीना\s?नही/, /जीने\s?का\s?मन\s?नही/, /जिंदा\s?नही[ं]?\s?रहना/, /मर्न\s?(मन|चाह)/, /मर्नु\s?(पर्छ|पर्ने|मन)/, /बाँ?च्न\s?मन\s?(छैन|लाग्दैन)/, /बाँ?च्न\s?चाहन्न/,
    ],
  },
  {
    category: 'SELF_HARM', severity: 'HIGH',
    patterns: [/\b(hurt|hurting|harm|harming|cut|cutting) (my|me|mi) ?(self|selves)\b(?!-| (doubt|esteem|care|worth|image|confidence|criticism|sabotage|talk|love|pity|conscious|help|improvement))/, /হাত\s?কেট/, /नस\s?कट/],
  },
  // Vague near misses: ELEVATED only ("মরে যাই" is also an idiom for embarrassment and "ছাত্রজীবন শেষ" is a normal sentence, so neither reaches HIGH).
  { category: 'SUICIDE', severity: 'ELEVATED', patterns: [/\bsue ?(side|cide)\b/, /মরে\s?যাই/, /জীবন\s?শেষ/, /জিবন\s?শেষ/] },
];

// Intent plus means/time => imminent. Applied only if a HIGH rule already matched.
const IMMINENT_MARKERS: RegExp[] = [
  /\b(tonight|right now|today|in a few minutes|after this message|about to|going to do it|already (took|taken|cut))\b/,
  /\b(pills?|rope|knife|blade|gun|bridge|poison|noose)\b/, /\bhave (a )?(plan|method)\b/, /\bgoodbye (letter|note)\b/, /\bsay goodbye\b/,
  /আজ রাতে/, /এখনই/, /এখন/, /ঘুমের ওষুধ/, /ওষুধ খেয়ে/, /ছুরি/, /দড়ি/, /বিষ/, /ছাদ থেকে/, /বিদায়/,
  /\bekhoni\b/, /\baj raate\b/, /\bghumer oshudh\b/, /\bdori\b/, /\bchuri\b/, /\bbish\b/,
  /आज रात/, /अभी/, /अहिले/, /नींद की गोली/, /चाकू/, /रस्सी/, /जहर/, /विष/, /छुरी/, /अलविदा/, /बिदा/,
];

const NEGATION = /\b(not|never|don'?t|doesn'?t|no longer|isn'?t|aren'?t|wasn'?t)\b[^.!?]{0,20}$/;

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Removes zero-width joiners (ZWNJ/ZWJ) and the Devanagari nukta, which speech output and keyboards insert or drop inconsistently. */
const fold = (t: string) => t.replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\u093c/g, '');

/** The hand-written rules only (no lexicon). conversationService uses it to tell "the rules saw nothing" from "only the lexicon raised it". */
export function assessRules(text: string): SafetyAssessment {
  const t = fold(normalize(text));
  const raw = normalize(text);
  const variants = [t, ...(raw !== t ? [raw] : [])];
  let severity: Severity = 'NONE';
  const categories = new Set<SafetyCategory>();
  let highMatched = false;
  for (const rule of [...RULES, ...VARIANT_RULES]) {
    for (const p of rule.patterns) {
      let m: RegExpExecArray | null = null, src = t;
      for (const v of variants) { m = p.exec(v); if (m) { src = v; break; } }
      if (!m) continue;
      let sev = rule.severity;
      // Negated mention ("I'm not suicidal"): downgrade by one level but never ignore (conservative).
      if (sev === 'HIGH' && NEGATION.test(src.slice(Math.max(0, m.index - 24), m.index))) sev = 'ELEVATED';
      categories.add(rule.category);
      severity = maxSev(severity, sev);
      if (sev === 'HIGH') highMatched = true;
      break;
    }
  }
  if (highMatched && IMMINENT_MARKERS.some((p) => p.test(t))) severity = 'IMMINENT';
  return { severity, categories: [...categories] };
}

/**
 * Rules + draft lexicon. The lexicon (unreviewed, see data/lexicon.ts) can only RAISE the level: result = max(rules, lexicon).
 * Categories are unioned; the lexicon's ADDICTION has no SafetyCategory and is left out. A HIGH from the lexicon also takes
 * the normal IMMINENT promotion (intent plus time/means), exactly like a rule HIGH.
 */
export function assess(text: string): SafetyAssessment {
  const base = assessRules(text);
  const lex = lexiconSignals(text);
  if (RANK[lex.risk] === 0) return base;
  const categories = new Set<SafetyCategory>(base.categories);
  for (const c of lex.categories) if (c !== 'ADDICTION' && c !== 'NONE') categories.add(c);
  let severity = maxSev(base.severity, lex.risk);
  if (severity === 'HIGH' && base.severity !== 'HIGH' && IMMINENT_MARKERS.some((p) => p.test(fold(normalize(text))))) severity = 'IMMINENT';
  return { severity, categories: [...categories] };
}

/** Conservative wrapper: if classification itself fails, treat the message as ELEVATED, never as safe. */
export function assessSafely(text: string): SafetyAssessment {
  try {
    return assess(text);
  } catch {
    return { severity: 'ELEVATED', categories: ['CLASSIFIER_ERROR'] };
  }
}

// ---- Output checks (model replies) ----
const UNSAFE_OUTPUT: RegExp[] = [
  /\byou should (kill|hurt|harm) yourself\b/i, /\bhere('| i)?s how to (kill|hurt|harm) yourself\b/i,
  /\b(the best|an easy|a painless) (way|method) to (die|kill yourself|commit suicide)\b/i,
  /\byou (are|'re) (better off dead|a burden)\b/i, /\b(take|swallow) (\d+|all|the) (pills|tablets)\b/i,
  /\b(stop|quit) taking your (medication|medicine|meds)\b/i, /আত্মহত্যা করাই ভাল/, /মরে যাওয়াই ভাল/,
];
const FALSE_CLAIMS: RegExp[] = [
  /\bi('ve| have) (contacted|called|notified|alerted) (the )?(emergency|police|ambulance|a counsel|someone|your)/i,
  /\b(help|emergency services|someone) (is|are) on (the|their) way\b/i,
  /আমি (জরুরি|পুলিশ|অ্যাম্বুলেন্স).{0,12}(জানিয়েছি|খবর দিয়েছি)/,
];
// Also catches hedged forms ("you probably have", "sounds like you have an anxiety disorder"); only ever blocks more, never less.
const DIAGNOSIS = /\byou (probably |likely |may |might |definitely |clearly )?(have|are suffering from|are diagnosed with|suffer from) (an? )?(clinical )?(depression|bipolar|schizophrenia|ptsd|bpd|adhd|anxiety disorder|ocd)\b/i;

export function checkOutput(text: string): { ok: boolean; reason?: 'UNSAFE' | 'FALSE_CLAIM' | 'DIAGNOSIS' } {
  if (UNSAFE_OUTPUT.some((p) => p.test(text))) return { ok: false, reason: 'UNSAFE' };
  if (FALSE_CLAIMS.some((p) => p.test(text))) return { ok: false, reason: 'FALSE_CLAIM' };
  if (DIAGNOSIS.test(text)) return { ok: false, reason: 'DIAGNOSIS' };
  return { ok: true };
}

// ---- Extra honesty / medical guard for spoken (call) replies: nothing can be reviewed on screen before it is heard ----
const HUMAN_CLAIMS: RegExp[] = [
  /\bi('| a)?m (a |an |your )?(real |actual |living )?(human|person|human being)\b/i,
  /\bi am not (an |a )?(ai|robot|bot|machine|program)\b/i, /\bi('| a)?m not (an |a )?(ai|robot|bot|machine|program)\b/i,
  /\bi('| a)?m (a |an |your )?(licensed |qualified |certified |real |professional )*(doctor|physician|psychiatrist|psychologist|therapist|counsell?or|clinician|nurse)\b/i,
  /\bas your (doctor|psychiatrist|psychologist|therapist|physician)\b/i,
  // Bangla (no copula, so the negation "নই/না" and longer words such as "মানুষের" are excluded)
  /আমি (একজন |একটি |আসল |সত্যিকারের |সত্যিকার )*(মানুষ|মানব|ডাক্তার|চিকিৎসক|থেরাপিস্ট|মনোবিজ্ঞানী|মনোরোগ বিশেষজ্ঞ|কাউন্সেলর)(?![ঀ-৿])(?!\s*(নই|না|নয়))/,
  // Hindi
  /मैं (एक )?(असली |सच्चा |सच्ची )?(इंसान|इनसान|मनुष्य|आदमी|डॉक्टर|थेरेपिस्ट|मनोवैज्ञानिक|मनोचिकित्सक|काउंसलर) (हूँ|हूं)/,
  // Nepali
  /म (एक )?(साँचो |वास्तविक )?(मानिस|मान्छे|डाक्टर|थेरापिस्ट|मनोवैज्ञानिक|मनोचिकित्सक|परामर्शदाता) (हुँ|हूँ|हुं)/,
];
const MEDICATION_ADVICE: RegExp[] = [
  /\b(stop|quit|discontinue|skip|come off|go off|taper off|cut down on|reduce|lower|increase|double|raise) (taking )?(your|the|that|this|any|those) (medication|medicine|meds|pills|antidepressants?|tablets?|dose|dosage)\b/i,
  /\byou (can|could|should|may|might|need to|have to|must) (safely )?(stop|skip|reduce|lower|double|increase|take more|take less)\b[^.?!]{0,40}\b(medication|medicine|meds|pills|dose|dosage|antidepressants?|tablets?)\b/i,
  /\btake \d+(\.\d+)? ?(mg|milligrams?|mcg|ml|pills?|tablets?|capsules?)\b/i, /\b\d+(\.\d+)? ?(mg|mcg|milligrams?)\b/i,
  /\b(dose|dosage) (of|is|should be|would be)\b[^.?!]{0,30}\d/i,
  // Bangla
  /ওষুধ[^।.?!]{0,30}(বন্ধ করে|ছেড়ে দিন|ছেড়ে দাও|খাওয়া বন্ধ|কমিয়ে|বাড়িয়ে)/, /(ডোজ|মাত্রা)[^।.?!]{0,20}[0-9০-৯]/, /[0-9০-৯]+\s?(মিলিগ্রাম|এমজি)/,
  // Hindi
  /(दवा|दवाई|गोली)[^।.?!]{0,30}(बंद कर|छोड़ दे|कम कर|बढ़ा)/, /(खुराक|डोज़|डोज)[^।.?!]{0,20}[0-9०-९]/, /[0-9०-९]+\s?(मिलीग्राम|एमजी)/,
  // Nepali
  /(औषधि|औषधी|दबाई)[^।.?!]{0,30}(बन्द गर|छोड|घटाउ|बढाउ)/, /(मात्रा|डोज)[^।.?!]{0,20}[0-9०-९]/,
];
const NEGATED_BEFORE = /(\b(not|never|without|no)\b|n't)[^.!?]{0,25}$/i;

export type SpokenOutputReason = 'UNSAFE' | 'FALSE_CLAIM' | 'DIAGNOSIS' | 'HUMAN_CLAIM' | 'MEDICATION';
/**
 * checkOutput plus the extra guard for voice/video calls: blocks replies that claim to be human or a doctor/therapist,
 * or that give medication dosage / stop-taking advice (en, bn, hi, ne). A blocked reply is replaced by the safe fallback.
 */
export function checkSpokenOutput(text: string): { ok: boolean; reason?: SpokenOutputReason } {
  const base = checkOutput(text);
  if (!base.ok) return base;
  if (HUMAN_CLAIMS.some((p) => p.test(text))) return { ok: false, reason: 'HUMAN_CLAIM' };
  for (const p of MEDICATION_ADVICE) {
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g';
    for (const m of text.matchAll(new RegExp(p.source, flags))) {
      // "Please don't stop taking your medication without asking your doctor" is the right advice, not a violation.
      if (!NEGATED_BEFORE.test(text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0))) return { ok: false, reason: 'MEDICATION' };
    }
  }
  return { ok: true };
}

// ---- Resources ----
export interface ResourceView {
  countryCode: string; resourceType: string; name: string; contactDetails: string;
  language: string; verified: boolean; lastVerifiedAt: string | null; sourceUrl: string | null;
}

export async function getResources(db: Db, countryCode?: string | null): Promise<ResourceView[]> {
  if (!countryCode) return [];
  const rows = await db.supportResource.findMany({
    where: { countryCode: countryCode.toUpperCase() },
    orderBy: [{ resourceType: 'asc' }, { name: 'asc' }],
  });
  return rows.map((r) => ({
    countryCode: r.countryCode, resourceType: r.resourceType, name: r.name, contactDetails: r.contactDetails,
    language: r.language, verified: r.lastVerifiedAt !== null, lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    sourceUrl: r.lastVerifiedAt ? r.sourceUrl ?? null : null,
  }));
}

// ---- Crisis response text ----
export type Lang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed';
const hasBangla = (s: string) => /[ঀ-৿]/.test(s);
const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);
// Hindi and Nepali share Devanagari. Words that appear in one and (almost) never in the other tell them apart.
const NEPALI_WORDS = /(मलाई|तपाईं|तपाईँ|हुन्छ|हुन्थ्यो|छैन|लाग्दैन|लाग्छ|गर्नु|गर्छु|गर्दै|भएको|भइरहेको|छु|छौ|हो\b|भन्नु|सक्छु|सक्दिन|मेरो|हाम्रो|के गर्)|\bछ\b|\bछन्\b/g;
const HINDI_WORDS = /(मुझे|आपको|आपका|नहीं|क्या|कर रहा|कर रही|रहा है|रही है|\bहै\b|\bहैं\b|\bहूँ\b|\bहूं\b|मेरा|मेरी|सकता|सकती|चाहिए|बहुत|लेकिन)/g;
export function devanagariLang(text: string): 'hi' | 'ne' {
  const ne = (text.match(NEPALI_WORDS) ?? []).length, hi = (text.match(HINDI_WORDS) ?? []).length;
  return ne > hi ? 'ne' : 'hi';
}

/** The language of what the user just said or wrote, for sessions set to "same language as I speak". 'auto' = let the model decide (other scripts, Latin languages). */
export function spokenLang(userText: string, previous: readonly string[] = []): 'bn' | 'hi' | 'ne' | 'auto' {
  if (hasBangla(userText)) return 'bn';
  // Hindi vs Nepali is decided by distinguishing words only; with none, the language of the previous messages wins, then Hindi.
  if (hasDevanagari(userText)) return devanagariSignal(userText) ?? previousLang(previous, ['hi', 'ne']) ?? 'hi';
  // A very short Latin message ("yes", "okay", "thanks") carries no language: stay in the language the user was speaking.
  if (isShortLatin(userText)) return previousLang(previous, ['bn', 'hi', 'ne']) ?? 'auto';
  return 'auto';
}

function devanagariSignal(text: string): 'hi' | 'ne' | null {
  const ne = (text.match(NEPALI_WORDS) ?? []).length, hi = (text.match(HINDI_WORDS) ?? []).length;
  return ne > hi ? 'ne' : hi > ne ? 'hi' : null;
}
const isShortLatin = (s: string) => {
  const t = s.trim();
  return t.length > 0 && t.length <= 24 && t.split(/\s+/).length <= 3 && /\p{L}/u.test(t) && !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(t);
};
/** The language of the most recent previous user message that clearly had one (newest last in `previous`). A longer Latin message counts as "not that language". */
function previousLang(previous: readonly string[], allowed: ('bn' | 'hi' | 'ne')[]): 'bn' | 'hi' | 'ne' | null {
  for (let i = previous.length - 1; i >= 0; i--) {
    const p = previous[i] ?? '';
    const l = hasBangla(p) ? 'bn' : hasDevanagari(p) ? devanagariSignal(p) ?? undefined : isShortLatin(p) ? undefined : null;
    if (l === undefined) continue; // ambiguous (short Latin, Devanagari without distinguishing words): look further back
    if (l === null) return null; // clearly another language (a longer Latin message, another script): no stickiness
    return allowed.includes(l) ? l : null;
  }
  return null;
}

export function pickLang(sessionLang: string, userText: string, previous: readonly string[] = []): Lang {
  if (sessionLang === 'bn' || sessionLang === 'en' || sessionLang === 'hi' || sessionLang === 'ne') return sessionLang;
  if (sessionLang === 'auto') { const l = spokenLang(userText, previous); return l === 'auto' ? 'en' : l; } // 'same language as I speak': follow the words
  if (hasBangla(userText)) return 'bn';
  return hasDevanagari(userText) ? 'hi' : 'mixed'; // Hindi and Nepali share a script; Hindi is the safe default for an unlabelled session
}

function resourceLines(resources: ResourceView[], lang: 'en' | 'bn' | 'hi' | 'ne'): string {
  if (resources.length === 0) {
    return lang === 'bn'
      ? 'আপনার দেশ জানালে আমি সংশ্লিষ্ট সহায়তার তথ্য দেখাতে পারব। এখনই আপনার এলাকার জরুরি সেবার নম্বরে কল করুন।'
      : lang === 'hi'
        ? 'अगर आप अपना देश बताएँ, तो मैं वहाँ की मदद के विकल्प दिखा सकता हूँ। कृपया अभी अपने इलाक़े के आपातकालीन नंबर पर कॉल करें।'
        : lang === 'ne'
          ? 'तपाईंले आफ्नो देश बताउनुभयो भने म त्यहाँका सहयोगका विकल्प देखाउन सक्छु। कृपया अहिले नै आफ्नो क्षेत्रको आपतकालीन नम्बरमा फोन गर्नुहोस्।'
          : 'If you tell me your country I can show local support options. Please contact your local emergency number right now.';
  }
  const note = lang === 'bn' ? '(নম্বরটি ব্যবহারের আগে নিশ্চিত করে নিন)'
    : lang === 'hi' ? '(इस नंबर का उपयोग करने से पहले कृपया इसे पक्का कर लें)'
      : lang === 'ne' ? '(यो नम्बर प्रयोग गर्नुअघि कृपया पक्का गर्नुहोस्)'
        : '(please double-check this number locally)';
  return resources.map((r) => `• ${r.name}: ${r.contactDetails}${r.verified ? '' : ' ' + note}`).join('\n');
}

export function crisisMessage(severity: Severity, lang: Lang, resources: ResourceView[]): string {
  const en = () => {
    const head = severity === 'IMMINENT'
      ? 'I am really concerned about your safety right now. I am an AI and I cannot contact anyone for you, so please act now:'
      : 'Thank you for telling me. What you shared matters, and your safety comes first. I am an AI and cannot contact anyone for you, so please reach out:';
    return `${head}\n\n1. If you might act on these thoughts or are in danger, call your local emergency number now, or go to the nearest emergency room.\n2. If you can, stay with someone you trust, or message or call them right now.\n3. Move away from anything you could use to hurt yourself.\n\n${resourceLines(resources, 'en')}\n\nYou do not have to go through this alone. Are you safe at this moment?`;
  };
  const bn = () => {
    const head = severity === 'IMMINENT'
      ? 'আপনার নিরাপত্তা নিয়ে আমি সত্যিই চিন্তিত। আমি একটি AI, তাই আপনার হয়ে কারও সাথে যোগাযোগ করতে পারি না। দয়া করে এখনই এই পদক্ষেপগুলো নিন:'
      : 'আমাকে জানানোর জন্য ধন্যবাদ। আপনার নিরাপত্তাই সবার আগে। আমি একটি AI, তাই আপনার হয়ে কারও সাথে যোগাযোগ করতে পারি না, দয়া করে নিজে যোগাযোগ করুন:';
    return `${head}\n\n১. নিজের ক্ষতি করার ঝুঁকি থাকলে বা বিপদে থাকলে এখনই আপনার দেশের জরুরি নম্বরে কল করুন অথবা নিকটস্থ হাসপাতালের জরুরি বিভাগে যান।\n২. সম্ভব হলে বিশ্বস্ত কারও কাছে থাকুন, অথবা এখনই তাকে ফোন বা মেসেজ করুন।\n৩. নিজের ক্ষতি করা যায় এমন জিনিস থেকে দূরে সরে যান।\n\n${resourceLines(resources, 'bn')}\n\nআপনাকে একা এটা সামলাতে হবে না। এই মুহূর্তে আপনি কি নিরাপদ আছেন?`;
  };
  const hi = () => {
    const head = severity === 'IMMINENT'
      ? 'मुझे इस समय आपकी सुरक्षा की सचमुच चिंता है। मैं एक AI हूँ और आपके लिए किसी से संपर्क नहीं कर सकता, इसलिए कृपया अभी ये क़दम उठाएँ:'
      : 'मुझे बताने के लिए धन्यवाद। आपने जो कहा वह मायने रखता है, और आपकी सुरक्षा सबसे पहले है। मैं एक AI हूँ और आपके लिए किसी से संपर्क नहीं कर सकता, इसलिए कृपया ख़ुद संपर्क करें:';
    return `${head}\n\n1. अगर आप इन विचारों पर अमल कर सकते हैं या ख़तरे में हैं, तो अभी अपने इलाक़े के आपातकालीन नंबर पर कॉल करें, या नज़दीकी अस्पताल के इमरजेंसी विभाग में जाएँ।\n2. हो सके तो किसी भरोसेमंद व्यक्ति के पास रहें, या अभी उन्हें फ़ोन या संदेश करें।\n3. ख़ुद को नुक़सान पहुँचा सकने वाली किसी भी चीज़ से दूर हो जाएँ।\n\n${resourceLines(resources, 'hi')}\n\nआपको यह अकेले नहीं सहना है। क्या आप इस समय सुरक्षित हैं?`;
  };
  const ne = () => {
    const head = severity === 'IMMINENT'
      ? 'मलाई अहिले तपाईंको सुरक्षाको साँच्चै चिन्ता छ। म एक AI हुँ र तपाईंका लागि कसैलाई सम्पर्क गर्न सक्दिनँ, त्यसैले कृपया अहिले नै यी कदम चाल्नुहोस्:'
      : 'मलाई बताउनुभएकोमा धन्यवाद। तपाईंले भनेको कुरा महत्त्वपूर्ण छ, र तपाईंको सुरक्षा सबैभन्दा पहिले हो। म एक AI हुँ र तपाईंका लागि कसैलाई सम्पर्क गर्न सक्दिनँ, त्यसैले कृपया आफैँ सम्पर्क गर्नुहोस्:';
    return `${head}\n\n१. यी विचारअनुसार काम गर्न सक्ने अवस्थामा हुनुहुन्छ वा खतरामा हुनुहुन्छ भने, अहिले नै आफ्नो क्षेत्रको आपतकालीन नम्बरमा फोन गर्नुहोस्, वा नजिकको अस्पतालको आपतकालीन कक्षमा जानुहोस्।\n२. सकिन्छ भने कुनै विश्वासिलो मान्छेसँग बस्नुहोस्, वा अहिले नै उहाँलाई फोन वा सन्देश गर्नुहोस्।\n३. आफूलाई चोट पुर्‍याउन सकिने जुनसुकै चीजबाट टाढा हुनुहोस्।\n\n${resourceLines(resources, 'ne')}\n\nतपाईंले यो एक्लै सहनुपर्दैन। के तपाईं अहिले सुरक्षित हुनुहुन्छ?`;
  };
  if (lang === 'en') return en();
  if (lang === 'bn') return bn();
  if (lang === 'hi') return hi();
  if (lang === 'ne') return ne();
  return `${bn()}\n\n—\n\n${en()}`;
}

/** Short supportive footer appended to normal AI replies when risk is only ELEVATED. */
export function elevatedFooter(lang: Lang, resources: ResourceView[]): string {
  const en = `If things feel unsafe or overwhelming, please contact your local emergency number or someone you trust.${resources.length ? '\n' + resourceLines(resources, 'en') : ''}`;
  const bn = `যদি পরিস্থিতি অনিরাপদ বা অসহনীয় মনে হয়, দয়া করে আপনার এলাকার জরুরি নম্বরে বা কোনো বিশ্বস্ত মানুষের সাথে যোগাযোগ করুন।${resources.length ? '\n' + resourceLines(resources, 'bn') : ''}`;
  const hi = `अगर हालात असुरक्षित या असहनीय लगें, तो कृपया अपने इलाक़े के आपातकालीन नंबर पर या किसी भरोसेमंद व्यक्ति से संपर्क करें।${resources.length ? '\n' + resourceLines(resources, 'hi') : ''}`;
  const ne = `अवस्था असुरक्षित वा असहनीय लागेमा, कृपया आफ्नो क्षेत्रको आपतकालीन नम्बरमा वा कुनै विश्वासिलो मान्छेसँग सम्पर्क गर्नुहोस्।${resources.length ? '\n' + resourceLines(resources, 'ne') : ''}`;
  return lang === 'en' ? en : lang === 'bn' ? bn : lang === 'hi' ? hi : lang === 'ne' ? ne : `${bn}\n${en}`;
}

export const UNSAFE_OUTPUT_FALLBACK: Record<Lang, string> = {
  en: 'I want to be careful here. I am an AI and may not be the right support for this. Would you like to talk about how you are feeling right now, or reach out to someone you trust or a professional?',
  bn: 'এখানে আমি সতর্ক থাকতে চাই। আমি একটি AI, তাই এই বিষয়ে হয়তো সঠিক সহায়তা দিতে পারব না। আপনি কি এখন কেমন অনুভব করছেন তা নিয়ে কথা বলতে চান, নাকি বিশ্বস্ত কারও বা বিশেষজ্ঞের সাথে যোগাযোগ করতে চান?',
  hi: 'यहाँ मैं सावधान रहना चाहता हूँ। मैं एक AI हूँ और शायद इस मामले में सही सहारा न दे पाऊँ। क्या आप अभी जैसा महसूस कर रहे हैं उसके बारे में बात करना चाहेंगे, या किसी भरोसेमंद व्यक्ति या विशेषज्ञ से संपर्क करना चाहेंगे?',
  ne: 'यहाँ म सावधान रहन चाहन्छु। म एक AI हुँ र यस विषयमा सही सहयोग दिन नसक्न सक्छु। तपाईंलाई अहिले कस्तो लागिरहेको छ त्यसबारे कुरा गर्न चाहनुहुन्छ, वा कुनै विश्वासिलो मान्छे वा विशेषज्ञसँग सम्पर्क गर्न चाहनुहुन्छ?',
  mixed: 'এখানে আমি সতর্ক থাকতে চাই — I am an AI and may not be the right support for this. আপনি কি এখন কেমন অনুভব করছেন সেটা নিয়ে কথা বলতে চান? Or would you rather reach out to someone you trust?',
};
