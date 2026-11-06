import { describe, expect, it } from 'vitest';
import { buildRoutine, bedtimeSpread, durationMinutes, gradualBedtime, sleepScore } from '../services/sleepService.js';

describe('Sleep helpers', () => {
  it('computes duration across midnight', () => {
    expect(durationMinutes('23:30', '06:30')).toBe(420);
    expect(durationMinutes('01:00', '08:00')).toBe(420);
  });
  it('measures bedtime spread on a circle', () => {
    expect(bedtimeSpread(['23:50', '00:10'])).toBeLessThan(25);
    expect(bedtimeSpread(['22:00', '01:30'])).toBeGreaterThan(60);
  });
  it('scores a good night high and a bad night low, with a transparent breakdown', () => {
    const good = sleepScore({ durationMin: 480, awakenings: 0, rested: 9, recentBedtimes: ['22:30', '22:35', '22:25'], routineRate: 1 });
    const bad = sleepScore({ durationMin: 240, awakenings: 4, rested: 2, recentBedtimes: ['23:00', '03:00', '01:00'], routineRate: 0 });
    expect(good.score).toBeGreaterThan(85);
    expect(bad.score).toBeLessThan(25);
    expect(good.parts.duration + good.parts.consistency + good.parts.awakenings + good.parts.quality + good.parts.routine).toBe(good.score);
  });
  it('shifts bedtime gradually toward the desired time', () => {
    expect(gradualBedtime(['01:30', '01:30', '01:30'], '22:30')).toBe('01:20');
    expect(gradualBedtime(['22:35'], '22:30')).toBe('22:30');
    expect(gradualBedtime([], '22:30')).toBe('22:30');
  });
  it('builds a wind-down routine counted back from bedtime', () => {
    const steps = buildRoutine('22:40', 3);
    expect(steps.map((s) => s.at)).toEqual(['22:15', '22:20', '22:25', '22:40'].map((x, i) => (i === 0 ? '22:15' : x)));
    expect(buildRoutine('22:40', 8)[0]!.minutes).toBe(7);
  });
});
