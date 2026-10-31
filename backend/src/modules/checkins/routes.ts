import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import { assessSafely, crisisMessage, getResources } from '../../services/safetyService.js';
import { crisisLang } from '../../services/crisisResponse.js';
import { CHECKIN_TAGS, parseTags } from '../../services/reportService.js';
import type { Deps } from '../deps.js';

const score = z.number().int().min(1).max(10);
const body = z.object({
  kind: z.enum(['MORNING', 'EVENING']),
  mood: score, stress: score, energy: score,
  sleepQuality: z.enum(['POOR', 'OKAY', 'GOOD', 'GREAT']).optional(),
  rested: score.optional(),
  worry: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(3000).optional(),
  tags: z.array(z.enum(CHECKIN_TAGS)).max(CHECKIN_TAGS.length).optional(),
});

export function checkinsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const view = (c: any) => ({
    id: c.id, kind: c.kind, mood: c.mood, stress: c.stress, energy: c.energy, sleepQuality: c.sleepQuality, rested: c.rested,
    worry: c.worryEncrypted ? d.cipher.decrypt(c.worryEncrypted) : null, note: c.noteEncrypted ? d.cipher.decrypt(c.noteEncrypted) : null, tags: parseTags(c.tags), createdAt: c.createdAt,
  });

  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const b = req.body;
    // Free text gets the same rule-based safety check as chat. High-risk text is never stored.
    const text = [b.worry, b.note].filter(Boolean).join('\n');
    const a = text ? assessSafely(text) : { severity: 'NONE' as const, categories: [] as string[] };
    const high = a.severity === 'HIGH' || a.severity === 'IMMINENT';
    const entry = await d.db.checkIn.create({ data: {
      userId: req.user.id, kind: b.kind, mood: b.mood, stress: b.stress, energy: b.energy, sleepQuality: b.sleepQuality, rested: b.rested, tags: [...new Set<string>(b.tags ?? [])].join(','),
      worryEncrypted: !high && b.worry ? d.cipher.encrypt(b.worry) : null, noteEncrypted: !high && b.note ? d.cipher.encrypt(b.note) : null,
    } });
    let safety: unknown = { severity: a.severity, crisis: false };
    if (high || a.severity === 'ELEVATED') {
      const profile = await d.db.userProfile.findUnique({ where: { userId: req.user.id } });
      const resources = await getResources(d.db, profile?.countryCode);
      await d.db.safetyEvent.create({ data: { userId: req.user.id, severity: a.severity, category: a.categories.join(',') || null, actionTaken: high ? 'CRISIS_RESPONSE_SHOWN' : 'SUPPORT_FOOTER_ADDED' } });
      safety = { severity: a.severity, crisis: high, resources, message: high ? crisisMessage(a.severity, crisisLang(text, (await d.db.user.findUnique({ where: { id: req.user.id }, select: { locale: true } }))?.locale), resources) : null };
    }
    res.status(201).json({ data: { ...view(entry), safety } });
  }));

  r.get('/', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(60), kind: z.enum(['MORNING', 'EVENING']).optional() }) }),
    asyncHandler(async (req, res) => {
      const { limit, kind } = q<{ limit: number; kind?: string }>(req);
      const rows = await d.db.checkIn.findMany({ where: { userId: req.user.id, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, take: limit });
      res.json({ data: rows.map(view) });
    }));

  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.checkIn.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Check-in not found');
    res.status(204).end();
  }));
  return r;
}
