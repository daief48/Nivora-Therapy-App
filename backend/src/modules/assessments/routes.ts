import { Router } from 'express';
import { z } from 'zod';
import { customLimiter, defaultLimits } from '../../middleware/rateLimiter.js';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { INSTRUMENT_DEFS, INSTRUMENTS, type Instrument } from '../../services/assessmentContent.js';
import { createAssessment, latestPerInstrument, listAssessments } from '../../services/assessmentService.js';
import { getResources } from '../../services/safetyService.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

export function assessmentsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const limiter = customLimiter(20, { ...defaultLimits, redisUrl: d.config.REDIS_URL });
  const inst = z.enum(INSTRUMENTS);
  // Raw answers are never returned: the app only needs totals and bands.
  const view = (v: { id: string; instrument: string; total: number; severity: string; createdAt: Date }) =>
    ({ id: v.id, instrument: v.instrument, total: v.total, severity: v.severity, createdAt: v.createdAt });

  r.get('/instruments', (_req, res) => { res.json({ data: INSTRUMENTS.map((i) => INSTRUMENT_DEFS[i]) }); });

  r.get('/latest', asyncHandler(async (req, res) => {
    res.json({ data: await latestPerInstrument(d.db, d.cipher, req.user.id) });
  }));

  r.get('/', validate({ query: z.object({ instrument: inst.optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }) }), asyncHandler(async (req, res) => {
    const { instrument, limit } = q<{ instrument?: Instrument; limit: number }>(req);
    const rows = await listAssessments(d.db, d.cipher, req.user.id, { instrument, take: limit });
    res.json({ data: rows.map(view) });
  }));

  r.post('/', limiter, validate({ body: z.object({ instrument: inst, answers: z.array(z.number()).max(20) }) }), asyncHandler(async (req, res) => {
    const out = await createAssessment(d.db, d.cipher, req.user.id, req.body.instrument, req.body.answers);
    let resources: unknown[] = [];
    if (out.item9Flag) {
      const profile = await d.db.userProfile.findUnique({ where: { userId: req.user.id }, select: { countryCode: true } });
      resources = await getResources(d.db, profile?.countryCode);
    }
    res.status(201).json({ data: { ...view(out.view), item9Flag: out.item9Flag, resources } });
  }));

  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.assessment.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!done.count) throw notFound('Assessment not found');
    res.status(204).end();
  }));
  return r;
}
