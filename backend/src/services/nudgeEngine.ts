import { toMinutes } from '../utils/dates.js';
import { NUDGE_TYPES, type NudgeType } from './wellnessCopy.js';

/**
 * Rule-based nudges (no model). Pure: the caller loads the facts, this decides which nudges are due right now.
 * Principles: quiet hours and snooze always win, at most MAX_PER_DAY a day, one per type a day, nothing guilt-based.
 */
export const MAX_PER_DAY = 2;
export const WIND_DOWN_LEAD_MIN = 45;
export const MOOD_GAP_DAYS = 3;

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
  const quietForLong = c.daysSinceCheckIn == null ? c.accountAgeDays >= MOOD_GAP_DAYS : c.daysSinceCheckIn >= MOOD_GAP_DAYS;
  if (quietForLong && c.nowMin >= 10 * 60 && c.nowMin < 20 * 60) due.push('MOOD_CHECKIN');
  return due.filter((t) => !s.typesOff.includes(t));
}

/**
 * Applies the daily cap. `shownToday` = types already surfaced today (dismissed ones included, they still count).
 * Returns the due types to show now and the new ones to log.
 */
export function applyDailyCap(due: NudgeType[], shownToday: { type: NudgeType; dismissed: boolean }[]): { show: NudgeType[]; logNew: NudgeType[] } {
  const show: NudgeType[] = [], logNew: NudgeType[] = [];
  let count = shownToday.length;
  for (const t of due) {
    const prev = shownToday.find((x) => x.type === t);
    if (prev) { if (!prev.dismissed) show.push(t); continue; }
    if (count >= MAX_PER_DAY) continue;
    count++; logNew.push(t); show.push(t);
  }
  return { show, logNew };
}
