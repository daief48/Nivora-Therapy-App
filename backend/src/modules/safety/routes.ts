import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { assessSafely, crisisMessage, getResources, pickLang } from '../../services/safetyService.js';
import { createCache } from '../../services/cache.js';
import type { Deps } from '../deps.js';

const country = z.string().length(2).regex(/^[A-Za-z]{2}$/);

export function safetyRouter(d: Deps) {
  const r = Router();
  const cache = createCache(d.config.REDIS_URL);

  // Public so emergency information is reachable before signing in. Returns only rows stored in SupportResource.
  r.get('/resources/crisis', validate({ query: z.object({ country: country.optional() }) }), asyncHandler(async (req, res) => {
    const { country: c } = q<{ country?: string }>(req);
    const ck = `crisis:${c?.toUpperCase() ?? '-'}`;
    let resources = await cache.get<Awaited<ReturnType<typeof getResources>>>(ck);
    if (!resources) { resources = await getResources(d.db, c); await cache.set(ck, resources, 300); } // public reference data only
    res.json({ data: {
      country: c?.toUpperCase() ?? null, resources,
      fallback: 'If you are in immediate danger, contact your local emergency number or go to the nearest emergency room.',
      notice: 'Numbers marked unverified must be confirmed locally. This app cannot contact emergency services for you.',
    } });
  }));

  // Used by the app for text it wants checked (e.g. voice transcripts, journal text). Content is never stored.
  r.post('/safety/check', d.authenticate, validate({ body: z.object({ text: z.string().max(d.config.MAX_MESSAGE_CHARS), language: z.enum(['en', 'bn', 'mixed']).default('mixed') }) }),
    asyncHandler(async (req, res) => {
      const a = assessSafely(req.body.text);
      const profile = await d.db.userProfile.findUnique({ where: { userId: req.user.id }, select: { countryCode: true } });
      const resources = a.severity === 'NONE' ? [] : await getResources(d.db, profile?.countryCode);
      if (a.severity === 'HIGH' || a.severity === 'IMMINENT') {
        await d.db.safetyEvent.create({ data: { userId: req.user.id, severity: a.severity, category: a.categories.join(',') || null, actionTaken: 'CHECK_ENDPOINT_CRISIS' } });
      }
      const crisis = a.severity === 'HIGH' || a.severity === 'IMMINENT';
      res.json({ data: {
        severity: a.severity, crisis, resources, countryKnown: !!profile?.countryCode,
        message: crisis ? crisisMessage(a.severity, pickLang(req.body.language, req.body.text), resources) : null,
      } });
    }));
  return r;
}
