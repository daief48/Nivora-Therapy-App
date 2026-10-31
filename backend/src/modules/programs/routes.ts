import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { availableModes, ownedProgram, programView, resolveMode, SITTING_MODES, sittingEndsAt, startSitting, userTimezone, type ProgramDeps } from '../../services/programService.js';
import { EMPTY_NOTE, type NoteContent } from '../../services/therapyData.js';
import { TOPIC_KINDS } from '../../services/topicPrompts.js';
import { ownedTopic, packTopic } from '../../services/topicService.js';
import { AppError, notFound } from '../../utils/errors.js';
import { requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

// "Sessions" in the app: multi-day programs with one Sitting (TherapySession row) per local calendar day. Mounted at /session-programs.
const id = z.object({ id: z.string().uuid() });
const LANGS = ['en', 'bn', 'hi', 'ne', 'mixed', 'auto'] as const;
const createBody = z.object({
  topicId: z.string().uuid().optional(),
  kind: z.enum(TOPIC_KINDS).optional(),
  title: z.string().trim().min(1).max(80),
  goal: z.string().trim().max(300).optional(),
  plannedDays: z.number().int().min(3).max(60),
  dailyMinutes: z.union([z.literal(30), z.literal(40)]),
  reminderTimeMin: z.number().int().min(0).max(1439).optional(),
  language: z.enum(LANGS).default('en'),
});
const patchBody = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  goal: z.string().trim().max(300).nullable().optional(),
  dailyMinutes: z.union([z.literal(30), z.literal(40)]).optional(),
  reminderTimeMin: z.number().int().min(0).max(1439).nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
});

export function programsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const { db, cipher } = d;
  const pd: ProgramDeps = { db, cipher, glm: d.glm };
  const modes = () => availableModes(d.config);

  r.post('/', validate({ body: createBody }), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createBody>;
    await requireConsents(db, req.user.id);
    let topicId: string | null = null;
    if (b.topicId) topicId = (await ownedTopic(db, req.user.id, b.topicId)).id; // 404 for someone else's topic
    else if (b.kind) topicId = (await db.topic.create({ data: { userId: req.user.id, encryptedContent: packTopic(cipher, { kind: b.kind, label: null }) } })).id;
    const p = await db.sessionProgram.create({
      data: {
        userId: req.user.id, topicId, titleEncrypted: cipher.encrypt(b.title), goalEncrypted: b.goal ? cipher.encrypt(b.goal) : null,
        plannedDays: b.plannedDays, dailyMinutes: b.dailyMinutes, reminderTimeMin: b.reminderTimeMin ?? null,
      },
      include: { topic: true },
    });
    res.status(201).json({ data: await programView(pd, p, await userTimezone(db, req.user.id), new Date(), false, modes()) });
  }));

  r.get('/', validate({ query: z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional() }) }), asyncHandler(async (req, res) => {
    const { status } = q<{ status?: string }>(req);
    const rows = await db.sessionProgram.findMany({
      where: { userId: req.user.id, ...(status ? { status } : { status: { not: 'ARCHIVED' } }) }, orderBy: { startedAt: 'desc' }, include: { topic: true },
    });
    const tz = await userTimezone(db, req.user.id);
    res.json({ data: await Promise.all(rows.map((p) => programView(pd, p, tz, new Date(), false, modes()))) });
  }));

  r.get('/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const p = await ownedProgram(db, req.user.id, req.params.id);
    res.json({ data: await programView(pd, p, await userTimezone(db, req.user.id), new Date(), true, modes()) });
  }));

  r.patch('/:id', validate({ params: id, body: patchBody }), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof patchBody>;
    const p = await ownedProgram(db, req.user.id, req.params.id);
    if (b.status === 'ACTIVE' && p.status === 'COMPLETED') throw new AppError(409, 'PROGRAM_NOT_ACTIVE', 'A finished session cannot be reopened');
    const status = b.status && p.status === 'COMPLETED' && b.status !== 'ARCHIVED' ? undefined : b.status; // a finished session may only be archived
    const u = await db.sessionProgram.update({
      where: { id: p.id },
      data: {
        ...(b.title !== undefined && { titleEncrypted: cipher.encrypt(b.title) }),
        ...(b.goal !== undefined && { goalEncrypted: b.goal ? cipher.encrypt(b.goal) : null }),
        ...(b.dailyMinutes !== undefined && { dailyMinutes: b.dailyMinutes }), // applies to the next sitting; a running one keeps its time box
        ...(b.reminderTimeMin !== undefined && { reminderTimeMin: b.reminderTimeMin }),
        ...(status && { status }),
      },
      include: { topic: true },
    });
    res.json({ data: await programView(pd, u, await userTimezone(db, req.user.id), new Date(), false, modes()) });
  }));

  r.delete('/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const p = await ownedProgram(db, req.user.id, req.params.id);
    const ids = (await db.therapySession.findMany({ where: { programId: p.id }, select: { id: true } })).map((s) => s.id);
    await db.$transaction(async (tx) => {
      if (ids.length) await tx.homework.deleteMany({ where: { userId: req.user.id, sessionId: { in: ids } } }); // homework has no FK to the sitting
      await tx.sessionProgram.delete({ where: { id: p.id } }); // cascades to sittings, their messages, notes and summaries
    });
    await db.auditLog.create({ data: { actorId: req.user.id, action: 'PROGRAM_DELETED', resourceType: 'SessionProgram' } });
    res.status(204).end();
  }));

  r.post('/:id/sittings', validate({
    params: id,
    body: z.object({ language: z.enum(LANGS).optional(), moodBefore: z.number().int().min(1).max(10).optional(), rememberThis: z.boolean().optional(), mode: z.enum(SITTING_MODES).optional() }).default({}),
  }), asyncHandler(async (req, res) => {
    await requireConsents(db, req.user.id);
    const { mode = 'TEXT', ...opts } = req.body as { mode?: (typeof SITTING_MODES)[number]; language?: string; moodBefore?: number; rememberThis?: boolean };
    const sessionType = resolveMode(d.config, mode); // MODE_DISABLED before anything is created
    const s = await startSitting(pd, req.user.id, req.params.id, { ...opts, sessionType });
    const intakePart = s.dayNumber === 1 ? 1 : s.dayNumber === 2 ? 2 : null;
    res.status(201).json({
      data: { sittingId: s.id, dayNumber: s.dayNumber, plannedMinutes: s.plannedMinutes, isIntake: s.isIntake, intakePart, endsAt: sittingEndsAt(s)!.toISOString(), sessionType: s.sessionType, mode },
    });
  }));

  // Switch an open sitting between text and voice/video. Replies use the new style from the next message on (conversationService reads sessionType per message).
  r.post('/:id/sittings/:sittingId/mode', validate({
    params: z.object({ id: z.string().uuid(), sittingId: z.string().uuid() }),
    body: z.object({ mode: z.enum(SITTING_MODES) }),
  }), asyncHandler(async (req, res) => {
    const { mode } = req.body as { mode: (typeof SITTING_MODES)[number] };
    const p = await ownedProgram(db, req.user.id, req.params.id);
    const s = await db.therapySession.findFirst({ where: { id: req.params.sittingId, programId: p.id, userId: req.user.id } });
    if (!s) throw notFound('Sitting not found');
    if (s.status !== 'ACTIVE') throw new AppError(409, 'SITTING_NOT_ACTIVE', 'This sitting has ended');
    const sessionType = resolveMode(d.config, mode);
    const u = await db.therapySession.update({ where: { id: s.id }, data: { sessionType } });
    res.json({ data: { sittingId: u.id, mode, sessionType: u.sessionType, endsAt: sittingEndsAt(u)?.toISOString() ?? null } });
  }));

  r.get('/:id/sittings/:sittingId', validate({ params: z.object({ id: z.string().uuid(), sittingId: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const p = await ownedProgram(db, req.user.id, req.params.id);
    const s = await db.therapySession.findFirst({ where: { id: req.params.sittingId, programId: p.id, userId: req.user.id }, include: { note: true } });
    if (!s) throw notFound('Sitting not found');
    let note: NoteContent | null = null;
    if (s.note && s.rememberThis) { try { note = { ...EMPTY_NOTE, ...(JSON.parse(cipher.decrypt(s.note.encryptedContent)) as Partial<NoteContent>) }; } catch { note = null; } }
    const hw = await db.homework.findMany({ where: { userId: req.user.id, sessionId: s.id }, orderBy: { createdAt: 'asc' } });
    const data: Record<string, unknown> = {
      id: s.id, dayNumber: s.dayNumber, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt,
      durationMin: s.endedAt ? Math.max(1, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000)) : null,
      isIntake: s.isIntake, moodBefore: s.moodBefore, moodAfter: s.moodAfter, note,
      homework: hw.map((h) => ({ id: h.id, title: cipher.decrypt(h.titleEncrypted), dueDate: h.dueDate, status: h.status })),
    };
    if (s.rememberThis) {
      const msgs = await db.sessionMessage.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } });
      data.transcript = msgs.map((m) => ({ id: m.id, role: m.role, content: cipher.decrypt(m.encryptedContent), createdAt: m.createdAt }));
    }
    res.json({ data });
  }));
  return r;
}
