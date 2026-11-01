/**
 * Unit tests for Kaizen Programs integration logic.
 */
import type { ProgramSummary } from '../src/screens/ProgramsScreen';

function findActiveProgram(programs: ProgramSummary[]): ProgramSummary | undefined {
  return programs.find((p) => p.status === 'ACTIVE' && p.enrolled);
}

function calculateProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

describe('Kaizen Programs integration logic', () => {
  const samplePrograms: ProgramSummary[] = [
    {
      id: 'stress-7',
      days: 7,
      title: '7 দিনের চাপ সামলানোর কৌশল',
      description: 'স্ট্রেস কমানোর উপায়',
      safety: '',
      enrolled: false,
      status: null,
      completedDays: [],
      completedCount: 0,
      unlockedDay: 1,
      nextDay: 1,
    },
    {
      id: 'anxiety-14',
      days: 14,
      title: '14 দিনের দুশ্চিন্তা ও এড়িয়ে চলা',
      description: 'উদ্বেগ মোকাবিলা',
      safety: '',
      enrolled: true,
      status: 'ACTIVE',
      completedDays: [1],
      completedCount: 1,
      unlockedDay: 2,
      nextDay: 2,
    },
    {
      id: 'cbti-21',
      days: 21,
      title: '21 দিনের ঘুমের অভ্যাস',
      description: 'সিবিটি-আই স্লিপ ট্রেনিং',
      safety: '',
      enrolled: true,
      status: 'COMPLETED',
      completedDays: Array.from({ length: 21 }, (_, i) => i + 1),
      completedCount: 21,
      unlockedDay: 21,
      nextDay: null,
    },
  ];

  it('detects active enrolled program correctly for the Kaizen spotlight banner', () => {
    const active = findActiveProgram(samplePrograms);
    expect(active).toBeDefined();
    expect(active?.id).toBe('anxiety-14');
    expect(active?.completedCount).toBe(1);
  });

  it('returns undefined when no active enrolled program exists', () => {
    const inactivePrograms = samplePrograms.filter((p) => p.status !== 'ACTIVE');
    expect(findActiveProgram(inactivePrograms)).toBeUndefined();
  });

  it('calculates progress percentage correctly', () => {
    expect(calculateProgressPercent(1, 14)).toBe(7);
    expect(calculateProgressPercent(7, 14)).toBe(50);
    expect(calculateProgressPercent(14, 14)).toBe(100);
    expect(calculateProgressPercent(0, 7)).toBe(0);
    expect(calculateProgressPercent(0, 0)).toBe(0);
  });
});

