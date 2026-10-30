import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { customLimiter, defaultLimits } from '../../middleware/rateLimiter.js';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import type { Deps } from '../deps.js';

// Privacy-friendly analytics: allowlisted names and prop keys, primitive values only, never free text or user ids.
export const EVENT_NAMES = new Set([
  'screen_view', 'feature_used', 'check_in_completed', 'kaizen_step_completed', 'sleep_logged', 'program_day_completed',
  'call_started', 'call_ended', 'chat_session_started', 'journal_entry_saved', 'mood_logged', 'breathing_completed',
  'sound_played', 'message_feedback', 'crisis_resources_viewed', 'onboarding_completed', 'reminder_enabled', 'language_changed',
]);
export const PROP_KEYS = new Set(['screen', 'feature', 'kind', 'step', 'program', 'day_index', 'lang', 'mode', 'duration_bucket', 'count', 'ok', 'tab']);
const SAFE_STRING = /^[A-Za-z0-9_.:-]{1,32}$/;

export function sanitizeProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_KEYS.has(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100_000) out[k] = v;
    else if (typeof v === 'string' && SAFE_STRING.test(v)) out[k] = v;
  }
  return out;
}

/** Daily-rotating pseudonym: HMAC(HMAC(secret, "analytics:"+day), userId). No user id is stored and ids cannot be linked across days. */
export function anonId(secret: string, userId: string, day: string): string {
  const salt = createHmac('sha256', secret).update(`analytics:${day}`).digest();
  return createHmac('sha256', salt).update(userId).digest('hex').slice(0, 32);
}

const body = z.object({
  events: z.array(z.object({ name: z.string().max(40), props: z.record(z.string().max(40), z.unknown()).optional() })).min(1).max(50),
});

export function analyticsRouter(d: Deps) {
  const r = Router();
  const secret = d.config.ANALYTICS_SECRET || createHmac('sha256', d.config.JWT_ACCESS_SECRET).update('analytics-secret').digest('hex');
  const limiter = customLimiter(30, { ...defaultLimits, redisUrl: d.config.REDIS_URL });
  r.use(d.authenticate);

  r.post('/events', limiter, validate({ body }), asyncHandler(async (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    const id = anonId(secret, req.user.id, day);
    const rows = (req.body.events as { name: string; props?: Record<string, unknown> }[])
      .filter((e) => EVENT_NAMES.has(e.name))
      .map((e) => ({ name: e.name, day, anonId: id, propsJson: sanitizeProps(e.props) }));
    if (rows.length) await d.db.analyticsEvent.createMany({ data: rows });
    res.status(202).json({ data: { accepted: rows.length, dropped: req.body.events.length - rows.length } });
  }));
  return r;
}
