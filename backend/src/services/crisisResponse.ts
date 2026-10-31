import type { Db } from '../config/database.js';
import { assessSafely, crisisMessage, devanagariLang, getResources, type Lang } from './safetyService.js';

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
