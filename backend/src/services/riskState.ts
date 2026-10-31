import type { Db } from '../config/database.js';

/**
 * Rule-based "risk signals" in the person's recent history, used to decide whether any feature may suggest a task, an exercise or a session.
 * Coarse metadata only (SafetyEvent rows, session risk flags): never text. With signals present, only crisis support may be offered
 * (Emergency, Safety plan, a trusted person, a professional).
 *
 * A signal is any of:
 *  - a HIGH / IMMINENT SafetyEvent in the last 14 days (chat, check-in, journal, voice journal, assessment item 9 ...),
 *  - an ASSESSMENT_ITEM9 event (PHQ-9 item 9 flag) in the last 14 days,
 *  - an ELEVATED event in the last 3 days,
 *  - a session with riskFlag HIGH in the last 14 days,
 *  - a very low and very stressed check-in (mood <= 2 and stress >= 9) in the last 3 days,
 *  - a PHQ-9 / GAD-7 result in the 'severe' or 'moderately_severe' band in the last 14 days.
 */
export const RISK_LOOKBACK = { high: 14, item9: 14, elevated: 3, session: 14, checkin: 3, assessment: 14 } as const;
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000);

export type RiskReason = 'CRISIS_EVENT' | 'ITEM9' | 'ELEVATED_EVENT' | 'SESSION_FLAG' | 'LOW_CHECKIN' | 'SEVERE_ASSESSMENT';

export async function riskReasons(db: Db, userId: string, decode: (enc: string) => { severity?: string } | null, now = new Date()): Promise<RiskReason[]> {
  const out: RiskReason[] = [];
  const [crisis, item9, elevated, flagged, lowCheckin, assess] = await Promise.all([
    db.safetyEvent.count({ where: { userId, severity: { in: ['HIGH', 'IMMINENT'] }, createdAt: { gte: daysAgo(RISK_LOOKBACK.high, now) } } }),
    db.safetyEvent.count({ where: { userId, actionTaken: 'ASSESSMENT_ITEM9', createdAt: { gte: daysAgo(RISK_LOOKBACK.item9, now) } } }),
    db.safetyEvent.count({ where: { userId, severity: 'ELEVATED', createdAt: { gte: daysAgo(RISK_LOOKBACK.elevated, now) } } }),
    db.therapySession.count({ where: { userId, riskFlag: 'HIGH', startedAt: { gte: daysAgo(RISK_LOOKBACK.session, now) } } }),
    db.checkIn.count({ where: { userId, mood: { lte: 2 }, stress: { gte: 9 }, createdAt: { gte: daysAgo(RISK_LOOKBACK.checkin, now) } } }),
    db.assessment.findMany({ where: { userId, instrument: { in: ['PHQ9', 'GAD7'] }, createdAt: { gte: daysAgo(RISK_LOOKBACK.assessment, now) } }, select: { encryptedContent: true } }),
  ]);
  if (crisis) out.push('CRISIS_EVENT');
  if (item9) out.push('ITEM9');
  if (elevated) out.push('ELEVATED_EVENT');
  if (flagged) out.push('SESSION_FLAG');
  if (lowCheckin) out.push('LOW_CHECKIN');
  if (assess.some((a) => { const v = decode(a.encryptedContent); return v?.severity === 'severe' || v?.severity === 'moderately_severe'; })) out.push('SEVERE_ASSESSMENT');
  return out;
}

export async function hasRiskSignals(db: Db, userId: string, decode: (enc: string) => { severity?: string } | null, now = new Date()): Promise<boolean> {
  return (await riskReasons(db, userId, decode, now)).length > 0;
}

/** Decoder for Assessment.encryptedContent (JSON with a severity band) using the app cipher; null when it cannot be read. */
export const assessmentDecoder = (decrypt: (s: string) => string) => (enc: string): { severity?: string } | null => {
  try { const p = JSON.parse(decrypt(enc)); return typeof p?.severity === 'string' ? { severity: p.severity } : null; } catch { return null; }
};

/** Convenience used by routes: risk signals for a person, decoding assessment bands with the app cipher. */
export const userHasRisk = (db: Db, cipher: { decrypt(s: string): string }, userId: string, now = new Date()) =>
  hasRiskSignals(db, userId, assessmentDecoder((s) => cipher.decrypt(s)), now);
