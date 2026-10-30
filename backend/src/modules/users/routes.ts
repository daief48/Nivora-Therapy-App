import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import { CONSENT_TYPES, CONSENT_VERSION } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

const patchBody = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  locale: z.enum(['en', 'bn', 'mixed']).optional(),
  timezone: z.string().max(64).optional(),
  countryCode: z.string().length(2).nullable().optional(),
  preferences: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 30).optional(),
}).strict();

export function usersRouter(d: Deps) {
  const r = Router();
  r.use('/me', d.authenticate); // mounted at "/", so scope auth to /me only

  r.get('/me', asyncHandler(async (req, res) => {
    const u = await d.db.user.findUnique({ where: { id: req.user.id }, include: { profile: true } });
    if (!u) throw notFound();
    res.json({ data: {
      id: u.id, email: u.email, locale: u.locale, timezone: u.timezone, createdAt: u.createdAt,
      displayName: u.profile?.displayName, countryCode: u.profile?.countryCode ?? null, preferences: u.profile?.preferencesJson ?? {},
    } });
  }));

  r.patch('/me', validate({ body: patchBody }), asyncHandler(async (req, res) => {
    const { displayName, locale, timezone, countryCode, preferences } = req.body;
    const u = await d.db.user.update({
      where: { id: req.user.id },
      data: {
        ...(locale && { locale }), ...(timezone && { timezone }),
        profile: { update: {
          ...(displayName && { displayName }),
          ...(countryCode !== undefined && { countryCode: countryCode?.toUpperCase() ?? null }),
          ...(preferences && { preferencesJson: preferences }),
        } },
      },
      include: { profile: true },
    });
    res.json({ data: { id: u.id, locale: u.locale, timezone: u.timezone, displayName: u.profile?.displayName, countryCode: u.profile?.countryCode ?? null, preferences: u.profile?.preferencesJson ?? {} } });
  }));
  return r;
}

export function consentsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  r.get('/', asyncHandler(async (req, res) => {
    res.json({ data: await d.db.userConsent.findMany({ where: { userId: req.user.id }, orderBy: { grantedAt: 'desc' } }) });
  }));
  r.post('/', validate({ body: z.object({ consentType: z.enum(CONSENT_TYPES) }) }), asyncHandler(async (req, res) => {
    const existing = await d.db.userConsent.findFirst({ where: { userId: req.user.id, consentType: req.body.consentType, withdrawnAt: null } });
    if (existing) { res.json({ data: existing }); return; }
    const c = await d.db.userConsent.create({ data: { userId: req.user.id, consentType: req.body.consentType, consentVersion: CONSENT_VERSION } });
    res.status(201).json({ data: c });
  }));
  r.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const done = await d.db.userConsent.updateMany({ where: { id: req.params.id, userId: req.user.id, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    if (!done.count) throw notFound('Consent not found');
    res.status(204).end();
  }));
  return r;
}
