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
      /আত্মহত্যা/, /আত্মঘাতী/, /মরে যেতে চাই/, /মরতে চাই/, /বাঁচতে চাই না/, /বাঁচতে ইচ্ছে করে না/, /বাঁচতে ইচ্ছা করে না/,
      /নিজেকে শেষ/, /নিজেকে মেরে ফেল/, /জীবন শেষ করে/, /আমি না থাকলেই ভাল/, /বেঁচে থাকার কোন মানে নেই/, /বেঁচে থাকার কোনো মানে নেই/,
      /\batmohott?ya\b/, /\bmorte chai\b/, /\bmere felte chai\b/, /\bbachte chai na\b/, /\bbachte ichche kore na\b/,
      /\bnijeke shesh\b/, /\bnijeke mere\b/, /\bsuicide korbo\b/, /\bmore jete chai\b/, /\bjibon shesh\b/,
    ],
  },
  {
    category: 'SELF_HARM', severity: 'HIGH',
    patterns: [
      /\bhurt(ing)? myself\b/, /\bcut(ting)? myself\b/, /\bharm(ing)? myself\b/, /\bself[- ]?harm\b/, /\boverdos(e|ing)\b/,
      /নিজেকে কষ্ট দিতে চাই/, /নিজেকে আঘাত/, /নিজেকে কেটে/, /হাত কেটে/,
      /\bnijeke kosto dite chai\b/, /\bnijeke ghat\b/, /\bhat kat(te|bo)\b/,
    ],
  },
  {
    category: 'VIOLENCE', severity: 'HIGH',
    patterns: [
      /\b(kill|hurt|harm|stab|shoot) (him|her|them|someone|my (wife|husband|mother|father|boss|child|kids?))\b/,
      /\bwant to kill (him|her|them|someone|everyone)\b/, /\bgoing to (kill|hurt|stab|shoot)\b/,
      /খুন করব/, /মেরে ফেলব/, /মেরে ফেলতে চাই/, /\bmere felbo\b/, /\bkhun korbo\b/,
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
    ],
  },
];

// Intent plus means/time => imminent. Applied only if a HIGH rule already matched.
const IMMINENT_MARKERS: RegExp[] = [
  /\b(tonight|right now|today|in a few minutes|after this message|about to|going to do it|already (took|taken|cut))\b/,
  /\b(pills?|rope|knife|blade|gun|bridge|poison|noose)\b/, /\bhave (a )?(plan|method)\b/, /\bgoodbye (letter|note)\b/, /\bsay goodbye\b/,
  /আজ রাতে/, /এখনই/, /এখন/, /ঘুমের ওষুধ/, /ওষুধ খেয়ে/, /ছুরি/, /দড়ি/, /বিষ/, /ছাদ থেকে/, /বিদায়/,
  /\bekhoni\b/, /\baj raate\b/, /\bghumer oshudh\b/, /\bdori\b/, /\bchuri\b/, /\bbish\b/,
];

const NEGATION = /\b(not|never|don'?t|doesn'?t|no longer|isn'?t|aren'?t|wasn'?t)\b[^.!?]{0,20}$/;

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export function assess(text: string): SafetyAssessment {
  const t = normalize(text);
  let severity: Severity = 'NONE';
  const categories = new Set<SafetyCategory>();
  let highMatched = false;
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = p.exec(t);
      if (!m) continue;
      let sev = rule.severity;
      // Negated mention ("I'm not suicidal"): downgrade by one level but never ignore (conservative).
      if (sev === 'HIGH' && NEGATION.test(t.slice(Math.max(0, m.index - 24), m.index))) sev = 'ELEVATED';
      categories.add(rule.category);
      severity = maxSev(severity, sev);
      if (sev === 'HIGH') highMatched = true;
      break;
    }
  }
  if (highMatched && IMMINENT_MARKERS.some((p) => p.test(t))) severity = 'IMMINENT';
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
const DIAGNOSIS = /\byou (have|are suffering from|are diagnosed with|suffer from) (clinical )?(depression|bipolar|schizophrenia|ptsd|bpd|adhd|anxiety disorder|ocd)\b/i;

export function checkOutput(text: string): { ok: boolean; reason?: 'UNSAFE' | 'FALSE_CLAIM' | 'DIAGNOSIS' } {
  if (UNSAFE_OUTPUT.some((p) => p.test(text))) return { ok: false, reason: 'UNSAFE' };
  if (FALSE_CLAIMS.some((p) => p.test(text))) return { ok: false, reason: 'FALSE_CLAIM' };
  if (DIAGNOSIS.test(text)) return { ok: false, reason: 'DIAGNOSIS' };
  return { ok: true };
}

// ---- Resources ----
export interface ResourceView {
  countryCode: string; resourceType: string; name: string; contactDetails: string;
  language: string; verified: boolean; lastVerifiedAt: string | null;
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
  }));
}

// ---- Crisis response text ----
export type Lang = 'en' | 'bn' | 'mixed';
const hasBangla = (s: string) => /[ঀ-৿]/.test(s);
export function pickLang(sessionLang: string, userText: string): Lang {
  if (sessionLang === 'bn' || sessionLang === 'en') return sessionLang;
  return hasBangla(userText) ? 'bn' : 'mixed';
}

function resourceLines(resources: ResourceView[], lang: 'en' | 'bn'): string {
  if (resources.length === 0) {
    return lang === 'bn'
      ? 'আপনার দেশ জানালে আমি সংশ্লিষ্ট সহায়তার তথ্য দেখাতে পারব। এখনই আপনার এলাকার জরুরি সেবার নম্বরে কল করুন।'
      : 'If you tell me your country I can show local support options. Please contact your local emergency number right now.';
  }
  const note = lang === 'bn' ? '(নম্বরটি ব্যবহারের আগে নিশ্চিত করে নিন)' : '(please double-check this number locally)';
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
  if (lang === 'en') return en();
  if (lang === 'bn') return bn();
  return `${bn()}\n\n—\n\n${en()}`;
}

/** Short supportive footer appended to normal AI replies when risk is only ELEVATED. */
export function elevatedFooter(lang: Lang, resources: ResourceView[]): string {
  const en = `If things feel unsafe or overwhelming, please contact your local emergency number or someone you trust.${resources.length ? '\n' + resourceLines(resources, 'en') : ''}`;
  const bn = `যদি পরিস্থিতি অনিরাপদ বা অসহনীয় মনে হয়, দয়া করে আপনার এলাকার জরুরি নম্বরে বা কোনো বিশ্বস্ত মানুষের সাথে যোগাযোগ করুন।${resources.length ? '\n' + resourceLines(resources, 'bn') : ''}`;
  return lang === 'en' ? en : lang === 'bn' ? bn : `${bn}\n${en}`;
}

export const UNSAFE_OUTPUT_FALLBACK: Record<Lang, string> = {
  en: 'I want to be careful here. I am an AI and may not be the right support for this. Would you like to talk about how you are feeling right now, or reach out to someone you trust or a professional?',
  bn: 'এখানে আমি সতর্ক থাকতে চাই। আমি একটি AI, তাই এই বিষয়ে হয়তো সঠিক সহায়তা দিতে পারব না। আপনি কি এখন কেমন অনুভব করছেন তা নিয়ে কথা বলতে চান, নাকি বিশ্বস্ত কারও বা বিশেষজ্ঞের সাথে যোগাযোগ করতে চান?',
  mixed: 'এখানে আমি সতর্ক থাকতে চাই — I am an AI and may not be the right support for this. আপনি কি এখন কেমন অনুভব করছেন সেটা নিয়ে কথা বলতে চান? Or would you rather reach out to someone you trust?',
};
