import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { AppError, notFound } from '../../utils/errors.js';
import { requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

const id = z.object({ id: z.string().uuid() });
const createBody = z.object({
  sessionType: z.enum(['TEXT', 'VOICE']).default('TEXT'),
  language: z.enum(['en', 'bn', 'mixed']).default('en'),
});

export function sessionsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const { db, cipher, conversation } = d;
  const owned = async (userId: string, sid: string) => {
    const s = await db.therapySession.findFirst({ where: { id: sid, userId } });
    if (!s) throw notFound('Session not found');
    return s;
  };
  const view = (s: any) => ({
    id: s.id, sessionType: s.sessionType, language: s.language, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt,
  });

  r.post('/', validate({ body: createBody }), asyncHandler(async (req, res) => {
    await requireConsents(db, req.user.id);
    const s = await db.therapySession.create({ data: { userId: req.user.id, ...req.body } });
    res.status(201).json({ data: view(s) });
  }));

  r.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), status: z.enum(['ACTIVE', 'ENDED']).optional() }) }),
    asyncHandler(async (req, res) => {
      const { limit, status } = q<{ limit: number; status?: string }>(req);
      const rows = await db.therapySession.findMany({
        where: { userId: req.user.id, ...(status ? { status } : {}) }, orderBy: { startedAt: 'desc' }, take: limit,
        include: { summary: { select: { id: true } }, _count: { select: { messages: true } } },
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
    res.status(204).end();
  }));

  r.post('/:id/end', validate({ params: id, body: z.object({ summarize: z.boolean().default(false) }).default({ summarize: false }) }),
    asyncHandler(async (req, res) => {
      const s = await owned(req.user.id, req.params.id);
      if (s.status === 'ACTIVE') await db.therapySession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt: new Date() } });
      let summaryCreated = false;
      if (req.body.summarize) {
        try { summaryCreated = await conversation.summarize(req.user.id, s.id); }
        catch (e) { d.logger.warn({ requestId: req.id, code: (e as AppError).code }, 'summary generation failed'); }
      }
      res.json({ data: { id: s.id, status: 'ENDED', summaryCreated } });
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
