import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { addDays, localDate } from '../utils/dates.js';
import { AppError, notFound } from '../utils/errors.js';
import type { GlmClient } from './glmClient.js';
import { finalizeSession } from './sessionSummarizer.js';
import { continuityEnabled, EMPTY_NOTE, getActivePlan, type NoteContent } from './therapyData.js';
import { sittingRemainingSec, sittingUsedUp } from './sittingTime.js';
import { unpackTopic } from './topicService.js';

/** Program ("Session" in the UI) logic: the user's local calendar day, sitting numbering, today's state, timeline and completion. */
export type TodayState = 'READY' | 'IN_PROGRESS' | 'DONE_TODAY' | 'PAUSED' | 'COMPLETED';
export interface ProgramDeps { db: Db; cipher: Cipher; glm: GlmClient }

const MIN_MS = 60_000;
export const REVIEW_SUMMARY_MAX = 200;

/** An unfinished sitting nobody touched for this long is given up (finalized as ABANDONED by the next start or the idle sweep). */
export const STALE_SITTING_MS = 3 * 86_400_000;
export { sittingRemainingSec };

/** When the sitting would run out if the person kept going from `now` (now + remaining active time); null = no time box (legacy sessions). */
export const sittingEndsAt = (s: { plannedMinutes: number; usedSeconds?: number | null }, now = new Date()): Date | null => {
  const rem = sittingRemainingSec(s);
  return rem === null ? null : new Date(now.getTime() + rem * 1000);
};

/** Offset (ms) of an IANA zone from UTC at an instant. Falls back to UTC for an unknown zone. */
function tzOffsetMs(tz: string, at: Date): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(at.getTime() / 1000) * 1000;
  } catch { return 0; }
}

/** The instant a local calendar day (YYYY-MM-DD) begins in a zone. Two passes handle DST shifts. */
export function startOfLocalDay(tz: string, date: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t));
  return new Date(t);
}
/** When the next local day begins (= when the next sitting becomes available). */
export const nextLocalDayStart = (tz: string, at: Date): Date => startOfLocalDay(tz, addDays(localDate(tz, at), 1));

export async function userTimezone(db: Db, userId: string): Promise<string> {
  return (await db.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone || 'UTC';
}

export async function ownedProgram(db: Db, userId: string, id: string) {
  const p = await db.sessionProgram.findFirst({ where: { id, userId }, include: { topic: true } });
  if (!p) throw notFound('Program not found'); // same answer for "not yours" and "doesn't exist"
  return p;
}

type Sitting = { id: string; status: string; startedAt: Date; endedAt: Date | null; finalizedAt: Date | null; dayNumber: number | null; plannedMinutes: number; usedSeconds: number; lastActivityAt: Date; moodBefore: number | null; moodAfter: number | null };
const SITTING_SELECT = { id: true, status: true, startedAt: true, endedAt: true, finalizedAt: true, dayNumber: true, plannedMinutes: true, usedSeconds: true, lastActivityAt: true, moodBefore: true, moodAfter: true } as const;
/** Does this sitting count as the program's sitting for local day `day`? Started that day, or finished that day (a paused sitting finished the next day is that day's). A sitting given up long after its last activity does not. */
const countsFor = (tz: string, s: Pick<Sitting, 'startedAt' | 'endedAt' | 'lastActivityAt'>, day: string) =>
  localDate(tz, s.startedAt) === day || (!!s.endedAt && localDate(tz, s.endedAt) === day && localDate(tz, s.lastActivityAt) === day);
/** Minutes a finished sitting took: active time when it was tracked, else the wall-clock span (older rows). */
const sittingDurationMin = (s: Pick<Sitting, 'startedAt' | 'endedAt' | 'usedSeconds'>): number | null =>
  s.usedSeconds > 0 ? Math.max(1, Math.round(s.usedSeconds / 60)) : s.endedAt ? Math.max(1, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / MIN_MS)) : null;

/** A finished day: ended and its note produced (finalizeSession is idempotent and always sets finalizedAt). */
export const isCompleted = (s: Pick<Sitting, 'status' | 'finalizedAt'>) => s.status === 'ENDED' && s.finalizedAt !== null;

/** Ends a sitting that ran out of time / was left behind. An empty one is removed so it does not count as a day. */
export async function closeSitting(d: ProgramDeps, sittingId: string, reason: 'IDLE' | 'ABANDONED'): Promise<void> {
  const s = await d.db.therapySession.findUnique({ where: { id: sittingId }, select: { id: true, status: true, riskFlag: true, _count: { select: { messages: true } } } });
  if (!s) return;
  if (s._count.messages === 0 && s.riskFlag === 'NONE') { await d.db.therapySession.delete({ where: { id: s.id } }).catch(() => undefined); return; }
  await finalizeSession(d, s.id, reason);
}

/** Program becomes COMPLETED once plannedDays sittings are finished. Safe to call at any time. */
export async function refreshProgramCompletion(db: Db, programId: string | null | undefined): Promise<void> {
  if (!programId) return;
  const p = await db.sessionProgram.findUnique({ where: { id: programId }, select: { plannedDays: true, status: true } });
  if (!p || p.status !== 'ACTIVE') return;
  const done = await db.therapySession.count({ where: { programId, status: 'ENDED', finalizedAt: { not: null } } });
  if (done >= p.plannedDays) await db.sessionProgram.updateMany({ where: { id: programId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: new Date() } });
}

export interface ProgramRow {
  id: string; userId: string; topicId: string | null; titleEncrypted: string; goalEncrypted: string | null; plannedDays: number; dailyMinutes: number;
  reminderTimeMin: number | null; status: string; startedAt: Date; lastSittingAt: Date | null; completedAt: Date | null; topic?: { id: string; encryptedContent: string } | null;
}

export async function programView(d: ProgramDeps, p: ProgramRow, tz: string, now = new Date(), detail = false, modes: SittingMode[] = ['TEXT']) {
  await refreshProgramCompletion(d.db, p.id);
  const fresh = await d.db.sessionProgram.findUnique({ where: { id: p.id }, select: { status: true, completedAt: true } });
  const status = fresh?.status ?? p.status;
  const sittings: Sitting[] = await d.db.therapySession.findMany({ where: { programId: p.id }, orderBy: { startedAt: 'asc' }, select: SITTING_SELECT });
  const done = sittings.filter(isCompleted);
  const today = localDate(tz, now);
  // An unfinished sitting (any day, not yet given up) is the one to resume; it stays open until finished.
  const active = sittings.find((s) => s.status === 'ACTIVE' && now.getTime() - s.lastActivityAt.getTime() < STALE_SITTING_MS);
  const endedToday = sittings.some((s) => s.status === 'ENDED' && countsFor(tz, s, today));
  let todayState: TodayState;
  if (status === 'COMPLETED') todayState = 'COMPLETED';
  else if (status !== 'ACTIVE') todayState = 'PAUSED'; // PAUSED and ARCHIVED cannot start a sitting
  else if (active) todayState = 'IN_PROGRESS';
  else if (endedToday) todayState = 'DONE_TODAY';
  else todayState = 'READY';

  const topic = p.topic ? { id: p.topic.id, kind: unpackTopic(d.cipher, p.topic.encryptedContent).kind, label: unpackTopic(d.cipher, p.topic.encryptedContent).label } : null;
  const completedSittings = done.length;
  const base = {
    id: p.id, title: d.cipher.decrypt(p.titleEncrypted), goal: p.goalEncrypted ? d.cipher.decrypt(p.goalEncrypted) : null, topic, status,
    plannedDays: p.plannedDays, dailyMinutes: p.dailyMinutes, reminderTimeMin: p.reminderTimeMin, completedSittings,
    currentDay: Math.min(p.plannedDays, completedSittings + 1), progressPct: Math.round((100 * Math.min(completedSittings, p.plannedDays)) / p.plannedDays),
    todayState, nextAvailableAt: todayState === 'DONE_TODAY' ? nextLocalDayStart(tz, now).toISOString() : null,
    lastSittingAt: p.lastSittingAt, moodTrend: done.map((s) => ({ day: s.dayNumber, moodBefore: s.moodBefore, moodAfter: s.moodAfter })),
    remainingSec: active ? sittingRemainingSec(active) : null, usedMinutes: active ? Math.floor(active.usedSeconds / 60) : null,
    availableModes: modes, startedAt: p.startedAt, activeSittingId: active?.id ?? null, completedAt: fresh?.completedAt ?? p.completedAt,
  };
  if (!detail) return base;

  // Notes are only ever read for sittings the user let the app remember.
  const noteRows = await d.db.sessionNote.findMany({ where: { session: { programId: p.id, rememberThis: true } }, select: { sessionId: true, encryptedContent: true } });
  const notes = new Map<string, NoteContent>();
  for (const n of noteRows) { try { notes.set(n.sessionId, { ...EMPTY_NOTE, ...(JSON.parse(d.cipher.decrypt(n.encryptedContent)) as Partial<NoteContent>) }); } catch { /* unreadable note: skip */ } }
  const timeline: { dayNumber: number; date: string | null; status: 'DONE' | 'TODAY' | 'UPCOMING' | 'SKIPPED'; sittingId: string | null; durationMin: number | null; usedMinutes: number | null; plannedMinutes: number | null; moodBefore: number | null; moodAfter: number | null; shortSummary: string | null }[] = [];
  for (let n = 1; n <= p.plannedDays; n++) {
    const s = done.find((x) => x.dayNumber === n);
    if (s) {
      const sum = notes.get(s.id)?.summary || null;
      timeline.push({
        dayNumber: n, date: localDate(tz, s.startedAt), status: 'DONE', sittingId: s.id,
        durationMin: sittingDurationMin(s), usedMinutes: Math.floor(s.usedSeconds / 60), plannedMinutes: s.plannedMinutes || null,
        moodBefore: s.moodBefore, moodAfter: s.moodAfter, shortSummary: sum && sum.length > REVIEW_SUMMARY_MAX ? sum.slice(0, REVIEW_SUMMARY_MAX - 1).trimEnd() + '…' : sum,
      });
    } else if (n === completedSittings + 1 && (todayState === 'READY' || todayState === 'IN_PROGRESS')) {
      timeline.push({ dayNumber: n, date: today, status: 'TODAY', sittingId: active?.id ?? null, durationMin: null,
        usedMinutes: active ? Math.floor(active.usedSeconds / 60) : null, plannedMinutes: active ? active.plannedMinutes || null : p.dailyMinutes, moodBefore: active?.moodBefore ?? null, moodAfter: null, shortSummary: null });
    } else {
      timeline.push({ dayNumber: n, date: null, status: 'UPCOMING', sittingId: null, durationMin: null, usedMinutes: null, plannedMinutes: null, moodBefore: null, moodAfter: null, shortSummary: null });
    }
  }
  const freq = new Map<string, number>();
  for (const sc of done) for (const t of notes.get(sc.id)?.themes ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  const themes = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);

  const ids = sittings.map((s) => s.id);
  const hw = ids.length ? await d.db.homework.findMany({ where: { userId: p.userId, sessionId: { in: ids }, status: 'ASSIGNED' }, orderBy: { createdAt: 'desc' }, take: 10 }) : [];
  const openHomework = hw.map((h) => ({ id: h.id, title: d.cipher.decrypt(h.titleEncrypted), dueDate: h.dueDate }));
  const planGoals = (await continuityEnabled(d.db, p.userId)) ? ((await getActivePlan(d.db, d.cipher, p.userId))?.plan.goals ?? []).map((g) => ({ id: g.id, title: g.title })) : [];
  return { ...base, timeline, themes, openHomework, planGoals };
}

export type SittingMode = 'TEXT' | 'VOICE' | 'VIDEO';
export const SITTING_MODES = ['TEXT', 'VOICE', 'VIDEO'] as const;
type ModeFlags = { VOICE_ENABLED: string; VIDEO_ENABLED: string };
/** Modes a sitting may use right now (TEXT always). VIDEO is a voice call with an avatar, so it also needs voice. */
export const availableModes = (c: ModeFlags): SittingMode[] => [
  'TEXT', ...(c.VOICE_ENABLED === '1' ? ['VOICE' as const] : []), ...(c.VOICE_ENABLED === '1' && c.VIDEO_ENABLED === '1' ? ['VIDEO' as const] : []),
];
/** Throws 400 MODE_DISABLED when the mode is off. Server-side VIDEO is a VOICE session. */
export function resolveMode(c: ModeFlags, mode: SittingMode): 'TEXT' | 'VOICE' {
  if (!availableModes(c).includes(mode)) throw new AppError(400, 'MODE_DISABLED', `${mode === 'VIDEO' ? 'Video' : 'Voice'} sessions are not available`);
  return mode === 'TEXT' ? 'TEXT' : 'VOICE';
}

export interface StartOptions { language?: string; moodBefore?: number; rememberThis?: boolean; sessionType?: 'TEXT' | 'VOICE'; /** the mode the user chose (VIDEO stored as VOICE); kept for Kaizen goal origins */ modeRequested?: 'TEXT' | 'VOICE' | 'VIDEO' }

/** Starts today's sitting. All rules live here so POST /programs/:id/sittings and POST /sessions {programId} behave identically. */
export async function startSitting(d: ProgramDeps, userId: string, programId: string, opts: StartOptions = {}, now = new Date()) {
  const program = await ownedProgram(d.db, userId, programId);
  if (program.status !== 'ACTIVE') throw new AppError(409, 'PROGRAM_NOT_ACTIVE', 'This session is not active');
  const tz = await userTimezone(d.db, userId);
  const today = localDate(tz, now);

  // An unfinished sitting is RESUMED, whatever day it was started on: leaving only paused it. Given-up (stale) and used-up ones are closed first.
  const existing = await d.db.therapySession.findMany({ where: { programId, status: 'ACTIVE' }, orderBy: { startedAt: 'asc' }, include: { topic: true } });
  let resumable: (typeof existing)[number] | null = null;
  for (const s of existing) {
    if (now.getTime() - s.lastActivityAt.getTime() >= STALE_SITTING_MS) await closeSitting(d, s.id, 'ABANDONED');
    else if (sittingUsedUp(s)) await closeSitting(d, s.id, 'IDLE'); // the full time was used: it is a finished day
    else if (!resumable) resumable = s;
  }
  if (resumable) {
    // The requested mode applies as in the mode endpoint; a first mood check-in is kept if there was none yet.
    const data = { ...(opts.sessionType && opts.sessionType !== resumable.sessionType ? { sessionType: opts.sessionType } : {}), ...(opts.modeRequested && opts.modeRequested !== (resumable.modeRequested ?? resumable.sessionType) ? { modeRequested: opts.modeRequested } : {}), ...(opts.moodBefore && !resumable.moodBefore ? { moodBefore: opts.moodBefore } : {}) };
    const row = Object.keys(data).length ? await d.db.therapySession.update({ where: { id: resumable.id }, data, include: { topic: true } }) : resumable;
    return { ...row, resumed: true as const };
  }
  const sittings = await d.db.therapySession.findMany({ where: { programId, status: 'ENDED' }, select: { startedAt: true, endedAt: true, lastActivityAt: true, finalizedAt: true, status: true } });
  if (sittings.some((s) => countsFor(tz, s, today))) {
    throw new AppError(409, 'ALREADY_DONE_TODAY', 'You already had today\'s sitting. The next one opens tomorrow.', { nextAvailableAt: nextLocalDayStart(tz, now).toISOString() });
  }
  const completed = sittings.filter(isCompleted).length;
  if (completed >= program.plannedDays) {
    await refreshProgramCompletion(d.db, programId);
    throw new AppError(409, 'PROGRAM_NOT_ACTIVE', 'This session is already complete');
  }
  const dayNumber = completed + 1;
  const user = await d.db.user.findUnique({ where: { id: userId }, select: { locale: true } });
  const language = opts.language ?? (await d.db.therapySession.findFirst({ where: { programId }, orderBy: { startedAt: 'desc' }, select: { language: true } }))?.language ?? user?.locale ?? 'en';

  // One transaction + advisory lock per program so a double tap cannot open two sittings.
  return d.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${programId}))`;
    const dup = await tx.therapySession.findFirst({ where: { programId, OR: [{ status: 'ACTIVE' }, { startedAt: { gte: startOfLocalDay(tz, today) } }, { endedAt: { gte: startOfLocalDay(tz, today) }, lastActivityAt: { gte: startOfLocalDay(tz, today) } }] }, select: { id: true, status: true } });
    if (dup) {
      // Only reachable when two starts race; the loser gets the same answer a double tap always got.
      if (dup.status === 'ACTIVE') throw new AppError(409, 'SITTING_ALREADY_ACTIVE', 'Today\'s sitting is already open', { sittingId: dup.id });
      throw new AppError(409, 'ALREADY_DONE_TODAY', 'You already had today\'s sitting. The next one opens tomorrow.', { nextAvailableAt: nextLocalDayStart(tz, now).toISOString() });
    }
    const s = await tx.therapySession.create({
      data: {
        userId, programId, topicId: program.topicId, dayNumber, plannedMinutes: program.dailyMinutes, lengthMin: program.dailyMinutes, isIntake: dayNumber <= 2,
        sessionType: opts.sessionType ?? 'TEXT', modeRequested: opts.modeRequested ?? opts.sessionType ?? 'TEXT', language, startedAt: now, lastActivityAt: now, ...(opts.moodBefore ? { moodBefore: opts.moodBefore } : {}), ...(opts.rememberThis === false ? { rememberThis: false } : {}),
      },
      include: { topic: true },
    });
    await tx.sessionProgram.update({ where: { id: programId }, data: { lastSittingAt: now } });
    return { ...s, resumed: false as const };
  });
}
