import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { pick, PATTERN_CTA, PRACTICE_LINE, reasonText, WEEKDAY_NAMES } from './actionCopy.js';
import { fill } from './wellnessCopy.js';
import { actionById, toCard, type ActionCard, type SuggestionLevel } from './actionMenu.js';
import { PRACTICE_GOAL_TITLE } from './kaizenExtras.js';
import type { MonthlyStats } from './monthlyStats.js';

/**
 * Extras of GET /insights/monthly, all computed from the person's own numbers without a model:
 *  - `practice`: how often they used the calming practices and, for thought records, their own before / after mood averages (no "improvement" wording),
 *  - `patterns`: each pattern card with ONE rule-based next-step button taken from the action registry.
 */
export interface PracticeBlock {
  counts: { BREATHING: number; GROUNDING: number; THOUGHT_RECORD: number; SOUNDS: number }; total: number;
  thoughtRecord: { count: number; pairs: number; avgMoodBefore: number | null; avgMoodAfter: number | null };
  line: string | null;
}
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function practiceBlock(db: Db, cipher: Cipher, userId: string, fromDate: string, locale?: string | null): Promise<PracticeBlock> {
  const from = new Date(Date.parse(`${fromDate}T00:00:00Z`) - 86_400_000);
  const [steps, records] = await Promise.all([
    db.kaizenAction.findMany({ where: { userId, date: { gte: fromDate }, status: { in: ['DONE', 'PARTIAL'] }, goal: { systemKey: { in: Object.keys(PRACTICE_GOAL_TITLE) } } }, select: { goal: { select: { systemKey: true } } } }),
    db.journalEntry.findMany({ where: { userId, entryType: 'THOUGHT_RECORD', deletedAt: null, createdAt: { gte: from } }, select: { encryptedContent: true, createdAt: true } }),
  ]);
  const byKey = (k: string) => steps.filter((s) => s.goal.systemKey === k).length; // the helper goals are marked by systemKey (= category), never matched by title
  const counts = { BREATHING: byKey('BREATHING'), GROUNDING: byKey('GROUNDING'), THOUGHT_RECORD: byKey('REFLECTION'), SOUNDS: byKey('RELAXATION') };
  const before: number[] = [], after: number[] = [];
  let pairs = 0;
  for (const rec of records) {
    try {
      const j = JSON.parse(cipher.decrypt(rec.encryptedContent)) as { moodBefore?: unknown; moodAfter?: unknown };
      if (typeof j.moodBefore === 'number' && typeof j.moodAfter === 'number') { before.push(j.moodBefore); after.push(j.moodAfter); pairs++; }
    } catch { /* an unreadable entry is simply not counted */ }
  }
  const total = counts.BREATHING + counts.GROUNDING + counts.THOUGHT_RECORD + counts.SOUNDS;
  const mean = (xs: number[]) => (xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    counts, total, thoughtRecord: { count: records.length, pairs, avgMoodBefore: mean(before), avgMoodAfter: mean(after) },
    line: total > 0 ? fill(pick(PRACTICE_LINE, locale), { n: total }) : null,
  };
}

export interface PatternCard {
  id: string; type: 'CORRELATION' | 'WEEKDAY_LOW'; a?: string; b?: string; direction?: 'together' | 'opposite'; strength?: string; weekday?: string;
  text: string; reason: string; nextStep: ActionCard | null;
}

/** Which registry action answers a pair of metrics, and the label of its button. */
export function nextStepFor(a: string, b: string): { actionId: string; cta: keyof typeof PATTERN_CTA } {
  const has = (m: string) => a === m || b === m;
  if (has('sleepScore')) return { actionId: 'SLEEP_ROUTINE', cta: 'sleep' };
  if (has('activeMin')) return { actionId: 'WALK_10', cta: 'walk' };
  if (has('kaizenDone')) return { actionId: 'KAIZEN_STEP', cta: 'step' };
  return { actionId: 'BREATHING', cta: 'breathe' };
}

export function patternCards(stats: MonthlyStats, locale: string | null | undefined, opts: { riskMode: boolean; level: SuggestionLevel }): PatternCard[] {
  const out: PatternCard[] = [];
  const allowStep = !opts.riskMode && opts.level !== 'NEVER';
  for (const c of stats.correlations.slice(0, 3)) {
    const m = nextStepFor(c.a, c.b);
    const reasonKey = m.cta === 'sleep' ? 'pattern_sleep' : m.cta === 'walk' ? 'pattern_move' : 'pattern_calm';
    const def = actionById(m.actionId)!;
    out.push({
      id: `corr:${c.a}:${c.b}`, type: 'CORRELATION', a: c.a, b: c.b, direction: c.direction, strength: c.strength,
      text: reasonText(reasonKey, locale), reason: reasonText(reasonKey, locale),
      nextStep: allowStep ? toCard(def, locale, 'MONTHLY', reasonKey, { cta: pick(PATTERN_CTA[m.cta], locale) }) : null,
    });
  }
  const low = stats.lowestMoodWeekday;
  if (low) {
    const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(low.weekday);
    const name = WEEKDAY_NAMES[locale === 'bn' || locale === 'hi' || locale === 'ne' ? locale : 'en'][dow] ?? low.weekday;
    const def = actionById('KAIZEN_STEP')!;
    out.push({
      id: `weekday:${dow}`, type: 'WEEKDAY_LOW', weekday: low.weekday, text: reasonText('pattern_weekday', locale, { weekday: name }), reason: reasonText('pattern_weekday', locale, { weekday: name }),
      nextStep: allowStep ? toCard(def, locale, 'MONTHLY', 'pattern_weekday', {
        cta: fill(pick(PATTERN_CTA.weekday, locale), { weekday: name }), reason: reasonText('pattern_weekday', locale, { weekday: name }),
        deepLink: { route: 'Tabs', params: { screen: 'KaizenTab', weekday: dow } },
      }) : null,
    });
  }
  return out;
}
