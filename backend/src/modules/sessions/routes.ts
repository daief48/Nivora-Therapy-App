import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { AppError, notFound } from '../../utils/errors.js';
import { requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';
import { recentHighStress } from '../../services/contextService.js';
import { computeState, maybeBuildPlanFromIntake } from '../../services/sessionEngine.js';
import { ownedTopic, unpackTopic } from '../../services/topicService.js';
import { cut } from '../../services/sessionContext.js';
import { finalizeSession } from '../../services/sessionSummarizer.js';
import { refreshProgramCompletion, sittingEndsAt, startSitting } from '../../services/programService.js';
import { sittingRemainingSec, touchSitting } from '../../services/sittingTime.js';
import { continuityEnabled, getActivePlan, getHomework, getRecentNotes } from '../../services/therapyData.js';

const END_WAIT_MS = 6000;

const id = z.object({ id: z.string().uuid() });
const createBody = z.object({
  sessionType: z.enum(['TEXT', 'VOICE']).default('TEXT'),
  language: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).default('en'),
  lengthMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]).optional(),
  isIntake: z.boolean().optional(),
  rememberThis: z.boolean().optional(),
  moodBefore: z.number().int().min(1).max(10).optional(),
  topicId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(), // starts today's sitting of that program (same rules as POST /session-programs/:id/sittings)
});

export function sessionsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const { db, cipher, conversation } = d;
  const owned = async (userId: string, sid: string) => {
    const s = await db.therapySession.findFirst({ where: { id: sid, userId }, include: { topic: true } });
    if (!s) throw notFound('Session not found');
    return s;
  };
  const view = (s: any) => ({
    id: s.id, sessionType: s.sessionType, language: s.language, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt,
    lengthMin: s.lengthMin, phase: s.phase, isIntake: s.isIntake, rememberThis: s.rememberThis, moodBefore: s.moodBefore, moodAfter: s.moodAfter,
    programId: s.programId ?? null, dayNumber: s.dayNumber ?? null, plannedMinutes: s.plannedMinutes ?? 0, endsAt: sittingEndsAt(s)?.toISOString() ?? null,
    remainingSec: s.programId && s.status === 'ACTIVE' ? sittingRemainingSec(s) : null, usedMinutes: s.programId ? Math.floor((s.usedSeconds ?? 0) / 60) : null,
    topicId: s.topicId ?? null, topic: s.topic ? { id: s.topic.id, ...unpackTopic(cipher, s.topic.encryptedContent) } : null,
  });

  r.post('/', validate({ body: createBody }), asyncHandler(async (req, res) => {
    await requireConsents(db, req.user.id);
    if (req.body.sessionType === 'VOICE' && d.config.VOICE_ENABLED !== '1') throw new AppError(400, 'MODE_DISABLED', 'Voice sessions are not available');
    if (req.body.programId) {
      const { language, moodBefore, rememberThis, sessionType } = req.body;
      const sit = await startSitting({ db, cipher, glm: d.glm }, req.user.id, req.body.programId, { language, moodBefore, rememberThis, sessionType });
      res.status(sit.resumed ? 200 : 201).json({ data: { ...view(sit), resumed: sit.resumed } }); // an unfinished sitting is resumed, not duplicated
      return;
    }
    if (d.config.ALLOW_STANDALONE_SESSIONS !== '1') throw new AppError(400, 'PROGRAM_REQUIRED', "Start a session program first, then open today's sitting");
    if (req.body.topicId) await ownedTopic(db, req.user.id, req.body.topicId); // 404 for someone else's topic
    const s = await db.therapySession.create({ data: { userId: req.user.id, ...req.body }, include: { topic: true } }); // lengthMin / isIntake / rememberThis / moodBefore are optional
    res.status(201).json({ data: view(s) });
  }));

  r.get('/lobby', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const continuityOptIn = await continuityEnabled(db, userId);
    const prof = await db.userProfile.findUnique({ where: { userId }, select: { preferencesJson: true } });
    const guidedAck = ((prof?.preferencesJson ?? {}) as Record<string, unknown>).guidedAck === true;
    let needsIntake = false, lastSessionRecap: string | null = null, suggestedLengthMin = 15;
    let openHomework: { id: string; title: string; dueDate: string | null }[] = [];
    let planGoals: { id: string; title: string }[] = [];
    if (continuityOptIn) {
      const active = await getActivePlan(db, cipher, userId);
      needsIntake = !active;
      if (active) {
        planGoals = active.plan.goals.map((g) => ({ id: g.id, title: g.title }));
        suggestedLengthMin = active.plan.pace === 'GENTLE' ? 15 : 30;
      } else suggestedLengthMin = 30;
      const [note] = await getRecentNotes(db, cipher, userId, 1);
      if (note?.content.summary) lastSessionRecap = cut(note.content.summary, 240);
      openHomework = (await getHomework(db, cipher, userId, 'ASSIGNED')).slice(0, 5).map((h) => ({ id: h.id, title: h.title, dueDate: h.dueDate }));
    }
    res.json({ data: { needsIntake, lastSessionRecap, openHomework, planGoals, suggestedLengthMin, guidedAck, continuityOptIn } });
  }));

  r.get('/:id/state', validate({ params: id }), asyncHandler(async (req, res) => {
    const s = await owned(req.user.id, req.params.id);
    // This poll doubles as the presence heartbeat: the app polls it every ~20 s while the sitting screen is open, and only that time counts.
    const touched = await touchSitting(db, s.id);
    if (touched) s.usedSeconds = touched.usedSeconds;
    const n = await db.sessionMessage.count({ where: { sessionId: s.id } });
    const plan = s.rememberThis && (await continuityEnabled(db, s.userId)) ? (await getActivePlan(db, cipher, s.userId))?.plan : undefined;
    const highStress = s.phase === 'OPENING' ? await recentHighStress(db, s.userId).catch(() => false) : false;
    const state = computeState(s, n, new Date(), { approach: plan?.approach, pace: plan?.pace, highStress });
    const endsAt = sittingEndsAt(s);
    const remainingSec = endsAt ? (s.status === 'ACTIVE' ? sittingRemainingSec(s) : 0) : null;
    res.json({ data: { ...state, isIntake: s.isIntake, moodBefore: s.moodBefore, endsAt: endsAt?.toISOString() ?? null, remainingSec } });
  }));

  r.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), status: z.enum(['ACTIVE', 'ENDED']).optional() }) }),
    asyncHandler(async (req, res) => {
      const { limit, status } = q<{ limit: number; status?: string }>(req);
      const rows = await db.therapySession.findMany({
        where: { userId: req.user.id, ...(status ? { status } : {}) }, orderBy: { startedAt: 'desc' }, take: limit,
        include: { topic: true, summary: { select: { id: true } }, _count: { select: { messages: true } } },
      });
      res.json({ data: rows.map((s) => ({ ...view(s), hasSummary: !!s.summary, messageCount: s._count.messages })) });
    }));

  r.get('/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const s = await owned(req.user.id, req.params.id);
    const msgs = await db.sessionMessage.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } });
    res.json({
      data: { ...view(s), messages: msgs.map((m) => ({ id: m.id, role: m.role, content: cipher.decrypt(m.encryptedContent), feedback: m.feedback, createdAt: m.createdAt })) },
    });
  }));

  r.post('/:id/messages', d.messageLimiter, validate({
    params: id,
    body: z.object({ text: z.string().trim().min(1).max(d.config.MAX_MESSAGE_CHARS), journalEntryId: z.string().uuid().optional() }),
  }), asyncHandler(async (req, res) => {
    const base = { userId: req.user.id, sessionId: req.params.id, text: req.body.text, journalEntryId: req.body.journalEntryId };
    if (!String(req.headers.accept ?? '').includes('text/event-stream')) {
      const result = await conversation.send(base);
      res.status(201).json({ data: result });
      return;
    }
    // Server-sent events. Headers are sent lazily so validation/consent errors still return normal JSON.
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // client cancelled => cancel the GLM request
    let started = false;
    const emit = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      if (!started) {
        started = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await conversation.send({
        ...base, signal: ac.signal,
        onDelta: (text) => emit('delta', { text }),
        onReplace: (text) => emit('replace', { text }),
      });
      // The offered in-app action (if any) is its own final event, right before `done`; `done.action` carries the same card.
      if (result.action) emit('action', { messageId: result.message.id, action: result.action });
      emit('done', result);
      res.end();
    } catch (e) {
      if (ac.signal.aborted) { res.end(); return; }
      if (!started) throw e;
      const err = e instanceof AppError ? e : new AppError(500, 'INTERNAL', 'Something went wrong');
      emit('error', { code: err.code, message: err.message });
      res.end();
    }
  }));

  r.post('/:id/messages/:messageId/feedback', validate({
    params: z.object({ id: z.string().uuid(), messageId: z.string().uuid() }),
    body: z.object({ value: z.union([z.literal(1), z.literal(-1)]) }),
  }), asyncHandler(async (req, res) => {
    await owned(req.user.id, req.params.id);
    const m = await db.sessionMessage.updateMany({
      where: { id: req.params.messageId, sessionId: req.params.id, role: 'assistant' }, data: { feedback: req.body.value },
    });
    if (!m.count) throw notFound('Message not found');
    // A thumb on the message also counts for the action card that came with it (the variety filter leaves out thumbed-down kinds for a week).
    await db.actionOffer.updateMany({ where: { userId: req.user.id, messageId: req.params.messageId }, data: { feedback: req.body.value } });
    res.status(204).end();
  }));

  r.post('/:id/end', validate({ params: id, body: z.object({ summarize: z.boolean().default(false), force: z.boolean().default(false) }).default({ summarize: false, force: false }) }),
    asyncHandler(async (req, res) => {
      const s = await owned(req.user.id, req.params.id);
      if (s.programId && s.status === 'ACTIVE') {
        // Leaving only pauses a sitting that still has planned time left; it ends for real when the time is used up, on force, or for a person in distress.
        const used = (await touchSitting(db, s.id))?.usedSeconds ?? s.usedSeconds;
        const remainingSec = sittingRemainingSec({ plannedMinutes: s.plannedMinutes, usedSeconds: used });
        const distressed = s.riskFlag !== 'NONE' || (await db.safetyEvent.count({ where: { sessionId: s.id } })) > 0;
        if (!req.body.force && remainingSec !== null && remainingSec > 0 && !distressed) {
          res.json({ data: { id: s.id, status: 'ACTIVE', paused: true, remainingSec, noteReady: false, summaryCreated: false } });
          return;
        }
      }
      if (s.status === 'ACTIVE') await db.therapySession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt: new Date() } });
      // Guided-session note (best effort, never blocks ending for long) and the plan after an intake.
      let noteReady = false;
      const guided = (async () => {
        await finalizeSession({ db, glm: d.glm, cipher }, s.id, 'USER_END');
        if (s.isIntake) await maybeBuildPlanFromIntake({ db, glm: d.glm, cipher }, s.id);
      })().catch((e) => d.logger.warn({ requestId: req.id, code: (e as AppError).code }, 'session finalize failed'));
      await Promise.race([guided, new Promise((resolve) => { setTimeout(resolve, END_WAIT_MS).unref(); })]);
      noteReady = !!(await db.sessionNote.findUnique({ where: { sessionId: s.id }, select: { id: true } }).catch(() => null));
      let summaryCreated = false;
      if (req.body.summarize) {
        try { summaryCreated = await conversation.summarize(req.user.id, s.id); }
        catch (e) { d.logger.warn({ requestId: req.id, code: (e as AppError).code }, 'summary generation failed'); }
      }
      await refreshProgramCompletion(db, s.programId);
      res.json({ data: { id: s.id, status: 'ENDED', summaryCreated, noteReady } });
    }));

  r.get('/:id/summary', validate({ params: id }), asyncHandler(async (req, res) => {
    await owned(req.user.id, req.params.id);
    const sum = await db.sessionSummary.findUnique({ where: { sessionId: req.params.id } });
    if (!sum) throw notFound('No summary for this session');
    res.json({ data: { summary: cipher.decrypt(sum.encryptedSummary), createdAt: sum.createdAt, generatedByAi: true } });
  }));

  r.delete('/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    await owned(req.user.id, req.params.id);
    await db.therapySession.delete({ where: { id: req.params.id } }); // cascades to messages and summary
    await db.auditLog.create({ data: { actorId: req.user.id, action: 'SESSION_DELETED', resourceType: 'TherapySession' } });
    res.status(204).end();
  }));
  return r;
}
