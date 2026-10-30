import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { localDate } from '../utils/dates.js';

/**
 * (Session-derived long-term memories are not listed here: sessionContext adds the relevant ones, only with continuity on.)
 * Minimal, user-controlled context that makes the conversation feel continuous.
 * Memories and past summaries are skipped when the user switched memory off. Nothing here is a clinical profile.
 */
export async function buildWellnessContext(db: Db, cipher: Cipher, userId: string, currentSessionId?: string, opts: { includeName?: boolean } = {}): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user) return '';
  const prefs = (user.profile?.preferencesJson ?? {}) as Record<string, unknown>;
  const memoryOn = prefs.memoryEnabled !== false;
  const today = localDate(user.timezone);
  const lines: string[] = [];
  if (opts.includeName !== false && user.profile?.displayName) lines.push(`Name the user likes to be called: ${user.profile.displayName}`);

  const [checkIn, sleep, action] = await Promise.all([
    db.checkIn.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.sleepEntry.findFirst({ where: { userId }, orderBy: { date: 'desc' } }),
    db.kaizenAction.findFirst({ where: { userId, date: today }, include: { goal: true } }),
  ]);
  if (checkIn) lines.push(`Latest ${checkIn.kind.toLowerCase()} check-in (self-reported, 1-10): mood ${checkIn.mood}, stress ${checkIn.stress}, energy ${checkIn.energy}`);
  if (sleep) lines.push(`Last sleep: ${(sleep.durationMin / 60).toFixed(1)} h, rested ${sleep.rested}/10, wellness sleep score ${sleep.score}/100`);
  if (action) lines.push(`Today's Kaizen small step: "${action.title}" (status ${action.status}) toward goal "${action.goal.title}"`);

  if (memoryOn) {
    const mems = await db.memory.findMany({ where: { userId, source: 'USER' }, orderBy: { createdAt: 'desc' }, take: 8 });
    if (mems.length) lines.push('Things the user asked you to remember:\n' + mems.map((m) => `- ${cipher.decrypt(m.encryptedContent)}`).join('\n'));
    const sums = await db.sessionSummary.findMany({
      where: { session: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) } },
      orderBy: { createdAt: 'desc' }, take: 2,
    });
    if (sums.length) lines.push('Short summaries of earlier conversations:\n' + sums.map((s) => cipher.decrypt(s.encryptedSummary)).join('\n---\n'));
  }
  return lines.length ? `WELLNESS CONTEXT (use naturally, never recite it, never present it as a diagnosis):\n${lines.join('\n')}` : '';
}

/** True when the latest check-ins show high stress or low mood (used for a gentle check-in at the start of a guided session). */
export async function recentHighStress(db: Db, userId: string): Promise<boolean> {
  const rows = await db.checkIn.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 3, select: { mood: true, stress: true } });
  if (!rows.length) return false;
  const avg = (f: (r: { mood: number; stress: number }) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  return avg((r) => r.stress) >= 8 || avg((r) => r.mood) <= 3;
}
