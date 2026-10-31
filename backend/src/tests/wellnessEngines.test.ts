import { describe, expect, it } from 'vitest';
import { applyDailyCap, DEFAULT_SETTINGS, dueNudges, inQuietHours, type NudgeContext } from '../services/nudgeEngine.js';
import { computeMonthly, factsFor, numbersMatch, pearson, sentenceCount, type DayRow } from '../services/monthlyStats.js';
import { seasonFromMood } from '../services/gardenService.js';
import { addDays } from '../utils/dates.js';

const ctx = (over: Partial<NudgeContext> = {}): NudgeContext => ({
  now: new Date('2026-11-01T12:00:00Z'), nowMin: 12 * 60, dow: 3, settings: { ...DEFAULT_SETTINGS }, morningCheckInToday: true, daysSinceCheckIn: 0, accountAgeDays: 30,
  tonightBedtime: '22:30', weeklyReviewSaved: false, weekActions: 0, ...over,
});

describe('nudge rules', () => {
  it('wind-down fires within 45 minutes before the usual bedtime only', () => {
    expect(dueNudges(ctx({ nowMin: 21 * 60 + 50 }))).toContain('WIND_DOWN');
    expect(dueNudges(ctx({ nowMin: 20 * 60 }))).not.toContain('WIND_DOWN');
    expect(dueNudges(ctx({ nowMin: 22 * 60 + 40 }))).not.toContain('WIND_DOWN');
  });
  it('mood check-in after several days without an entry; weekly review on Sunday with enough steps; morning plan in the morning', () => {
    expect(dueNudges(ctx({ daysSinceCheckIn: 3, nowMin: 14 * 60 }))).toContain('MOOD_CHECKIN');
    expect(dueNudges(ctx({ daysSinceCheckIn: 2, nowMin: 14 * 60 }))).not.toContain('MOOD_CHECKIN');
    expect(dueNudges(ctx({ dow: 0, nowMin: 10 * 60, weekActions: 4 }))).toContain('WEEKLY_REVIEW');
    expect(dueNudges(ctx({ dow: 0, nowMin: 10 * 60, weekActions: 4, weeklyReviewSaved: true }))).not.toContain('WEEKLY_REVIEW');
    expect(dueNudges(ctx({ dow: 2, nowMin: 10 * 60, weekActions: 4 }))).not.toContain('WEEKLY_REVIEW');
    expect(dueNudges(ctx({ nowMin: 8 * 60, morningCheckInToday: false }))).toContain('MORNING_PLAN');
  });
  it('quiet hours (wrapping midnight), snooze, global switch and per-type toggles always win', () => {
    expect(inQuietHours(23 * 60 + 30, '23:00', '07:00')).toBe(true);
    expect(inQuietHours(3 * 60, '23:00', '07:00')).toBe(true);
    expect(inQuietHours(12 * 60, '23:00', '07:00')).toBe(false);
    const due = ctx({ nowMin: 21 * 60 + 50 });
    expect(dueNudges({ ...due, settings: { ...DEFAULT_SETTINGS, quietStart: '21:00', quietEnd: '07:00' } })).toEqual([]);
    expect(dueNudges({ ...due, settings: { ...DEFAULT_SETTINGS, snoozedUntil: new Date('2026-11-01T13:00:00Z') } })).toEqual([]);
    expect(dueNudges({ ...due, settings: { ...DEFAULT_SETTINGS, enabled: false } })).toEqual([]);
    expect(dueNudges({ ...due, settings: { ...DEFAULT_SETTINGS, typesOff: ['WIND_DOWN'] } })).not.toContain('WIND_DOWN');
  });
  it('at most 2 a day; dismissed ones stay hidden but still count', () => {
    const r = applyDailyCap(['WIND_DOWN', 'MOOD_CHECKIN', 'WEEKLY_REVIEW'], []);
    expect(r.show).toEqual(['WIND_DOWN', 'MOOD_CHECKIN']);
    const again = applyDailyCap(['WIND_DOWN', 'MOOD_CHECKIN', 'WEEKLY_REVIEW'], [{ type: 'WIND_DOWN', dismissed: true }, { type: 'MOOD_CHECKIN', dismissed: false }]);
    expect(again.show).toEqual(['MOOD_CHECKIN']);
    expect(again.logNew).toEqual([]);
  });
});

describe('monthly statistics', () => {
  const rows = (n: number, f: (i: number) => Partial<DayRow>): DayRow[] => Array.from({ length: n }, (_, i) => ({
    date: addDays('2026-10-01', i), mood: null, stress: null, energy: null, sleepScore: null, sleepHours: null, kaizenDone: null, steps: null, activeMin: null, ...f(i),
  }));
  it('pearson basics', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it('needs a minimum number of logged days', () => {
    expect(computeMonthly(rows(30, (i) => (i < 10 ? { mood: 5 } : {}))).enough).toBe(false);
    expect(computeMonthly(rows(30, (i) => (i < 14 ? { mood: 5 } : {}))).enough).toBe(true);
  });
  it('reports relationships that moved together, skips weak ones, and finds weekday gaps', () => {
    const m = computeMonthly(rows(28, (i) => ({ mood: 3 + (i % 7), stress: 9 - (i % 7), sleepScore: 50 + (i % 7) * 5, activeMin: i % 3 === 0 ? 30 : 0 })));
    const ms = m.correlations.find((c) => c.a === 'mood' && c.b === 'stress')!;
    expect(ms.direction).toBe('opposite');
    expect(ms.strength).toBe('strong');
    expect(m.bestMoodWeekday && m.lowestMoodWeekday).toBeTruthy();
    const flat = computeMonthly(rows(28, (i) => ({ mood: 5, stress: 4, sleepScore: 60 + (i % 2) })));
    expect(flat.correlations).toEqual([]);
    expect(flat.bestMoodWeekday).toBeNull();
  });
  it('validates that every number in the narrative comes from the facts', () => {
    const m = computeMonthly(rows(20, (i) => ({ mood: 5 + (i % 2), stress: 4, sleepScore: 70 })));
    const facts = factsFor(m);
    expect(numbersMatch('You wrote on 20 days and your mood averaged 5.5 out of 10.', facts)).toBe(true);
    expect(numbersMatch('Your mood averaged 8 out of 10.', facts)).toBe(false);
    expect(numbersMatch('আপনি ২০ দিন লিখেছেন।', facts)).toBe(true);
    expect(sentenceCount('One. Two! Three? Four।')).toBe(4);
  });
  it('season follows mood', () => {
    expect([8, 6, 4.5, 2, null].map(seasonFromMood)).toEqual(['SUMMER', 'SPRING', 'AUTUMN', 'WINTER', 'SPRING']);
  });
});
