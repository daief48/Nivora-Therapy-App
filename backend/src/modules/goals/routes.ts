import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const idp = z.object({ id: z.string().uuid() });
const status = z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']);

export function goalsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const checkInView = (c: any) => ({
    id: c.id, progressValue: c.progressValue, note: c.optionalEncryptedNotes ? d.cipher.decrypt(c.optionalEncryptedNotes) : null, createdAt: c.createdAt,
  });
  const view = (g: any) => ({
    id: g.id, title: g.title, status: g.status, targetDate: g.targetDate, createdAt: g.createdAt,
    checkIns: (g.checkIns ?? []).map(checkInView),
  });
  const mine = async (userId: string, id: string) => {
    const g = await d.db.therapyGoal.findFirst({ where: { id, userId } });
    if (!g) throw notFound('Goal not found');
    return g;
  };

  r.post('/', validate({ body: z.object({ title: z.string().trim().min(1).max(200), targetDate: z.coerce.date().optional() }) }), asyncHandler(async (req, res) => {
    const g = await d.db.therapyGoal.create({ data: { userId: req.user.id, ...req.body } });
    res.status(201).json({ data: view(g) });
  }));

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await d.db.therapyGoal.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, include: { checkIns: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    res.json({ data: rows.map(view) });
  }));

  r.patch('/:id', validate({ params: idp, body: z.object({
    title: z.string().trim().min(1).max(200).optional(), status: status.optional(), targetDate: z.coerce.date().nullable().optional(),
  }).strict() }), asyncHandler(async (req, res) => {
    await mine(req.user.id, req.params.id);
    res.json({ data: view(await d.db.therapyGoal.update({ where: { id: req.params.id }, data: req.body })) });
  }));

  r.delete('/:id', validate({ params: idp }), asyncHandler(async (req, res) => {
    await mine(req.user.id, req.params.id);
    await d.db.therapyGoal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

  r.post('/:id/check-ins', validate({ params: idp, body: z.object({
    progressValue: z.number().int().min(0).max(100), note: z.string().trim().max(1000).optional(),
  }) }), asyncHandler(async (req, res) => {
    await mine(req.user.id, req.params.id);
    const c = await d.db.goalCheckIn.create({ data: {
      goalId: req.params.id, progressValue: req.body.progressValue, optionalEncryptedNotes: req.body.note ? d.cipher.encrypt(req.body.note) : null,
    } });
    if (req.body.progressValue >= 100) await d.db.therapyGoal.update({ where: { id: req.params.id }, data: { status: 'COMPLETED' } });
    res.status(201).json({ data: checkInView(c) });
  }));
  return r;
}
