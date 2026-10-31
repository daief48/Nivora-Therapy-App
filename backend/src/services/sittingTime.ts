import type { Db } from '../config/database.js';

/**
 * Active-time accounting for program sittings. A sitting is "used up" only after its full planned minutes of ACTIVE time, not when a
 * wall-clock deadline passes: leaving the chat just pauses it. Time is added by touchSitting on every sign of presence (messages, replies,
 * the app's state poll, relay pings). Time with no sign of presence is never counted beyond TICK_CAP_SEC per touch.
 */
export const TICK_CAP_SEC = 60;
/** Gap since the last sign of presence after which the model is told the person stepped away. */
export const RESUME_GAP_MS = 5 * 60_000;

type Timed = { plannedMinutes?: number | null; usedSeconds?: number | null };

/** Seconds of active time left in the sitting's time box; null = no time box (legacy sessions). */
export const sittingRemainingSec = (s: Timed): number | null =>
  (s.plannedMinutes ?? 0) > 0 ? Math.max(0, s.plannedMinutes! * 60 - (s.usedSeconds ?? 0)) : null;

/** True once a program sitting has used its full planned active time. Legacy sessions (no time box) are never "used up". */
export const sittingUsedUp = (s: Timed): boolean => sittingRemainingSec(s) === 0;

/**
 * Adds min(now - lastActivityAt, TICK_CAP_SEC) seconds to usedSeconds and moves lastActivityAt to now. Only for ACTIVE program sittings
 * (others are left alone). Safe under concurrent calls: the write only applies if lastActivityAt is still the value that was read, so
 * the same interval is never counted twice. Returns the state before and after, or null when nothing applies. Never throws.
 */
export async function touchSitting(db: Db, sessionId: string, now = new Date()): Promise<{ usedSeconds: number; previousActivityAt: Date } | null> {
  try {
    const s = await db.therapySession.findUnique({ where: { id: sessionId }, select: { status: true, programId: true, usedSeconds: true, lastActivityAt: true } });
    if (!s || s.status !== 'ACTIVE' || !s.programId) return null;
    const gapSec = Math.floor((now.getTime() - s.lastActivityAt.getTime()) / 1000);
    if (gapSec < 0) return { usedSeconds: s.usedSeconds, previousActivityAt: s.lastActivityAt }; // clock went backwards: count nothing
    const delta = Math.min(gapSec, TICK_CAP_SEC);
    const r = await db.therapySession.updateMany({
      where: { id: sessionId, status: 'ACTIVE', lastActivityAt: s.lastActivityAt },
      data: { usedSeconds: { increment: delta }, lastActivityAt: now },
    });
    return { usedSeconds: s.usedSeconds + (r.count ? delta : 0), previousActivityAt: s.lastActivityAt };
  } catch { return null; }
}
