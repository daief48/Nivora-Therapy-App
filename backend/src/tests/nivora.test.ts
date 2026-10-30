import { describe, expect, it } from 'vitest';
import { growthStage, planNext, type HistoryItem } from '../services/kaizenEngine.js';
import { buildRoutine, bedtimeSpread, durationMinutes, gradualBedtime, sleepScore } from '../services/sleepService.js';

const h = (date: string, status: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  date, status, targetValue: 2, micro: false, difficultyFeedback: null, nextPreference: null, ...over,
});

describe('Kaizen engine', () => {
  it('starts at the goal target with no history', () => {
    expect(planNext('BREATHING', 2, [], '2026-10-30')).toMatchObject({ target: 2, micro: false });
  });
  it('grows by one step after an easy completion', () => {
    expect(planNext('BREATHING', 2, [h('2026-10-29', 'DONE', { difficultyFeedback: 'EASY' })], '2026-10-30').target).toBe(3);
  });
  it('keeps the target when it was hard but done', () => {
    expect(planNext('JOURNALING', 3, [h('2026-10-29', 'DONE', { targetValue: 3, difficultyFeedback: 'HARD' })], '2026-10-30').target).toBe(3);
  });
  it('shrinks after partial completion or overwhelm', () => {
    expect(planNext('SHORT_WALK', 10, [h('2026-10-29', 'PARTIAL', { targetValue: 10 })], '2026-10-30').target).toBe(7);
    expect(planNext('SHORT_WALK', 10, [h('2026-10-29', 'DONE', { targetValue: 10, difficultyFeedback: 'OVERWHELMED' })], '2026-10-30').target).toBe(6);
  });
  it('turns into a tiny restart after two skipped days, without shaming', () => {
    const p = planNext('BREATHING', 5, [h('2026-10-29', 'SKIPPED', { targetValue: 5 }), h('2026-10-28', 'SKIPPED', { targetValue: 5 })], '2026-10-30');
    expect(p).toMatchObject({ micro: true, unit: 'breaths', target: 3 });
  });
  it('restarts after a long gap even if nothing was recorded', () => {
    expect(planNext('GRATITUDE', 4, [h('2026-10-20', 'DONE', { targetValue: 4 })], '2026-10-30').micro).toBe(true);
  });
  it('eases back in after a successful restart', () => {
    const p = planNext('JOURNALING', 6, [h('2026-10-29', 'DONE', { micro: true, targetValue: 1 })], '2026-10-30');
    expect(p.micro).toBe(false);
    expect(p.target).toBe(4);
  });
  it('the user wish after reflection wins', () => {
    expect(planNext('MEDITATION', 4, [h('2026-10-29', 'DONE', { targetValue: 4, difficultyFeedback: 'EASY', nextPreference: 'SAME' })], '2026-10-30').target).toBe(4);
    expect(planNext('MEDITATION', 4, [h('2026-10-29', 'DONE', { targetValue: 4, nextPreference: 'EASIER' })], '2026-10-30').target).toBe(3);
  });
  it('growth stages are non-competitive milestones', () => {
    expect([0, 3, 10, 25].map(growthStage)).toEqual(['SEED', 'GROWING', 'GROWING_STRONG', 'FLOURISHING']);
  });
});

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
