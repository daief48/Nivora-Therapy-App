import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { badRequest } from '../utils/errors.js';
import { INSTRUMENT_DEFS, INSTRUMENTS, isInstrument, type BandKey, type Instrument } from './assessmentContent.js';

export interface Score { total: number; severity: BandKey; item9?: number }
export interface AssessmentView { id: string; instrument: Instrument; total: number; severity: BandKey; createdAt: Date; answers: number[] }

/** Pure scoring with validation: every item answered once, with a value that is one of that item's options. */
export function scoreAssessment(instrument: string, answers: unknown): Score {
  if (!isInstrument(instrument)) throw badRequest('Unknown instrument');
  const def = INSTRUMENT_DEFS[instrument];
  if (!Array.isArray(answers) || answers.length !== def.items.length) throw badRequest(`Expected ${def.items.length} answers`);
  let total = 0;
  answers.forEach((a, i) => {
    if (typeof a !== 'number' || !Number.isInteger(a) || !def.items[i].options.some((o) => o.value === a)) throw badRequest(`Invalid answer for item ${i + 1}`);
    total += a;
  });
  const band = def.bands.find((b) => total >= b.min && total <= b.max)!;
  return { total, severity: band.key, ...(instrument === 'PHQ9' ? { item9: answers[8] as number } : {}) };
}

/** Severity for the coarse safety flag: 1 = ELEVATED, 2-3 = HIGH. No answers or text are stored on the event. */
export const item9Severity = (item9: number | undefined) => (!item9 ? null : item9 >= 2 ? 'HIGH' : 'ELEVATED');

interface Row { id: string; instrument: string; encryptedContent: string; createdAt: Date }
function decode(cipher: Cipher, r: Row): AssessmentView | null {
  try {
    const p = JSON.parse(cipher.decrypt(r.encryptedContent));
    if (!isInstrument(r.instrument)) return null;
    return { id: r.id, instrument: r.instrument, total: p.total, severity: p.severity, createdAt: r.createdAt, answers: p.answers ?? [] };
  } catch { return null; }
}

export async function createAssessment(db: Db, cipher: Cipher, userId: string, instrument: Instrument, answers: number[]) {
  const s = scoreAssessment(instrument, answers);
  const row = await db.assessment.create({ data: { userId, instrument, encryptedContent: cipher.encrypt(JSON.stringify({ answers, ...s })) } });
  const sev = item9Severity(s.item9);
  // Coarse flag only, same shape as other SafetyEvent rows: no answers, no text.
  if (sev) await db.safetyEvent.create({ data: { userId, severity: sev, category: 'SELF_HARM', actionTaken: 'ASSESSMENT_ITEM9' } });
  return { score: s, item9Flag: !!sev, view: decode(cipher, row)! };
}

export async function listAssessments(db: Db, cipher: Cipher, userId: string, opts: { instrument?: Instrument; take?: number } = {}): Promise<AssessmentView[]> {
  const rows = await db.assessment.findMany({ where: { userId, ...(opts.instrument ? { instrument: opts.instrument } : {}) }, orderBy: { createdAt: 'desc' }, take: opts.take ?? 200 });
  return rows.map((r) => decode(cipher, r)).filter((v): v is AssessmentView => !!v);
}

export type Trend = 'improving' | 'worsening' | 'steady' | 'first';
/** Trend of the newest total vs the one before it (lower is better on all three instruments). A change of 3+ points counts. */
export function trendOf(totalsNewestFirst: number[]): Trend {
  if (totalsNewestFirst.length < 2) return 'first';
  const d = totalsNewestFirst[0] - totalsNewestFirst[1];
  return d <= -3 ? 'improving' : d >= 3 ? 'worsening' : 'steady';
}

export async function latestPerInstrument(db: Db, cipher: Cipher, userId: string) {
  const out: { instrument: Instrument; severity: BandKey; total: number; createdAt: Date; trend: Trend }[] = [];
  for (const instrument of INSTRUMENTS) {
    const rows = await listAssessments(db, cipher, userId, { instrument, take: 2 });
    if (rows[0]) out.push({ instrument, severity: rows[0].severity, total: rows[0].total, createdAt: rows[0].createdAt, trend: trendOf(rows.map((r) => r.total)) });
  }
  return out;
}

/** Coarse prompt block (instrument, band, date, trend). Never raw answers or item scores; '' when nothing exists. */
export async function assessmentContextBlock(db: Db, cipher: Cipher, userId: string): Promise<string> {
  const latest = await latestPerInstrument(db, cipher, userId);
  if (!latest.length) return '';
  const lines = latest.map((l) => `- ${INSTRUMENT_DEFS[l.instrument].title.en.split(' (')[0]}: ${l.severity.replace(/_/g, ' ')} band on ${l.createdAt.toISOString().slice(0, 10)} (${l.trend})`);
  return `SCREENING CHECK-INS (self-reported questionnaires, not diagnoses; mention only if the user brings it up or it is clearly relevant, never state scores):\n${lines.join('\n')}`;
}
