import { Router } from 'express';
import { z } from 'zod';
import { customLimiter, defaultLimits } from '../../middleware/rateLimiter.js';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { assessSafely } from '../../services/safetyService.js';
import { scrub } from '../../services/piiScrubber.js';
import { badRequest, conflict, consentRequired, notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const LAST_N = 12;
const MAX_SAMPLES = 50;
const MAX_CHARS = 1500;
const uuid = z.string().uuid();

interface SampleContent { v: 1; messages: { role: string; text: string }[]; redactions: number }

/**
 * Opt-in quality review. A sample is a short, de-identified excerpt the user chose to share; it is stored encrypted,
 * is visible to its owner, and is deleted on revoke. Crisis sessions and "don't remember" sessions are never sampled.
 */
export function qualityRouter(d: Deps) {
  const r = Router();
  const limiter = customLimiter(10, { ...defaultLimits, redisUrl: d.config.REDIS_URL });
  r.use(d.authenticate);

  const prefsOf = async (userId: string) => {
    const p = await d.db.userProfile.findUnique({ where: { userId }, select: { displayName: true, preferencesJson: true } });
    return { displayName: p?.displayName ?? null, prefs: (p?.preferencesJson ?? {}) as Record<string, unknown> };
  };

  r.post('/samples', limiter, validate({ body: z.object({ sessionId: uuid }) }), asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const { displayName, prefs } = await prefsOf(uid);
    if (prefs.qualityReviewOptIn !== true) throw consentRequired('Sharing excerpts for quality review is turned off');

    const session = await d.db.therapySession.findFirst({ where: { id: req.body.sessionId, userId: uid } });
    if (!session) throw notFound('Session not found');
    if (!session.rememberThis) throw badRequest('This session was marked as not to be kept');
    const crisis = await d.db.safetyEvent.count({ where: { userId: uid, sessionId: session.id, severity: { in: ['HIGH', 'IMMINENT'] } } });
    if (crisis > 0 || session.riskFlag === 'HIGH') throw badRequest('This session is not eligible for sharing');
    if ((await d.db.qualityReviewSample.count({ where: { userId: uid } })) >= MAX_SAMPLES) throw conflict('Sample limit reached; delete some first');

    const rows = await d.db.sessionMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, take: LAST_N });
    const plain = rows.reverse().map((m) => ({ role: m.role, text: d.cipher.decrypt(m.encryptedContent).slice(0, MAX_CHARS) }));
    // Defence in depth: a crisis message that was never logged as an event still blocks the whole sample.
    if (plain.some((m) => m.role === 'user' && ['HIGH', 'IMMINENT'].includes(assessSafely(m.text).severity))) throw badRequest('This session is not eligible for sharing');
    if (!plain.length) throw badRequest('This session has no messages to share');

    let redactions = 0;
    const messages = plain.map((m) => { const s = scrub(m.text, { names: [displayName] }); redactions += s.redactions; return { role: m.role, text: s.text }; });
    const content: SampleContent = { v: 1, messages, redactions };
    const row = await d.db.qualityReviewSample.create({ data: { userId: uid, encryptedContent: d.cipher.encrypt(JSON.stringify(content)) } });
    res.status(201).json({ data: { id: row.id, createdAt: row.createdAt, messageCount: messages.length, redactions } });
  }));

  r.get('/samples', asyncHandler(async (req, res) => {
    const rows = await d.db.qualityReviewSample.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: MAX_SAMPLES });
    res.json({ data: rows.map((s) => {
      const c = JSON.parse(d.cipher.decrypt(s.encryptedContent)) as SampleContent;
      return { id: s.id, createdAt: s.createdAt, redactions: c.redactions, messages: c.messages };
    }) });
  }));

  r.delete('/samples/:id', validate({ params: z.object({ id: uuid }) }), asyncHandler(async (req, res) => {
    const out = await d.db.qualityReviewSample.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!out.count) throw notFound('Sample not found');
    res.status(204).end();
  }));

  r.delete('/samples', asyncHandler(async (req, res) => {
    const out = await d.db.qualityReviewSample.deleteMany({ where: { userId: req.user.id } });
    res.json({ data: { deleted: out.count } });
  }));

  // Revocation: stop sharing and erase everything already shared.
  r.post('/revoke', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const { prefs } = await prefsOf(uid);
    const [out] = await d.db.$transaction([
      d.db.qualityReviewSample.deleteMany({ where: { userId: uid } }),
      d.db.userProfile.updateMany({ where: { userId: uid }, data: { preferencesJson: { ...prefs, qualityReviewOptIn: false } } }),
    ]);
    res.json({ data: { deleted: out.count, qualityReviewOptIn: false } });
  }));
  return r;
}
