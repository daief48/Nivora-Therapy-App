import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

export function moodsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const view = (m: any) => ({
    id: m.id, moodScore: m.moodScore, stressScore: m.stressScore,
    note: m.optionalNoteEncrypted ? d.cipher.decrypt(m.optionalNoteEncrypted) : null, createdAt: m.createdAt, source: 'user_reported',
  });

  r.post('/', validate({ body: z.object({
    moodScore: z.number().int().min(1).max(5), stressScore: z.number().int().min(1).max(5).optional(),
    note: z.string().trim().max(2000).optional(),
  }) }), asyncHandler(async (req, res) => {
    const { moodScore, stressScore, note } = req.body;
    const m = await d.db.moodEntry.create({ data: {
      userId: req.user.id, moodScore, stressScore, optionalNoteEncrypted: note ? d.cipher.encrypt(note) : null,
    } });
    res.status(201).json({ data: view(m) });
  }));

  r.get('/', validate({ query: z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200),
  }) }), asyncHandler(async (req, res) => {
    const { from, to, limit } = q<{ from?: Date; to?: Date; limit: number }>(req);
    const rows = await d.db.moodEntry.findMany({
      where: { userId: req.user.id, createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } },
      orderBy: { createdAt: 'desc' }, take: limit,
    });
    res.json({ data: rows.map(view) });
  }));

  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.moodEntry.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Mood entry not found');
    res.status(204).end();
  }));
  return r;
}
