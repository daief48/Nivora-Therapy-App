import type { Db } from '../config/database.js';
import { STEP_TITLE, pick } from './actionCopy.js';
import { buildAction, shrinkTarget, TEMPLATES, type KaizenCategory } from './kaizenEngine.js';
import { localClock } from '../utils/dates.js';

/**
 * Kaizen steps that do not come from the person's primary goal: the Emotion Reading 2-minute step, a walk or pleasant activity, the
 * session-close step, and practice completions. Each category keeps its own PAUSED goal, so a step never disturbs the primary focus, and a
 * completed step counts as a flower in the Garden like any other (gardenService counts every DONE / PARTIAL action).
 */
export const EXTRA_SOURCES = ['JOURNAL', 'WALK', 'MENU', 'SESSION_CLOSE'] as const;
export type ExtraSource = (typeof EXTRA_SOURCES)[number];
/** Goals the practice flows (routes /practice/*) already use; extras of the same category join them so one day has one action per tool. */
export const PRACTICE_GOAL_TITLE: Record<string, string> = { BREATHING: 'Breathing', GROUNDING: 'Grounding 5-4-3-2-1', REFLECTION: 'Thought record', RELAXATION: 'Sounds' };
const EXTRA_GOAL_TITLE = 'Small step';

export async function goalForCategory(db: Db, userId: string, category: string) {
  const title = PRACTICE_GOAL_TITLE[category] ?? EXTRA_GOAL_TITLE;
  const found = await db.kaizenGoal.findFirst({ where: { userId, category, title } });
  if (found) return found;
  const tpl = TEMPLATES[category as KaizenCategory];
  return db.kaizenGoal.create({ data: { userId, title, category, status: 'PAUSED', currentTarget: tpl?.start ?? 2 } });
}

export interface AddStepInput { category: string; minutes: number; source: ExtraSource; locale?: string | null; tz?: string | null; title?: string; description?: string }
/** Creates today's step for a category (idempotent: an existing action for that goal and day is returned unchanged). */
export async function addKaizenStep(db: Db, userId: string, i: AddStepInput) {
  const today = localClock(i.tz).date;
  const goal = await goalForCategory(db, userId, i.category);
  const existing = await db.kaizenAction.findUnique({ where: { goalId_date: { goalId: goal.id, date: today } } });
  if (existing) return { action: existing, created: false };
  const title = i.title ?? (STEP_TITLE[i.category] ? pick(STEP_TITLE[i.category]!, i.locale).replace('{n}', String(i.minutes)) : goal.title);
  const action = await db.kaizenAction.create({ data: {
    goalId: goal.id, userId, date: today, title: title.slice(0, 120), description: (i.description ?? '').slice(0, 300), targetValue: i.minutes, unit: 'minutes',
    difficulty: 1, source: i.source,
  } });
  return { action, created: true };
}

// ---- sleep -> today ----

/** A short night: sleep score under 55, or under 6 hours, or an hour below the person's own median (needs 5 earlier nights). */
export function isSleepLow(night: { score: number; durationMin: number }, earlierDurations: number[]): boolean {
  if (night.score < 55 || night.durationMin < 360) return true;
  if (earlierDurations.length >= 5) {
    const s = [...earlierDurations].sort((a, b) => a - b);
    const median = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
    return night.durationMin < median - 60;
  }
  return false;
}

/** Last night's sleep (the entry dated today or yesterday), or null. */
export async function lastNight(db: Db, userId: string, tz: string | null | undefined, now = new Date()) {
  const today = localClock(tz, now).date;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const night = await db.sleepEntry.findFirst({ where: { userId, date: { gte: yesterday } }, orderBy: { date: 'desc' } });
  if (!night) return null;
  const earlier = await db.sleepEntry.findMany({ where: { userId, date: { lt: night.date } }, orderBy: { date: 'desc' }, take: 14, select: { durationMin: true } });
  return { night, low: isSleepLow(night, earlier.map((e) => e.durationMin)) };
}

/**
 * After a short night, today's still-planned steps shrink once (the same "make it smaller" factor as an easier day) and the day is marked light.
 * Idempotent: a step already adapted is left alone. Never touches a step the person already did or skipped, and never the goal's own target.
 */
export async function adaptTodayForSleep(db: Db, userId: string, tz: string | null | undefined, lang: 'en' | 'bn', now = new Date()): Promise<{ lightDay: boolean; adaptedIds: string[] }> {
  const n = await lastNight(db, userId, tz, now);
  if (!n?.low) return { lightDay: false, adaptedIds: [] };
  const today = localClock(tz, now).date;
  const rows = await db.kaizenAction.findMany({ where: { userId, date: today, status: 'PLANNED', adaptedBy: null }, include: { goal: true } });
  const adaptedIds: string[] = [];
  for (const a of rows) {
    const tpl = TEMPLATES[a.goal.category as KaizenCategory];
    if (!tpl || a.micro || a.source !== 'GOAL') continue;
    const target = shrinkTarget(a.targetValue, tpl.max);
    if (target >= a.targetValue) continue;
    const text = buildAction(a.goal.category as KaizenCategory, { target, unit: a.unit as 'minutes' | 'breaths', micro: false, difficulty: a.difficulty, reason: 'sleep' }, lang);
    await db.kaizenAction.update({ where: { id: a.id }, data: { targetValue: target, title: text.title, description: text.description, adaptedBy: 'SLEEP_LOW' } });
    adaptedIds.push(a.id);
  }
  return { lightDay: true, adaptedIds };
}
