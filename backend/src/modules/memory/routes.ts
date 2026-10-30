import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { listMemories, rewriteMemory, USER_MEMORY_LIMIT, type MemoryView } from '../../services/memoryService.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const view = (m: MemoryView) => ({ id: m.id, text: m.text, source: m.source, kind: m.kind, createdAt: m.createdAt, updated: m.updated, updatedAt: m.updatedAt });
const source = z.enum(['SESSION', 'USER', 'all']);

/** Things the user explicitly asked Nivora to remember, plus facts Nivora noted from guided sessions. Viewable, editable, deletable, never a clinical profile. */
export function memoryRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  r.get('/', validate({ query: z.object({ source: source.default('all') }) }), asyncHandler(async (req, res) => {
    const rows = await listMemories(d.db, d.cipher, req.user.id, { source: q<{ source: 'SESSION' | 'USER' | 'all' }>(req).source, take: 300 });
    res.json({ data: rows.map(view) });
  }));
  r.post('/', validate({ body: z.object({ text: z.string().trim().min(1).max(300) }) }), asyncHandler(async (req, res) => {
    const count = await d.db.memory.count({ where: { userId: req.user.id, source: 'USER' } });
    if (count >= USER_MEMORY_LIMIT) { res.status(409).json({ error: { code: 'MEMORY_FULL', message: 'Memory is full. Delete something first.' } }); return; }
    const m = await d.db.memory.create({ data: { userId: req.user.id, encryptedContent: d.cipher.encrypt(req.body.text) } });
    res.status(201).json({ data: { id: m.id, text: req.body.text, source: m.source, kind: 'FACT', createdAt: m.createdAt, updated: false, updatedAt: null } });
  }));
  r.patch('/:id', validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ text: z.string().trim().min(1).max(300) }) }), asyncHandler(async (req, res) => {
    const m = await rewriteMemory(d.db, d.cipher, req.user.id, req.params.id, req.body.text);
    if (!m) throw notFound('Memory not found');
    res.json({ data: view(m) });
  }));
  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.memory.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Memory not found');
    res.status(204).end();
  }));
  // ?source=SESSION forgets only what was derived from sessions; ?source=USER only what the user added; no filter = everything (unchanged).
  r.delete('/', validate({ query: z.object({ source: source.default('all') }) }), asyncHandler(async (req, res) => {
    const src = q<{ source: 'SESSION' | 'USER' | 'all' }>(req).source;
    await d.db.memory.deleteMany({ where: { userId: req.user.id, ...(src === 'all' ? {} : { source: src }) } });
    res.status(204).end();
  }));
  return r;
}
