import { createHash } from 'node:crypto';
import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';

/** Shared typed access to guided-session data. All free text is encrypted at rest; callers never touch the encrypted columns directly. */
export type Approach = 'CBT' | 'MI' | 'ACT' | 'MIXED';
export interface PlanContent {
  goals: { id: string; title: string; note?: string }[];
  focusAreas: string[]; approach: Approach; pace: 'GENTLE' | 'STEADY'; tone: 'WARM' | 'DIRECT';
  language: 'en' | 'bn' | 'hi' | 'ne' | 'mixed'; background?: string; whatHelps?: string; whatDoesnt?: string;
}
export interface NoteContent {
  summary: string; progressNote: string; agenda: string[]; themes: string[]; techniques: string[];
  keyInsights: string[]; unresolved: string[]; homework: string[];
}
export interface StoredNote { sessionId: string; createdAt: Date; startedAt: Date; moodBefore: number | null; moodAfter: number | null; content: NoteContent }
export interface HomeworkItem { id: string; sessionId: string | null; title: string; dueDate: string | null; status: string; feedback: string | null; createdAt: Date }
export interface ThemeItem { id: string; label: string; count: number; lastSeenAt: Date }

export const EMPTY_NOTE: NoteContent = { summary: '', progressNote: '', agenda: [], themes: [], techniques: [], keyInsights: [], unresolved: [], homework: [] };

export const themeKeyOf = (userId: string, label: string) =>
  createHash('sha256').update(userId + ':' + label.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');

/** Continuity is opt-in: profile.preferencesJson.continuityOptIn === true. */
export async function continuityEnabled(db: Db, userId: string): Promise<boolean> {
  const p = await db.userProfile.findUnique({ where: { userId }, select: { preferencesJson: true } });
  return ((p?.preferencesJson ?? {}) as Record<string, unknown>).continuityOptIn === true;
}

export async function getActivePlan(db: Db, cipher: Cipher, userId: string): Promise<{ version: number; plan: PlanContent } | null> {
  const row = await db.treatmentPlan.findFirst({ where: { userId, active: true }, orderBy: { version: 'desc' } });
  return row ? { version: row.version, plan: JSON.parse(cipher.decrypt(row.encryptedContent)) as PlanContent } : null;
}

/** Writes a NEW version and deactivates the previous ones (history is kept). */
export async function savePlan(db: Db, cipher: Cipher, userId: string, plan: PlanContent): Promise<number> {
  const last = await db.treatmentPlan.findFirst({ where: { userId }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  await db.$transaction([
    db.treatmentPlan.updateMany({ where: { userId, active: true }, data: { active: false } }),
    db.treatmentPlan.create({ data: { userId, version, active: true, encryptedContent: cipher.encrypt(JSON.stringify(plan)) } }),
  ]);
  return version;
}

/** Newest notes first. Only sessions the user allowed to be remembered, only when continuity is on. */
export async function getRecentNotes(db: Db, cipher: Cipher, userId: string, n: number, excludeSessionId?: string): Promise<StoredNote[]> {
  if (!(await continuityEnabled(db, userId))) return [];
  const rows = await db.sessionNote.findMany({
    where: { userId, session: { rememberThis: true, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) } },
    orderBy: { createdAt: 'desc' }, take: n, include: { session: { select: { startedAt: true, moodBefore: true, moodAfter: true } } },
  });
  return rows.map((r) => ({
    sessionId: r.sessionId, createdAt: r.createdAt, startedAt: r.session.startedAt, moodBefore: r.session.moodBefore, moodAfter: r.session.moodAfter,
    content: { ...EMPTY_NOTE, ...(JSON.parse(cipher.decrypt(r.encryptedContent)) as Partial<NoteContent>) },
  }));
}

export async function getHomework(db: Db, cipher: Cipher, userId: string, status?: string): Promise<HomeworkItem[]> {
  const rows = await db.homework.findMany({ where: { userId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((h) => ({
    id: h.id, sessionId: h.sessionId, title: cipher.decrypt(h.titleEncrypted), dueDate: h.dueDate, status: h.status,
    feedback: h.feedbackEncrypted ? cipher.decrypt(h.feedbackEncrypted) : null, createdAt: h.createdAt,
  }));
}

export async function getTopThemes(db: Db, cipher: Cipher, userId: string, n = 6): Promise<ThemeItem[]> {
  if (!(await continuityEnabled(db, userId))) return [];
  const rows = await db.themeTracker.findMany({ where: { userId }, orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }], take: n });
  return rows.map((t) => ({ id: t.id, label: cipher.decrypt(t.labelEncrypted), count: t.count, lastSeenAt: t.lastSeenAt }));
}

/** Upserts one theme occurrence per session. */
export async function bumpTheme(db: Db, cipher: Cipher, userId: string, label: string): Promise<void> {
  const clean = label.trim().slice(0, 80);
  if (!clean) return;
  const themeKey = themeKeyOf(userId, clean);
  await db.themeTracker.upsert({
    where: { userId_themeKey: { userId, themeKey } },
    create: { userId, themeKey, labelEncrypted: cipher.encrypt(clean) },
    update: { count: { increment: 1 }, lastSeenAt: new Date() },
  });
}
