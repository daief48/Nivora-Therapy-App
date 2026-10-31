import type { Db } from '../config/database.js';
import type { Season } from './wellnessCopy.js';

/** Season of the garden from the average mood (1..10) of the last 30 days. Purely decorative; no data means a gentle spring. */
export function seasonFromMood(avg: number | null): Season {
  if (avg == null) return 'SPRING';
  if (avg >= 7) return 'SUMMER';
  if (avg >= 5.5) return 'SPRING';
  if (avg >= 4) return 'AUTUMN';
  return 'WINTER';
}

export const DONE_STATUSES = ['DONE', 'PARTIAL'];

/** Flowers shown = completed actions + flowers carried over from deleted goals. Never decreases. */
export async function flowerTotal(db: Db, userId: string): Promise<{ total: number; counted: number; carried: number }> {
  const [counted, st] = await Promise.all([
    db.kaizenAction.count({ where: { userId, status: { in: DONE_STATUSES } } }),
    db.gardenState.findUnique({ where: { userId } }),
  ]);
  const carried = st?.carried ?? 0;
  return { total: counted + carried, counted, carried };
}

/** Call BEFORE deleting a goal: its completed steps stay in the garden as carried flowers. */
export async function retainGoalFlowers(db: Db, userId: string, goalId: string) {
  const n = await db.kaizenAction.count({ where: { userId, goalId, status: { in: DONE_STATUSES } } });
  if (n > 0) await db.gardenState.upsert({ where: { userId }, create: { userId, carried: n }, update: { carried: { increment: n } } });
}
