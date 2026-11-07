import type { Db } from '../config/database.js';
import type { GlmClient } from './glmClient.js';
import { classifyRisk, needsRiskFallback } from './riskFallback.js';
import { assessRules, assessSafely, crisisMessage, devanagariLang, getResources, type Lang } from './safetyService.js';

/**
 * Language of a crisis message for a one-shot feature (practice, journal, check-in, actions ...), from the SCRIPT of what was written
 * and the person's locale. English text from an English account gets English, never the Bangla+English fallback that pickLang('mixed') gave.
 *  - Bangla script => bn; Devanagari => hi/ne (distinguishing words first, then the account locale);
 *  - Latin text: English for en / hi / ne / auto accounts; for a Bangla or 'mixed' account (romanised Bangla is common) both languages.
 */
export function crisisLang(text: string, locale?: string | null): Lang {
  if (/[ঀ-৿]/.test(text)) return 'bn';
  if (/[ऀ-ॿ]/.test(text)) {
    const l = devanagariLang(text);
    return locale === 'ne' && l === 'hi' && !/(मुझे|आपको|नहीं|क्या|\bहै\b|\bहैं\b)/.test(text) ? 'ne' : l;
  }
  if (locale === 'bn' || locale === 'mixed') return 'mixed';
  return 'en';
}

/**
 * The `safety` object for a HIGH / IMMINENT result in a one-shot feature: the fixed reviewed message in the right language plus the
 * person's country resources. Writes the content-free SafetyEvent (never the text) unless `record` is false.
 */
export async function crisisSafety(db: Db, userId: string, severity: string, categories: string[], text: string, record = true) {
  const [profile, user] = await Promise.all([
    db.userProfile.findUnique({ where: { userId } }),
    db.user.findUnique({ where: { id: userId }, select: { locale: true } }),
  ]);
  const resources = await getResources(db, profile?.countryCode);
  if (record) await db.safetyEvent.create({ data: { userId, severity, category: categories.join(',') || null, actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
  return { severity, crisis: true, resources, message: crisisMessage(severity === 'IMMINENT' ? 'IMMINENT' : 'HIGH', crisisLang(text, user?.locale), resources) };
}

/** Content-free SafetyEvent for an ELEVATED result (support options are shown, nothing else changes). */
export async function recordElevated(db: Db, userId: string, categories: string[]) {
  await db.safetyEvent.create({ data: { userId, severity: 'ELEVATED', category: categories.join(',') || null, actionTaken: 'SUPPORT_FOOTER_ADDED' } });
}

/**
 * Risk check for free text a feature is about to STORE (journal, notes ...). HIGH / IMMINENT: content-free SafetyEvent and the crisis
 * payload is returned (the caller answers 200 with it and stores NOTHING). ELEVATED: content-free event, null (store normally). Otherwise null.
 */
export async function guardFreeText(db: Db, userId: string, text: string | null | undefined) {
  if (!text || !text.trim()) return null;
  const a = assessSafely(text);
  if (a.severity === 'HIGH' || a.severity === 'IMMINENT') return { crisis: true as const, safety: await crisisSafety(db, userId, a.severity, a.categories, text) };
  if (a.severity === 'ELEVATED') await recordElevated(db, userId, a.categories);
  return null;
}

// ── guardInput: the chat pipeline (rules + rolling window + model fallback) for one-shot free-text features ──
const ROLL_WINDOW_MS = 2 * 60_000;
const ROLL_N = 2;
const ROLL_MAX_USERS = 5000;
/** Recent NON-crisis inputs per user (memory only, short-lived, never HIGH/IMMINENT text) for the rolling window ("I don't want" + "to be here"). */
const recentInputs = new Map<string, { text: string; at: number }[]>();

function rememberInput(userId: string, text: string, now: number) {
  const list = (recentInputs.get(userId) ?? []).filter((x) => now - x.at <= ROLL_WINDOW_MS);
  list.push({ text: text.slice(0, 500), at: now });
  recentInputs.delete(userId);
  recentInputs.set(userId, list.slice(-ROLL_N));
  if (recentInputs.size > ROLL_MAX_USERS) { const first = recentInputs.keys().next().value; if (first) recentInputs.delete(first); }
}

export type GuardResult = {
  /** The crisis payload to answer with (HIGH / IMMINENT); the caller must store nothing and call no AI. */
  crisis: { crisis: true; safety: Awaited<ReturnType<typeof crisisSafety>> } | null;
  /** True when the model-based check could not clear the text (or flagged it): use the non-AI fallback, never block the user. */
  skipAi: boolean;
};

/**
 * Safety gate for free text BEFORE any AI call / task splitting / storage. Same layers as chat: rules, rolling window over the user's
 * previous inputs, then (only when rules found nothing and the text is outside rule coverage) the model classifier. The classifier is fail-safe:
 * an error counts as ELEVATED (content-free event, skipAi) and never blocks the user. HIGH / IMMINENT text is never remembered or logged.
 */
export async function guardInput(db: Db, glm: GlmClient, userId: string, ...texts: (string | null | undefined)[]): Promise<GuardResult> {
  let skipAi = false;
  for (const text of texts) {
    if (!text || !text.trim()) continue;
    const now = Date.now();
    let a = assessSafely(text);
    const isCrisis = (x: { severity: string }) => x.severity === 'HIGH' || x.severity === 'IMMINENT';
    if (!isCrisis(a)) {
      const frags = (recentInputs.get(userId) ?? []).filter((x) => now - x.at <= ROLL_WINDOW_MS).map((x) => x.text);
      if (frags.length) {
        const joint = assessSafely([...frags, text].join(' '));
        if (isCrisis(joint)) a = joint;
      }
    }
    let modelElevated = false;
    if ((a.severity === 'NONE' || (a.severity === 'ELEVATED' && assessRules(text).severity === 'NONE')) && needsRiskFallback(text, true)) {
      const r = await classifyRisk(glm, text);
      if (isCrisis(r)) a = r;
      else if (r.severity !== 'NONE') { modelElevated = true; if (a.severity === 'NONE') a = r; }
    }
    if (isCrisis(a)) {
      recentInputs.delete(userId);
      return { crisis: { crisis: true as const, safety: await crisisSafety(db, userId, a.severity, a.categories, text) }, skipAi: true };
    }
    if (a.severity === 'ELEVATED') await recordElevated(db, userId, a.categories);
    if (modelElevated) skipAi = true;
    rememberInput(userId, text, now);
  }
  return { crisis: null, skipAi };
}
