import rateLimit from 'express-rate-limit';

export interface RateLimits { global: number; auth: number; messages: number; tts: number; windowMs: number }
export const defaultLimits: RateLimits = { global: 300, auth: 10, messages: 20, tts: 60, windowMs: 60_000 };

const make = (max: number, windowMs: number, keyer: (req: any) => string) =>
  rateLimit({
    windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: keyer,
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', requestId: (req as any).id } });
    },
  });

export const globalLimiter = (l: RateLimits) => make(l.global, l.windowMs, (r) => r.ip ?? 'unknown');
export const authLimiter = (l: RateLimits) => make(l.auth, l.windowMs, (r) => r.ip ?? 'unknown');
// AI messages are limited per user, not per IP.
// Speech is requested per sentence-sized chunk, so it gets a higher per-user budget than chat messages.
export const ttsLimiter = (l: RateLimits) => make(l.tts, l.windowMs, (r) => r.user?.id ?? r.ip ?? 'unknown');
export const messageLimiter = (l: RateLimits) => make(l.messages, l.windowMs, (r) => r.user?.id ?? r.ip ?? 'unknown');
