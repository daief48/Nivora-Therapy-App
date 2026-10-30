import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const types = ['FREE', 'THOUGHT_RECORD', 'GRATITUDE', 'DAILY_REFLECTION', 'SLEEP_STRESS'] as const;
const idp = z.object({ id: z.string().uuid() });

export function journalRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const view = (e: any) => ({ id: e.id, entryType: e.entryType, content: d.cipher.decrypt(e.encryptedContent), createdAt: e.createdAt, updatedAt: e.updatedAt });
  const mine = (userId: string, id: string) => d.db.journalEntry.findFirst({ where: { id, userId, deletedAt: null } });

  r.post('/', validate({ body: z.object({ content: z.string().trim().min(1).max(20_000), entryType: z.enum(types).default('FREE') }) }),
    asyncHandler(async (req, res) => {
      const e = await d.db.journalEntry.create({ data: { userId: req.user.id, entryType: req.body.entryType, encryptedContent: d.cipher.encrypt(req.body.content) } });
      res.status(201).json({ data: view(e) });
    }));

  r.get('/', validate({ query: z.object({
    entryType: z.enum(types).optional(), search: z.string().trim().max(100).optional(),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
  }) }), asyncHandler(async (req, res) => {
    const { entryType, search, from, to, limit } = q<any>(req);
    // Content is encrypted at rest, so text search happens in memory over a bounded recent window.
    const rows = await d.db.journalEntry.findMany({
      where: { userId: req.user.id, deletedAt: null, ...(entryType && { entryType }), createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } },
      orderBy: { createdAt: 'desc' }, take: search ? 500 : limit,
    });
    let out = rows.map(view);
    if (search) { const s = search.toLowerCase(); out = out.filter((e) => e.content.toLowerCase().includes(s)).slice(0, limit); }
    res.json({ data: out });
  }));

  r.get('/:id', validate({ params: idp }), asyncHandler(async (req, res) => {
    const e = await mine(req.user.id, req.params.id);
    if (!e) throw notFound('Journal entry not found');
    res.json({ data: view(e) });
  }));

  r.patch('/:id', validate({ params: idp, body: z.object({ content: z.string().trim().min(1).max(20_000) }) }), asyncHandler(async (req, res) => {
    if (!(await mine(req.user.id, req.params.id))) throw notFound('Journal entry not found');
    const e = await d.db.journalEntry.update({ where: { id: req.params.id }, data: { encryptedContent: d.cipher.encrypt(req.body.content) } });
    res.json({ data: view(e) });
  }));

  r.delete('/:id', validate({ params: idp }), asyncHandler(async (req, res) => {
    if (!(await mine(req.user.id, req.params.id))) throw notFound('Journal entry not found');
    // Soft delete that immediately destroys the content; the empty tombstone row carries no personal data.
    await d.db.journalEntry.update({ where: { id: req.params.id }, data: { deletedAt: new Date(), encryptedContent: '' } });
    res.status(204).end();
  }));
  return r;
}
