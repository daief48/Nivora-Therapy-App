import type { MoodEntry } from '../api/types';

export type Range = 'days' | 'weeks' | 'months';
export interface Point { label: string; mood: number | null; stress: number | null; count: number }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Buckets user-reported ratings: 7 daily points, 12 weekly points, or 12 monthly points ending at `now`. Pure and timezone-local. */
export function aggregateMoods(entries: MoodEntry[], range: Range, now: Date = new Date()): Point[] {
  const buckets: { start: Date; end: Date; label: string }[] = [];
  const today = startOfDay(now);
  if (range === 'days') {
    for (let i = 6; i >= 0; i--) {
      const s = new Date(today); s.setDate(s.getDate() - i);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      buckets.push({ start: s, end: e, label: `${s.getDate()}/${s.getMonth() + 1}` });
    }
  } else if (range === 'weeks') {
    for (let i = 11; i >= 0; i--) {
      const e = new Date(today); e.setDate(e.getDate() + 1 - i * 7);
      const s = new Date(e); s.setDate(s.getDate() - 7);
      buckets.push({ start: s, end: e, label: `${s.getDate()}/${s.getMonth() + 1}` });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const s = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const e = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
      buckets.push({ start: s, end: e, label: `${s.getMonth() + 1}/${String(s.getFullYear()).slice(2)}` });
    }
  }
  return buckets.map((b) => {
    const inB = entries.filter((m) => { const t = new Date(m.createdAt); return t >= b.start && t < b.end; });
    return {
      label: b.label, count: inB.length,
      mood: avg(inB.map((m) => m.moodScore)),
      stress: avg(inB.filter((m) => m.stressScore != null).map((m) => m.stressScore as number)),
    };
  });
}

export const hasData = (pts: Point[]) => pts.some((p) => p.mood !== null);
