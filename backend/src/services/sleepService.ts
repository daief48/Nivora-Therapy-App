import { fromMinutes, toMinutes } from '../utils/dates.js';

/** Sleep Score is a wellness indicator, not a medical measure. Weights are configurable and add up to 100. */
export const SLEEP_WEIGHTS = { duration: 30, consistency: 20, awakenings: 15, quality: 25, routine: 10 } as const;

export function durationMinutes(bedtime: string, wakeTime: string): number {
  const diff = toMinutes(wakeTime) - toMinutes(bedtime);
  return diff > 0 ? diff : diff + 1440; // crossing midnight
}

/** Circular standard deviation (minutes) of clock times, so 23:50 and 00:10 count as 20 minutes apart. */
export function bedtimeSpread(times: string[]): number {
  if (times.length < 2) return 0;
  const angles = times.map((t) => (toMinutes(t) / 1440) * 2 * Math.PI);
  const c = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  const s = angles.reduce((s2, a) => s2 + Math.sin(a), 0) / angles.length;
  const R = Math.min(1, Math.hypot(c, s));
  return (Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) / (2 * Math.PI)) * 1440;
}

export interface ScoreInput {
  durationMin: number; awakenings: number; rested: number; recentBedtimes: string[]; routineRate: number; // 0..1
}
export interface ScoreResult {
  score: number;
  parts: { duration: number; consistency: number; awakenings: number; quality: number; routine: number };
  max: typeof SLEEP_WEIGHTS;
}

export function sleepScore(i: ScoreInput): ScoreResult {
  const w = SLEEP_WEIGHTS;
  const hours = i.durationMin / 60;
  // Full marks for 7-9 h, fading linearly to zero at 4 h / 11 h.
  const durFactor = hours >= 7 && hours <= 9 ? 1 : hours < 7 ? Math.max(0, (hours - 4) / 3) : Math.max(0, (11 - hours) / 2);
  const spread = bedtimeSpread(i.recentBedtimes);
  const consFactor = i.recentBedtimes.length < 2 ? 0.7 : Math.max(0, 1 - spread / 90);
  const awakeFactor = Math.max(0, 1 - i.awakenings * 0.25);
  const parts = {
    duration: Math.round(w.duration * durFactor),
    consistency: Math.round(w.consistency * consFactor),
    awakenings: Math.round(w.awakenings * awakeFactor),
    quality: Math.round((w.quality * (i.rested - 1)) / 9),
    routine: Math.round(w.routine * Math.max(0, Math.min(1, i.routineRate))),
  };
  const score = Math.max(0, Math.min(100, parts.duration + parts.consistency + parts.awakenings + parts.quality + parts.routine));
  return { score, parts, max: SLEEP_WEIGHTS };
}

export interface RoutineStep { id: string; at: string; kind: 'breathing' | 'reflection' | 'audio' | 'sleep'; minutes: number }

/** Wind-down steps counted back from the bedtime. High evening stress adds a few minutes of breathing. */
export function buildRoutine(bedtime: string, eveningStress?: number | null): RoutineStep[] {
  const bed = toMinutes(bedtime);
  const breath = eveningStress && eveningStress >= 7 ? 7 : 5;
  const reflect = 5;
  const audio = 15;
  const start = bed - (breath + reflect + audio);
  return [
    { id: 'breathing', at: fromMinutes(start), kind: 'breathing', minutes: breath },
    { id: 'reflection', at: fromMinutes(start + breath), kind: 'reflection', minutes: reflect },
    { id: 'audio', at: fromMinutes(start + breath + reflect), kind: 'audio', minutes: audio },
    { id: 'sleep', at: fromMinutes(bed), kind: 'sleep', minutes: 0 },
  ];
}

/** Gradual Kaizen shift: move the typical bedtime 10 minutes toward the desired one, never jump. */
export function gradualBedtime(recent: string[], desired: string, stepMin = 10): string {
  if (!recent.length) return desired;
  const angles = recent.map((t) => toMinutes(t));
  // Average on a circle, anchored at the first entry to survive midnight.
  const base = angles[0]!;
  const rel = angles.map((a) => { let x = a - base; if (x > 720) x -= 1440; if (x < -720) x += 1440; return x; });
  const typical = base + rel.reduce((s, x) => s + x, 0) / rel.length;
  let delta = toMinutes(desired) - typical;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  if (Math.abs(delta) <= stepMin) return desired;
  return fromMinutes(typical + Math.sign(delta) * stepMin);
}
