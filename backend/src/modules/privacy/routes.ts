import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { unauthorized } from '../../utils/errors.js';
import { createAuthService } from '../auth/authService.js';
import type { Deps } from '../deps.js';

export function privacyRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const auth = createAuthService(d.db, d.config, d.mailer);

  // Full export of the user's own data, decrypted. Sent only to the authenticated owner.
  r.post('/export', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const dec = (s: string | null) => (s ? d.cipher.decrypt(s) : null);
    const [user, consents, sessions, moods, journal, goals, usage, checkIns, sleep, kaizen, memories] = await Promise.all([
      d.db.user.findUnique({ where: { id: uid }, include: { profile: true } }),
      d.db.userConsent.findMany({ where: { userId: uid } }),
      d.db.therapySession.findMany({ where: { userId: uid }, include: { messages: { orderBy: { createdAt: 'asc' } }, summary: true } }),
      d.db.moodEntry.findMany({ where: { userId: uid } }),
      d.db.journalEntry.findMany({ where: { userId: uid, deletedAt: null } }),
      d.db.therapyGoal.findMany({ where: { userId: uid }, include: { checkIns: true } }),
      d.db.usageRecord.findMany({ where: { userId: uid } }),
      d.db.checkIn.findMany({ where: { userId: uid } }),
      d.db.sleepEntry.findMany({ where: { userId: uid } }),
      d.db.kaizenAction.findMany({ where: { userId: uid }, include: { goal: true } }),
      d.db.memory.findMany({ where: { userId: uid } }),
    ]);
    await d.db.auditLog.create({ data: { actorId: uid, action: 'DATA_EXPORT', resourceType: 'User' } });
    res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
    res.json({ data: {
      exportedAt: new Date(), account: { id: user?.id, email: user?.email, locale: user?.locale, timezone: user?.timezone, createdAt: user?.createdAt, profile: user?.profile },
      consents,
      sessions: sessions.map((s) => ({
        id: s.id, sessionType: s.sessionType, language: s.language, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt,
        messages: s.messages.map((m) => ({ role: m.role, content: dec(m.encryptedContent), createdAt: m.createdAt })),
        summary: dec(s.summary?.encryptedSummary ?? null),
      })),
      moods: moods.map((m) => ({ moodScore: m.moodScore, stressScore: m.stressScore, note: dec(m.optionalNoteEncrypted), createdAt: m.createdAt })),
      journal: journal.map((j) => ({ entryType: j.entryType, content: dec(j.encryptedContent), createdAt: j.createdAt, updatedAt: j.updatedAt })),
      goals: goals.map((g) => ({ title: g.title, status: g.status, targetDate: g.targetDate, checkIns: g.checkIns.map((c) => ({ progressValue: c.progressValue, note: dec(c.optionalEncryptedNotes), createdAt: c.createdAt })) })),
      checkIns: checkIns.map((c) => ({ kind: c.kind, mood: c.mood, stress: c.stress, energy: c.energy, sleepQuality: c.sleepQuality, rested: c.rested, worry: dec(c.worryEncrypted), note: dec(c.noteEncrypted), createdAt: c.createdAt })),
      sleep: sleep.map((s) => ({ date: s.date, bedtime: s.bedtime, wakeTime: s.wakeTime, durationMin: s.durationMin, latencyMin: s.latencyMin, awakenings: s.awakenings, rested: s.rested, score: s.score, note: dec(s.noteEncrypted) })),
      kaizen: kaizen.map((a) => ({ goal: a.goal.title, date: a.date, title: a.title, status: a.status, targetValue: a.targetValue, unit: a.unit, difficultyFeedback: a.difficultyFeedback, note: dec(a.noteEncrypted), comment: dec(a.commentEncrypted) })),
      memories: memories.map((m) => ({ text: dec(m.encryptedContent), createdAt: m.createdAt })),
      usage: usage.map((u) => ({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, createdAt: u.createdAt })),
    } });
  }));

  // Permanent deletion. Requires the password so a stolen access token alone cannot erase an account.
  r.delete('/account', validate({ body: z.object({ password: z.string().min(1).max(128) }) }), asyncHandler(async (req, res) => {
    if (!(await auth.verifyPassword(req.user.id, req.body.password))) throw unauthorized('Incorrect password');
    await d.db.$transaction([
      d.db.auditLog.create({ data: { actorId: req.user.id, action: 'ACCOUNT_DELETED', resourceType: 'User' } }),
      d.db.user.delete({ where: { id: req.user.id } }), // cascades: profile, consents, sessions, messages, summaries, moods, journal, goals, tokens, usage
    ]);
    res.status(204).end();
  }));
  return r;
}

