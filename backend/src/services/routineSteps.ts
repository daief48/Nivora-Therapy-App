import type { Db } from '../config/database.js';
import { fromMinutes, localClock, toMinutes } from '../utils/dates.js';
import { pick, ROUTINE_EXTRAS, ROUTINE_STEP_LABEL } from './actionCopy.js';
import { bedtimeSpread, buildRoutine, type RoutineStep } from './sleepService.js';

/**
 * Tonight's routine = the built-in wind-down steps (sleepService.buildRoutine) + extra steps added for the night (from the Sleep Coach), and which
 * steps are done. Done marks come from the person or, undoably, from a completed practice (breathing / sleep sounds in the wind-down window).
 * Everything here is rule-based: no model call.
 */
export interface RoutineExtra { id: string; minutes: number }
export const BUILTIN_STEP_IDS = ['breathing', 'reflection', 'audio'] as const;
const parseDone = (csv: string) => csv.split(',').map((x) => x.trim()).filter(Boolean);
const parseExtras = (j: unknown): RoutineExtra[] => (Array.isArray(j) ? j.filter((x): x is RoutineExtra => !!x && typeof (x as RoutineExtra).id === 'string' && typeof (x as RoutineExtra).minutes === 'number' && !!ROUTINE_EXTRAS[(x as RoutineExtra).id]) : []);

export interface RoutineStepView { id: string; at: string; kind: string; minutes: number; label: string; extra: boolean; done: boolean }

export function composeRoutine(bedtime: string, eveningStress: number | null | undefined, extras: RoutineExtra[], doneIds: string[], locale?: string | null): { steps: RoutineStepView[]; stepsDone: number; stepsTotal: number; windDownStart: string } {
  const base = buildRoutine(bedtime, eveningStress);
  const total = extras.reduce((s, e) => s + e.minutes, 0);
  let t = toMinutes(base[0]!.at) - total;
  const ex: RoutineStepView[] = extras.map((e) => {
    const at = fromMinutes(t); t += e.minutes;
    return { id: e.id, at, kind: 'extra', minutes: e.minutes, label: pick(ROUTINE_EXTRAS[e.id]!.label, locale), extra: true, done: doneIds.includes(e.id) };
  });
  const builtin: RoutineStepView[] = base.map((s: RoutineStep) => ({ id: s.id, at: s.at, kind: s.kind, minutes: s.minutes, label: pick(ROUTINE_STEP_LABEL[s.id]!, locale), extra: false, done: doneIds.includes(s.id) }));
  const steps = [...ex, ...builtin];
  const doable = steps.filter((s) => s.id !== 'sleep');
  return { steps, stepsDone: doable.filter((s) => s.done).length, stepsTotal: doable.length, windDownStart: ex[0]?.at ?? base[0]!.at };
}

export async function loadLog(db: Db, userId: string, date: string) {
  const row = await db.routineLog.findUnique({ where: { userId_date: { userId, date } } });
  return { row, doneIds: parseDone(row?.doneIds ?? ''), extras: parseExtras(row?.extras) };
}

/** Writes the done ids / extras for a night and keeps stepsDone / stepsTotal in step (the older /routine/log counters). */
export async function saveLog(db: Db, userId: string, date: string, doneIds: string[], extras: RoutineExtra[]) {
  const total = BUILTIN_STEP_IDS.length + extras.length;
  const valid = new Set<string>([...BUILTIN_STEP_IDS, ...extras.map((e) => e.id)]);
  const done = [...new Set(doneIds)].filter((x) => valid.has(x));
  const data = { doneIds: done.join(','), extras: extras as unknown as object[], stepsDone: done.length, stepsTotal: total };
  await db.routineLog.upsert({ where: { userId_date: { userId, date } }, create: { userId, date, ...data }, update: data });
  return { doneIds: done, extras };
}

/**
 * The routine date ("night date") for a local clock: before 04:00 the evening's routine is still the one in progress, so a mark made at 00:20
 * belongs to the previous calendar date's night. Everything that reads or writes a RoutineLog for "tonight" must use this date.
 */
export const NIGHT_CUTOFF_MIN = 4 * 60;
export function routineDateFor(clock: { date: string; minutes: number }): string {
  if (clock.minutes >= NIGHT_CUTOFF_MIN) return clock.date;
  return new Date(Date.parse(`${clock.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
export const routineDate = (tz?: string | null, now = new Date()) => routineDateFor(localClock(tz, now));

/**
 * Atomic read-modify-write of one night's log: the row is created if missing (ON CONFLICT DO NOTHING), locked FOR UPDATE inside a transaction,
 * and written back, so two parallel taps (a step done + another step done, or an extra added) never lose each other's update.
 */
async function mutateLog<T>(db: Db, userId: string, date: string, fn: (cur: { doneIds: string[]; extras: RoutineExtra[] }) => { doneIds: string[]; extras: RoutineExtra[]; result: T } | null): Promise<T | null> {
  return db.$transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.routineLog.createMany({ data: [{ userId, date, stepsDone: 0, stepsTotal: BUILTIN_STEP_IDS.length, doneIds: '', extras: [] }], skipDuplicates: true });
    await t.$queryRaw`SELECT "id" FROM "RoutineLog" WHERE "userId" = ${userId}::uuid AND "date" = ${date} FOR UPDATE`;
    const cur = await loadLog(t, userId, date);
    const next = fn({ doneIds: cur.doneIds, extras: cur.extras });
    if (!next) return null;
    await saveLog(t, userId, date, next.doneIds, next.extras);
    return next.result;
  });
}

export async function setStepDone(db: Db, userId: string, date: string, stepId: string, done: boolean) {
  return mutateLog(db, userId, date, ({ doneIds, extras }) => {
    const valid = [...BUILTIN_STEP_IDS as readonly string[], ...extras.map((e) => e.id)];
    if (!valid.includes(stepId)) return null;
    const next = done ? [...doneIds, stepId] : doneIds.filter((x) => x !== stepId);
    const clean = [...new Set(next)].filter((x) => valid.includes(x));
    return { doneIds: next, extras, result: { doneIds: clean, extras } };
  });
}

export async function addExtra(db: Db, userId: string, date: string, id: string) {
  const def = ROUTINE_EXTRAS[id];
  if (!def) return null;
  return mutateLog(db, userId, date, ({ doneIds, extras }) => {
    if (extras.some((e) => e.id === id)) return { doneIds, extras, result: { added: false, doneIds, extras } };
    const nextExtras = [...extras, { id, minutes: def.minutes }];
    return { doneIds, extras: nextExtras, result: { added: true, doneIds, extras: nextExtras } };
  });
}
export async function removeExtra(db: Db, userId: string, date: string, id: string) {
  return mutateLog(db, userId, date, ({ doneIds, extras }) => {
    const nextDone = doneIds.filter((x) => x !== id), nextExtras = extras.filter((e) => e.id !== id);
    return { doneIds: nextDone, extras: nextExtras, result: { doneIds: nextDone, extras: nextExtras } };
  });
}

/** Rule-based pick of ONE extra wind-down step from the person's recent diary rows (no model). */
export function coachExtraFor(rows: { latencyMin: number; awakenings: number; rested: number | null; bedtime: string }[]): string {
  if (!rows.length) return 'DIM_LIGHTS';
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  if (avg(rows.map((r) => r.latencyMin)) >= 30) return 'WRITE_WORRIES';
  if (avg(rows.map((r) => r.awakenings)) >= 2) return 'SOUNDS';
  if (bedtimeSpread(rows.map((r) => r.bedtime)) > 60) return 'PHONE_AWAY';
  const rested = rows.filter((r) => r.rested != null).map((r) => r.rested as number);
  if (rested.length && avg(rested) <= 5) return 'STRETCH';
  return 'DIM_LIGHTS';
}

/** Inside the wind-down window = from 30 min before the routine starts until 90 min after bedtime (the clock may wrap midnight). */
export function inWindDownWindow(nowMin: number, startMin: number, bedMin: number): boolean {
  const rel = (nowMin - startMin + 1440) % 1440;
  const len = (bedMin - startMin + 1440) % 1440 + 90;
  return rel <= len || rel >= 1440 - 30;
}

export const STEP_FOR_TOOL: Record<string, string> = { BREATHING: 'breathing', SOUNDS: 'audio' };

/** Tonight's bedtime for a person (their recent bedtimes nudged toward their desired one) and the latest evening stress. */
export async function tonightFor(db: Db, userId: string) {
  const [u, recent, evening] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, include: { profile: true } }),
    db.sleepEntry.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 7 }),
    db.checkIn.findFirst({ where: { userId, kind: 'EVENING' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const prefs = (u?.profile?.preferencesJson ?? {}) as Record<string, unknown>;
  const desired = typeof prefs.desiredBedtime === 'string' ? prefs.desiredBedtime : '22:30';
  return { tz: u?.timezone ?? 'UTC', locale: u?.locale ?? 'en', desired, recent, eveningStress: evening?.stress ?? null };
}
