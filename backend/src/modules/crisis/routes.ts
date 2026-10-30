import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const MAX_CONTACTS = 5;
const phoneRe = /^\+?[\d\s\-()]{3,24}$/;

const item = z.string().trim().min(1).max(200);
const list = z.array(item).max(10).default([]);
const planSchema = z.object({
  warningSigns: list, copingSteps: list, distractions: list, peopleToContact: list,
  professionals: list, safeEnvironment: list, reasonsToLive: list,
});
type Plan = z.infer<typeof planSchema>;
const emptyPlan = (): Plan => planSchema.parse({});

/** Trusted people and a personal safety plan. Everything private is encrypted at rest; Nivora never contacts anyone for the user. */
export function crisisRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  const view = (c: { id: string; nameEncrypted: string; phoneEncrypted: string; relation: string | null; createdAt: Date }) => ({
    id: c.id, name: d.cipher.decrypt(c.nameEncrypted), phone: d.cipher.decrypt(c.phoneEncrypted), relation: c.relation, createdAt: c.createdAt,
  });

  r.get('/contacts', asyncHandler(async (req, res) => {
    const rows = await d.db.trustedContact.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' }, take: MAX_CONTACTS });
    res.json({ data: rows.map(view) });
  }));

  const contactBody = z.object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().regex(phoneRe, 'Enter a valid phone number'),
    relation: z.string().trim().max(40).nullish().transform((v) => v || null),
  });

  r.post('/contacts', validate({ body: contactBody }), asyncHandler(async (req, res) => {
    const count = await d.db.trustedContact.count({ where: { userId: req.user.id } });
    if (count >= MAX_CONTACTS) { res.status(409).json({ error: { code: 'CONTACTS_FULL', message: `You can save up to ${MAX_CONTACTS} people.` } }); return; }
    const c = await d.db.trustedContact.create({
      data: { userId: req.user.id, nameEncrypted: d.cipher.encrypt(req.body.name), phoneEncrypted: d.cipher.encrypt(req.body.phone), relation: req.body.relation },
    });
    res.status(201).json({ data: view(c) });
  }));

  r.put('/contacts/:id', validate({ params: z.object({ id: z.string().uuid() }), body: contactBody }), asyncHandler(async (req, res) => {
    const done = await d.db.trustedContact.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { nameEncrypted: d.cipher.encrypt(req.body.name), phoneEncrypted: d.cipher.encrypt(req.body.phone), relation: req.body.relation },
    });
    if (!done.count) throw notFound('Contact not found');
    const c = await d.db.trustedContact.findFirstOrThrow({ where: { id: req.params.id, userId: req.user.id } });
    res.json({ data: view(c) });
  }));

  r.delete('/contacts/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.trustedContact.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Contact not found');
    res.status(204).end();
  }));

  const readPlan = async (userId: string) => {
    const row = await d.db.safetyPlan.findUnique({ where: { userId } });
    if (!row) return { plan: emptyPlan(), updatedAt: null as Date | null };
    const parsed = planSchema.safeParse(JSON.parse(d.cipher.decrypt(row.encryptedContent)));
    return { plan: parsed.success ? parsed.data : emptyPlan(), updatedAt: row.updatedAt as Date | null };
  };

  r.get('/plan', asyncHandler(async (req, res) => {
    res.json({ data: await readPlan(req.user.id) });
  }));

  r.put('/plan', validate({ body: planSchema }), asyncHandler(async (req, res) => {
    const encryptedContent = d.cipher.encrypt(JSON.stringify(req.body));
    const row = await d.db.safetyPlan.upsert({
      where: { userId: req.user.id }, create: { userId: req.user.id, encryptedContent }, update: { encryptedContent },
    });
    res.json({ data: { plan: req.body as Plan, updatedAt: row.updatedAt } });
  }));

  return r;
}
