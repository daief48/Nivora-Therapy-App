/**
 * Unit tests for NightsChart streak calculation and logic.
 */
import type { NightEntry } from '../src/components/SleepNights';

// Test streak calculation logic
function calculateStreak(entries: NightEntry[]): number {
  if (!entries.length) return 0;
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const latestDate = sorted[0].date;
  if (latestDate !== todayStr && latestDate !== yesterdayStr) {
    return 1;
  }

  let curr = new Date(latestDate);
  for (let i = 0; i < sorted.length; i++) {
    const entryDate = new Date(sorted[i].date);
    const diffDays = Math.round((curr.getTime() - entryDate.getTime()) / 86400000);
    if (diffDays <= 1) {
      streak++;
      curr = entryDate;
    } else {
      break;
    }
  }
  return Math.max(1, streak);
}

describe('calculateStreak', () => {
  it('returns 0 for empty entries', () => {
    expect(calculateStreak([])).toBe(0);
  });

  it('returns at least 1 for isolated past entry', () => {
    const entries: NightEntry[] = [
      { id: '1', date: '2025-01-01', bedtime: '23:00', wakeTime: '07:00', durationMin: 480, rested: 8, note: null, awakenings: 0, score: 80, latencyMin: 15 },
    ];
    expect(calculateStreak(entries)).toBe(1);
  });

  it('counts consecutive consecutive days', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);

    const entries: NightEntry[] = [
      { id: '1', date: today, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, rested: 8, note: null, awakenings: 0, score: 80, latencyMin: 15 },
      { id: '2', date: yesterday, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, rested: 8, note: null, awakenings: 0, score: 80, latencyMin: 15 },
      { id: '3', date: twoDaysAgo, bedtime: '23:00', wakeTime: '07:00', durationMin: 480, rested: 8, note: null, awakenings: 0, score: 80, latencyMin: 15 },
    ];
    expect(calculateStreak(entries)).toBe(3);
  });
});

