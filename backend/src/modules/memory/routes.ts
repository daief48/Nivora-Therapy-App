import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

/** Things the user explicitly asked Nivora to remember. Viewable, deletable, never a clinical profile. */
export function memoryRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  r.get('/', asyncHandler(async (req, res) => {
    const rows = await d.db.memory.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ data: rows.map((m) => ({ id: m.id, text: d.cipher.decrypt(m.encryptedContent), source: m.source, createdAt: m.createdAt })) });
  }));
  r.post('/', validate({ body: z.object({ text: z.string().trim().min(1).max(300) }) }), asyncHandler(async (req, res) => {
    const count = await d.db.memory.count({ where: { userId: req.user.id } });
    if (count >= 50) { res.status(409).json({ error: { code: 'MEMORY_FULL', message: 'Memory is full. Delete something first.' } }); return; }
    const m = await d.db.memory.create({ data: { userId: req.user.id, encryptedContent: d.cipher.encrypt(req.body.text) } });
    res.status(201).json({ data: { id: m.id, text: req.body.text, source: m.source, createdAt: m.createdAt } });
  }));
  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.memory.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Memory not found');
    res.status(204).end();
  }));
  r.delete('/', asyncHandler(async (req, res) => {
    await d.db.memory.deleteMany({ where: { userId: req.user.id } });
    res.status(204).end();
  }));
  return r;
}
