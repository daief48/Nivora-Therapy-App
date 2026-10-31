import { toMinutes } from '../utils/dates.js';
import { NUDGE_TYPES, type NudgeType } from './wellnessCopy.js';

/**
 * Rule-based nudges (no model). Pure: the caller loads the facts, this decides which nudges are due right now.
 * Principles: quiet hours and snooze always win, at most MAX_PER_DAY a day, one per type a day, nothing guilt-based.
 */
export const MAX_PER_DAY = 2;
export const WIND_DOWN_LEAD_MIN = 45;
export const MOOD_GAP_DAYS = 3;
/** SESSION_INVITE: look at this many local days of the person's OWN numbers, and only decide with at least MIN_TREND_DAYS days of data. */
export const TREND_DAYS = 5;
export const MIN_TREND_DAYS = 3;
/** At most one SESSION_INVITE per this many days ("Not now" counts as having shown it). RARELY lengthens it. */
export const INVITE_GAP_DAYS = 3;
export const INVITE_GAP_RARELY_DAYS = 7;

export interface NudgeSettingsView { enabled: boolean; quietStart: string; quietEnd: string; typesOff: NudgeType[]; snoozedUntil: Date | null }
export const DEFAULT_SETTINGS: NudgeSettingsView = { enabled: true, quietStart: '23:00', quietEnd: '07:00', typesOff: [], snoozedUntil: null };

export interface NudgeContext {
  now: Date; nowMin: number; dow: number; // local minutes since midnight, local weekday (0 = Sunday)
  settings: NudgeSettingsView;
  morningCheckInToday: boolean;
  daysSinceCheckIn: number | null; // null = never
  accountAgeDays: number;
  tonightBedtime: string; // HH:mm
  weeklyReviewSaved: boolean; weekActions: number;
  /** SESSION_INVITE inputs (omitted = no invitation logic). */
  invite?: InviteInput;
}

export interface TrendDay { date: string; mood: number | null; stress: number | null; sleepMin: number | null }
export interface Trend { daysWithData: number; hardDays: number; concerning: boolean }
export interface InviteInput {
  trend: Trend;
  /** Risk signals in recent check-ins / assessments / safety events (services/riskState.ts): the invitation becomes support options. */
  riskSignals: boolean;
  /** Whole local days since the last SESSION_INVITE was surfaced (0 = today, still showing); null = never. */
  daysSinceLast: number | null;
  level: 'OFTEN' | 'SOMETIMES' | 'RARELY' | 'NEVER';
}

/**
 * Over the last TREND_DAYS days, how many logged days were "hard" by the person's own numbers: mood 4 or lower, stress 7 or higher, or under 6 hours
 * of sleep. concerning = at least MIN_TREND_DAYS days with data and hard on MOST of them. No scores leave this function.
 */
export function computeTrend(days: TrendDay[]): Trend {
  const used = days.slice(-TREND_DAYS).filter((x) => x.mood != null || x.stress != null || x.sleepMin != null);
  const hard = used.filter((x) => (x.mood != null && x.mood <= 4) || (x.stress != null && x.stress >= 7) || (x.sleepMin != null && x.sleepMin < 360));
  return { daysWithData: used.length, hardDays: hard.length, concerning: used.length >= MIN_TREND_DAYS && hard.length * 2 > used.length };
}

/** 'INVITE' = gentle invitation to talk it through; 'SUPPORT' = risk signals, so support options instead (never a session-only prompt); null = nothing. */
export function inviteVariant(i: InviteInput | undefined, nowMin: number): 'INVITE' | 'SUPPORT' | null {
  if (!i || i.level === 'NEVER' || !i.trend.concerning) return null;
  if (nowMin < 10 * 60 || nowMin >= 20 * 60) return null;
  const gap = i.level === 'RARELY' ? INVITE_GAP_RARELY_DAYS : INVITE_GAP_DAYS;
  if (i.daysSinceLast != null && i.daysSinceLast > 0 && i.daysSinceLast < gap) return null; // 0 = surfaced today: keep showing it until dismissed
  return i.riskSignals ? 'SUPPORT' : 'INVITE';
}

export function inQuietHours(nowMin: number, start: string, end: string): boolean {
  const s = toMinutes(start), e = toMinutes(end);
  if (s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e; // the window may wrap past midnight
}

export function parseTypesOff(csv: string): NudgeType[] {
  return csv.split(',').filter((t): t is NudgeType => (NUDGE_TYPES as readonly string[]).includes(t));
}

/** Nudge types that are due right now, in priority order (before the per-day cap is applied). */
export function dueNudges(c: NudgeContext): NudgeType[] {
  const s = c.settings;
  if (!s.enabled) return [];
  if (s.snoozedUntil && s.snoozedUntil.getTime() > c.now.getTime()) return [];
  if (inQuietHours(c.nowMin, s.quietStart, s.quietEnd)) return [];
  const due: NudgeType[] = [];
  const untilBed = (toMinutes(c.tonightBedtime) - c.nowMin + 1440) % 1440;
  if (untilBed > 0 && untilBed <= WIND_DOWN_LEAD_MIN) due.push('WIND_DOWN');
  if (c.nowMin >= 7 * 60 && c.nowMin < 11 * 60 && !c.morningCheckInToday) due.push('MORNING_PLAN');
  if (c.dow === 0 && c.nowMin >= 9 * 60 && c.nowMin < 21 * 60 && !c.weeklyReviewSaved && c.weekActions >= 3) due.push('WEEKLY_REVIEW');
  // The invitation (or, with risk signals, the support options) outranks the soft mood check-in when the daily cap bites.
  const inv = inviteVariant(c.invite, c.nowMin);
  if (inv === 'SUPPORT') due.unshift('SESSION_INVITE'); else if (inv === 'INVITE') due.push('SESSION_INVITE');
  const quietForLong = c.daysSinceCheckIn == null ? c.accountAgeDays >= MOOD_GAP_DAYS : c.daysSinceCheckIn >= MOOD_GAP_DAYS;
  if (quietForLong && c.nowMin >= 10 * 60 && c.nowMin < 20 * 60) due.push('MOOD_CHECKIN');
  if (c.invite?.level === 'NEVER') return [];
  return due.filter((t) => !s.typesOff.includes(t) && !(c.invite?.level === 'RARELY' && t === 'MOOD_CHECKIN'));
}

/** Daily cap for a suggestion level: 2 a day, 1 for RARELY. */
export const dailyCapFor = (level: InviteInput['level'] | undefined) => (level === 'RARELY' ? 1 : MAX_PER_DAY);

/**
 * Applies the daily cap. `shownToday` = types already surfaced today (dismissed ones included, they still count).
 * Returns the due types to show now and the new ones to log.
 */
export function applyDailyCap(due: NudgeType[], shownToday: { type: NudgeType; dismissed: boolean }[], max = MAX_PER_DAY): { show: NudgeType[]; logNew: NudgeType[] } {
  const show: NudgeType[] = [], logNew: NudgeType[] = [];
  let count = shownToday.length;
  for (const t of due) {
    const prev = shownToday.find((x) => x.type === t);
    if (prev) { if (!prev.dismissed) show.push(t); continue; }
    if (count >= max) continue;
    count++; logNew.push(t); show.push(t);
  }
  return { show, logNew };
}
