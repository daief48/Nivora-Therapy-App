import { Router } from 'express';
import { decodeMemory } from '../../services/memoryService.js';
import { CONSENT_COVERAGE, FEATURE_FLOWS, NEVER_SENT } from '../../services/aiDataMap.js';
import { parseLevel, SUGGESTION_LEVELS } from '../../services/actionMenu.js';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { unauthorized } from '../../utils/errors.js';
import { createAuthService } from '../auth/authService.js';
import type { Deps } from '../deps.js';

export function privacyRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const auth = createAuthService(d.db, d.config, d.mailer);

  // "What the AI sees": which consent covers which data, the person's current consent state and which features use a model. Plain keys; the app localizes them.
  r.get('/ai-data', asyncHandler(async (req, res) => {
    const [rows, prof] = await Promise.all([
      d.db.userConsent.findMany({ where: { userId: req.user.id, withdrawnAt: null }, orderBy: { grantedAt: 'desc' } }),
      d.db.userProfile.findUnique({ where: { userId: req.user.id }, select: { suggestionLevel: true, analyticsOptIn: true } }),
    ]);
    const granted = new Map(rows.map((c) => [c.consentType, c.grantedAt]));
    res.json({ data: {
      consents: CONSENT_COVERAGE.map((c) => ({ type: c.type, granted: granted.has(c.type), grantedAt: granted.get(c.type) ?? null, covers: c.covers, features: c.features })),
      features: FEATURE_FLOWS.map((f) => ({ ...f, allowed: f.consent === null || f.consent === 'BASE' || granted.has(f.consent) })),
      neverSent: NEVER_SENT,
      suggestionLevel: parseLevel(prof?.suggestionLevel), suggestionLevels: SUGGESTION_LEVELS, analyticsOptIn: prof?.analyticsOptIn ?? false,
      links: { privacy: 'Privacy' },
    } });
  }));

  // Full export of the user's own data, decrypted. Sent only to the authenticated owner.
  r.post('/export', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const dec = (s: string | null) => (s ? d.cipher.decrypt(s) : null);
    const [user, consents, sessions, moods, journal, goals, usage, checkIns, sleep, kaizen, memories, assessments, weekly, activity, offers, nudgeSettings, nudgeLogs, garden, routineLogs, kaizenGoals, kaizenTasks, userGoals, userGoalUpdates] = await Promise.all([
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
      d.db.assessment.findMany({ where: { userId: uid } }),
      d.db.weeklySummary.findMany({ where: { userId: uid } }),
      d.db.dailyActivity.findMany({ where: { userId: uid } }),
      d.db.actionOffer.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      d.db.nudgeSettings.findUnique({ where: { userId: uid } }),
      d.db.nudgeLog.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      d.db.gardenState.findUnique({ where: { userId: uid } }),
      d.db.routineLog.findMany({ where: { userId: uid }, orderBy: { date: 'asc' } }),
      d.db.kaizenGoal.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      d.db.kaizenTask.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      d.db.userGoal.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      d.db.userGoalUpdate.findMany({ where: { goal: { userId: uid } }, orderBy: { createdAt: 'asc' } }),
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
      // Kept voice recordings are included as base64 (audioBase64 + audioMime): the export is the complete copy of what is stored.
      journal: journal.map((j) => ({ entryType: j.entryType, source: j.source, content: dec(j.encryptedContent), reading: dec(j.emotionEncrypted), audioMime: j.audioMime, audioBase64: dec(j.audioEncrypted), createdAt: j.createdAt, updatedAt: j.updatedAt })),
      goals: goals.map((g) => ({ title: g.title, status: g.status, targetDate: g.targetDate, checkIns: g.checkIns.map((c) => ({ progressValue: c.progressValue, note: dec(c.optionalEncryptedNotes), createdAt: c.createdAt })) })),
      checkIns: checkIns.map((c) => ({ kind: c.kind, mood: c.mood, stress: c.stress, energy: c.energy, sleepQuality: c.sleepQuality, rested: c.rested, worry: dec(c.worryEncrypted), note: dec(c.noteEncrypted), createdAt: c.createdAt })),
      sleep: sleep.map((s) => ({ date: s.date, bedtime: s.bedtime, wakeTime: s.wakeTime, durationMin: s.durationMin, latencyMin: s.latencyMin, awakenings: s.awakenings, rested: s.rested, score: s.score, source: s.source, note: dec(s.noteEncrypted) })),
      weeklySummaries: weekly.map((w) => ({ weekStart: w.weekStart, text: dec(w.textEncrypted), ai: w.ai, stats: w.statsJson, report: dec(w.reportEncrypted) })),
      actionOffers: offers.map((o) => ({ actionId: o.actionId, kind: o.kind, surface: o.surface, outcome: o.outcome, feedback: o.feedback, createdAt: o.createdAt })),
      activity: activity.map((a) => ({ date: a.date, steps: a.steps, walkingMin: a.walkingMin, exerciseMin: a.exerciseMin, source: a.source })),
      kaizen: kaizen.map((a) => ({ goal: a.goal.title, date: a.date, title: a.title, yourText: dec(a.userTextEncrypted), source: a.source, adaptedBy: a.adaptedBy, micro: a.micro, status: a.status, targetValue: a.targetValue, unit: a.unit, difficultyFeedback: a.difficultyFeedback, felt: a.feltLevel, usefulness: a.usefulness, nextPreference: a.nextPreference, completedAt: a.completedAt, note: dec(a.noteEncrypted), comment: dec(a.commentEncrypted) })),
      kaizenGoals: kaizenGoals.map((g) => ({ title: g.title, category: g.category, status: g.status, currentTarget: g.currentTarget, helperGoal: !!g.systemKey, createdAt: g.createdAt })),
      kaizenTasks: kaizenTasks.map((t) => ({ content: dec(t.contentEnc), reason: dec(t.reasonEnc), status: t.status, stateNote: dec(t.stateNoteEnc), createdAt: t.createdAt, completedAt: t.completedAt })),
      userGoals: userGoals.map((g) => ({ title: dec(g.titleEnc), tasks: JSON.parse(g.tasksJson), score: g.score, status: g.status, createdAt: g.createdAt })),
      userGoalUpdates: userGoalUpdates.map((u) => ({ note: dec(u.noteEnc), doneCurrent: u.doneCurrent, score: u.score, createdAt: u.createdAt })),
      garden: { carriedFlowers: garden?.carried ?? 0 },
      routineLogs: routineLogs.map((l) => ({ date: l.date, stepsDone: l.stepsDone, stepsTotal: l.stepsTotal, doneIds: l.doneIds ? l.doneIds.split(',') : [], extras: l.extras })),
      nudgeSettings: nudgeSettings && { enabled: nudgeSettings.enabled, quietStart: nudgeSettings.quietStart, quietEnd: nudgeSettings.quietEnd, typesOff: nudgeSettings.typesOff, snoozedUntil: nudgeSettings.snoozedUntil },
      nudgeLog: nudgeLogs.map((n) => ({ date: n.date, type: n.type, dismissedAt: n.dismissedAt, createdAt: n.createdAt })),
      memories: memories.map((m) => ({ text: decodeMemory(d.cipher, m).text, source: m.source, createdAt: m.createdAt })),
      assessments: assessments.map((a) => { const p = JSON.parse(d.cipher.decrypt(a.encryptedContent)); return { instrument: a.instrument, total: p.total, severity: p.severity, answers: p.answers, createdAt: a.createdAt }; }),
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

