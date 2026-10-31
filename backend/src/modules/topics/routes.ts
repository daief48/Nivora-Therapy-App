import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { TOPIC_KINDS } from '../../services/topicPrompts.js';
import { ownedTopic, packTopic, unpackTopic } from '../../services/topicService.js';
import type { Deps } from '../deps.js';

const idp = z.object({ id: z.string().uuid() });

export function topicsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const { db, cipher } = d;
  const view = (t: { id: string; encryptedContent: string; createdAt: Date }, sessionCount: number, lastSessionAt: Date | null) => ({
    id: t.id, ...unpackTopic(cipher, t.encryptedContent), createdAt: t.createdAt, sessionCount, lastSessionAt,
  });

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await db.topic.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: 'asc' },
      include: { _count: { select: { sessions: true } }, sessions: { select: { startedAt: true }, orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    const data = rows.map((t) => view(t, t._count.sessions, t.sessions[0]?.startedAt ?? null));
    data.sort((a, b) => (b.lastSessionAt ?? b.createdAt).getTime() - (a.lastSessionAt ?? a.createdAt).getTime());
    res.json({ data });
  }));

  r.post('/', validate({ body: z.object({ kind: z.enum(TOPIC_KINDS), label: z.string().trim().min(1).max(60).optional() }) }), asyncHandler(async (req, res) => {
    const label = req.body.kind === 'OTHER' ? req.body.label ?? null : null; // a label only makes sense for OTHER
    const t = await db.topic.create({ data: { userId: req.user.id, encryptedContent: packTopic(cipher, { kind: req.body.kind, label }) } });
    res.status(201).json({ data: view(t, 0, null) });
  }));

  r.get('/:id/sessions', validate({ params: idp, query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) }), asyncHandler(async (req, res) => {
    const t = await ownedTopic(db, req.user.id, req.params.id);
    const { limit } = q<{ limit: number }>(req);
    const rows = await db.therapySession.findMany({
      where: { userId: req.user.id, topicId: t.id }, orderBy: { startedAt: 'desc' }, take: limit,
      include: { summary: { select: { encryptedSummary: true } }, note: { select: { encryptedContent: true } }, _count: { select: { messages: true } } },
    });
    const sessions = rows.map((s) => {
      let summary: string | null = null;
      try {
        if (s.note) summary = (JSON.parse(cipher.decrypt(s.note.encryptedContent)) as { summary?: string }).summary || null;
        if (!summary && s.summary) summary = cipher.decrypt(s.summary.encryptedSummary);
      } catch { summary = null; }
      if (summary && summary.length > 200) summary = summary.slice(0, 199).trimEnd() + '…';
      const durationMin = s.endedAt ? Math.max(1, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000)) : null;
      return {
        id: s.id, sessionType: s.sessionType, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, durationMin,
        moodBefore: s.moodBefore, moodAfter: s.moodAfter, summary, messageCount: s._count.messages,
      };
    });
    res.json({ data: { topic: view(t, sessions.length, rows[0]?.startedAt ?? null), sessions } });
  }));

  r.delete('/:id', validate({ params: idp, query: z.object({ deleteSessions: z.enum(['true', 'false']).default('false') }) }), asyncHandler(async (req, res) => {
    const t = await ownedTopic(db, req.user.id, req.params.id);
    const { deleteSessions } = q<{ deleteSessions: string }>(req);
    await db.$transaction(async (tx) => {
      // Sessions otherwise stay (topicId is nulled by onDelete SetNull); deleting cascades to messages, notes and summaries.
      if (deleteSessions === 'true') await tx.therapySession.deleteMany({ where: { topicId: t.id, userId: req.user.id } });
      await tx.topic.delete({ where: { id: t.id } });
    });
    await db.auditLog.create({ data: { actorId: req.user.id, action: 'TOPIC_DELETED', resourceType: 'Topic' } });
    res.status(204).end();
  }));
  return r;
}
