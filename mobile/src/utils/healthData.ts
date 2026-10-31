import type { SleepNight } from '../api/health';

const pad = (n: number) => String(n).padStart(2, '0');
export const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localHHmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface SleepSessionLike { start: Date | string; end: Date | string; awakenings?: number }

/**
 * One night per wake-up date, from raw sleep sessions. Keeps the longest session of each date (naps are dropped), ignores anything
 * under 90 minutes or over 16 hours, and expresses times in the phone's local clock.
 */
export function nightsFromSessions(sessions: SleepSessionLike[]): SleepNight[] {
  const best = new Map<string, { night: SleepNight; ms: number }>();
  for (const s of sessions) {
    const a = new Date(s.start), b = new Date(s.end);
    const ms = b.getTime() - a.getTime();
    if (!Number.isFinite(ms) || ms < 90 * 60_000 || ms > 16 * 3_600_000) continue;
    const date = localDateStr(b);
    const night: SleepNight = { date, bedtime: localHHmm(a), wakeTime: localHHmm(b), awakenings: Math.min(20, Math.max(0, Math.round(s.awakenings ?? 0))) };
    const cur = best.get(date);
    if (!cur || ms > cur.ms) best.set(date, { night, ms });
  }
  return [...best.values()].map((v) => v.night).sort((x, y) => x.date.localeCompare(y.date));
}

export interface SleepSampleLike { start: Date | string; end: Date | string; value: number }
/** HealthKit sleep-analysis values that count as asleep: asleep/unspecified 1, core 3, deep 4, REM 5. Awake is 2, in bed 0. */
const ASLEEP = new Set([1, 3, 4, 5]);
const AWAKE = 2;

/** Merges HealthKit sleep samples separated by less than an hour into sessions, counting awake samples inside as awakenings. */
export function sessionsFromSleepSamples(samples: SleepSampleLike[]): SleepSessionLike[] {
  const t = (x: Date | string) => new Date(x).getTime();
  const asleep = samples.filter((s) => ASLEEP.has(s.value)).sort((a, b) => t(a.start) - t(b.start));
  const awake = samples.filter((s) => s.value === AWAKE);
  const out: { start: number; end: number }[] = [];
  for (const s of asleep) {
    const last = out[out.length - 1];
    if (last && t(s.start) - last.end <= 60 * 60_000) last.end = Math.max(last.end, t(s.end));
    else out.push({ start: t(s.start), end: t(s.end) });
  }
  return out.map((o) => ({
    start: new Date(o.start), end: new Date(o.end),
    awakenings: awake.filter((w) => t(w.start) > o.start && t(w.start) < o.end && t(w.end) - t(w.start) >= 5 * 60_000).length,
  }));
}
