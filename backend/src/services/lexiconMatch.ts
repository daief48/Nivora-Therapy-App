/**
 * Matches free text against the draft phrase lexicon (src/data/lexicon.ts). The lexicon is UNREVIEWED, so this module only ever
 * reports a level; safetyService uses it to RAISE the assessed level (max with the rule result), never to lower or replace it.
 * Pure, synchronous, no I/O.
 */
import { LEXICON, type LexiconCategory, type LexiconEmotion, type LexiconEntry, type LexiconRisk } from '../data/lexicon.js';

const RANK: Record<LexiconRisk, number> = { NONE: 0, ELEVATED: 1, HIGH: 2, IMMINENT: 3 };
const HAS_BANGLA = /[ঀ-৿]/;

/**
 * Normal form used for both phrases and messages: NFKC, lowercase, contractions unified ("can't", "cant", "cannot" => "can not";
 * "don't", "dont" => "do not"), zero-width and punctuation stripped, whitespace collapsed, repeated Latin letters collapsed
 * ("bhaloo", "pleaaase"), a few Bangla spelling pairs folded (short/long vowels, ষ/স/শ, ণ/ন, chandrabindu).
 * Folding is deliberately loose: it can only make a match more likely, and phrases are folded the same way.
 */
export function foldLexiconText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/\bcan[’']?t\b|\bcannot\b/g, 'can not')
    .replace(/\b(do|does|did|is|are|was|were|has|have|had|would|should|could)[’']?nt\b/g, '$1 not')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/([a-z])\1+/g, '$1').replace(/sh/g, 's') // "shesh"/"sesh", "shob"/"sob": Banglish s/sh is not standardised
    .replace(/[ীৗ]/g, 'ি').replace(/ূ/g, 'ু').replace(/[ষস]/g, 'শ').replace(/ণ/g, 'ন').replace(/[ঁঃ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

interface Compiled { entry: LexiconEntry; p: string; bangla: boolean }
const COMPILED: Compiled[] = LEXICON.map((entry) => {
  const p = foldLexiconText(entry.phrase);
  return { entry, p, bangla: HAS_BANGLA.test(p) };
}).filter((c) => c.p.length > 0);

interface Hit { entry: LexiconEntry; start: number; end: number }

/** Latin phrases must start and end on word boundaries; Bangla attaches suffixes to words, so plain substrings are used. */
function findAll(hay: string, c: Compiled): Hit[] {
  const out: Hit[] = [];
  for (let i = hay.indexOf(c.p); i !== -1; i = hay.indexOf(c.p, i + 1)) {
    const end = i + c.p.length;
    if (c.bangla || ((i === 0 || hay[i - 1] === ' ') && (end === hay.length || hay[end] === ' '))) out.push({ entry: c.entry, start: i, end });
  }
  return out;
}

export interface LexiconSignals {
  risk: LexiconRisk;
  categories: LexiconCategory[];
  emotions: LexiconEmotion[];
  /** Entries that matched and were not cancelled by a benign look-alike. */
  matched: LexiconEntry[];
  /** Benign look-alike entries that matched. */
  benign: LexiconEntry[];
}

export function lexiconSignals(text: string): LexiconSignals {
  const hay = foldLexiconText(text ?? '');
  const none: LexiconSignals = { risk: 'NONE', categories: [], emotions: [], matched: [], benign: [] };
  if (!hay) return none;
  const hits = COMPILED.flatMap((c) => findAll(hay, c));
  const benignHits = hits.filter((h) => h.entry.benign);
  // A risky match that overlaps a benign look-alike ("hasi te more jachhi") is cancelled; benign matches never lower anything else.
  const live = hits.filter((h) => !h.entry.benign && !benignHits.some((b) => h.start < b.end && b.start < h.end));
  let risk: LexiconRisk = 'NONE';
  const categories = new Set<LexiconCategory>(), emotions = new Set<LexiconEmotion>();
  for (const h of live) {
    // No negation downgrade here: the lexicon errs upward ("I am not tired of living" stays flagged). The rules keep their own negation handling.
    const r = h.entry.risk;
    if (RANK[r] > RANK[risk]) risk = r;
    if (r !== 'NONE' && h.entry.category && h.entry.category !== 'NONE') categories.add(h.entry.category);
    if (h.entry.emotion !== 'other') emotions.add(h.entry.emotion);
  }
  return { risk, categories: [...categories], emotions: [...emotions], matched: live.map((h) => h.entry), benign: benignHits.map((h) => h.entry) };
}

/** Emotion words found by the lexicon, for optional hints. Not wired into emotionRead (that read is model-based and already language-aware). */
export const lexiconEmotions = (text: string): LexiconEmotion[] => lexiconSignals(text).emotions;
