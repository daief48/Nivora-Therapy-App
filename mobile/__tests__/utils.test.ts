import { en } from '../src/i18n/en';
import { bn } from '../src/i18n/bn';
import { translate } from '../src/i18n';
import { aggregateMoods, hasData } from '../src/utils/moods';
import type { MoodEntry } from '../src/api/types';

const NOW = new Date(2026, 9, 28, 12, 0, 0);
const mk = (daysAgo: number, mood: number, stress: number | null = null): MoodEntry => ({
  id: `${daysAgo}-${mood}`, moodScore: mood, stressScore: stress, note: null, source: 'user_reported',
  createdAt: new Date(2026, 9, 28 - daysAgo, 9, 0, 0).toISOString(),
});

describe('aggregateMoods', () => {
  it('daily: 7 buckets, averages same-day entries, leaves gaps null', () => {
    const pts = aggregateMoods([mk(0, 4, 2), mk(0, 2, 4), mk(3, 5)], 'days', NOW);
    expect(pts).toHaveLength(7);
    expect(pts[6]).toMatchObject({ mood: 3, stress: 3, count: 2 });
    expect(pts[3]).toMatchObject({ mood: 5, stress: null });
    expect(pts[0]!.mood).toBeNull();
  });
  it('weekly: 12 buckets and includes an entry 10 days old in an earlier bucket than today', () => {
    const pts = aggregateMoods([mk(0, 4), mk(10, 2)], 'weeks', NOW);
    expect(pts).toHaveLength(12);
    expect(pts[11]!.mood).toBe(4);
    expect(pts[10]!.mood).toBe(2);
  });
  it('monthly: 12 buckets, current month last', () => {
    const pts = aggregateMoods([mk(0, 5), mk(40, 1)], 'months', NOW);
    expect(pts).toHaveLength(12);
    expect(pts[11]!.mood).toBe(5);
    expect(pts[10]!.mood).toBe(1);
  });
  it('hasData reports empty correctly', () => {
    expect(hasData(aggregateMoods([], 'days', NOW))).toBe(false);
    expect(hasData(aggregateMoods([mk(0, 3)], 'days', NOW))).toBe(true);
  });
});

describe('i18n', () => {
  it('every English key has a non-empty Bangla translation with the same placeholders', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(bn[k]).toBeTruthy();
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(bn[k])).toBe(ph(en[k]));
    }
    expect(Object.keys(bn)).toHaveLength(Object.keys(en).length);
  });
  it('contains Bangla script and interpolates', () => {
    expect(translate('bn', 'emergency')).toMatch(/[ঀ-৿]/);
    expect(translate('en', 'greeting', { name: 'Ayesha' })).toBe('Hello, Ayesha');
    expect(translate('bn', 'greeting', { name: 'আয়েশা' })).toContain('আয়েশা');
  });
});
