import type { Db } from '../../config/database.js';
import { consentRequired } from '../../utils/errors.js';

export const CONSENT_TYPES = ['AGE_18_PLUS', 'AI_DISCLOSURE', 'PRIVACY', 'JOURNAL_AI_SHARING'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
export const REQUIRED_CONSENTS: ConsentType[] = ['AGE_18_PLUS', 'AI_DISCLOSURE', 'PRIVACY'];
/** Bump when the legal text changes; users must re-consent to a newer version. */
export const CONSENT_VERSION = '2026-10-01';

export async function activeConsents(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.userConsent.findMany({ where: { userId, withdrawnAt: null }, select: { consentType: true } });
  return new Set(rows.map((r) => r.consentType));
}

export async function requireConsents(db: Db, userId: string, types: ConsentType[] = REQUIRED_CONSENTS) {
  const have = await activeConsents(db, userId);
  const missing = types.filter((t) => !have.has(t));
  if (missing.length) throw consentRequired(`Missing consent: ${missing.join(', ')}`);
}
