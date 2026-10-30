import rateLimit, { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { getRedis } from '../services/cache.js';

export interface RateLimits { global: number; auth: number; messages: number; tts: number; windowMs: number; redisUrl?: string }
export const defaultLimits: RateLimits = { global: 300, auth: 10, messages: 20, tts: 60, windowMs: 60_000 };

/** Fixed-window counter in Redis; on any Redis error it uses an in-process MemoryStore so requests are never blocked by an outage. */
class RedisRateStore implements Store {
  localKeys = false; // counters are shared across server instances
  private mem = new MemoryStore();
  private windowMs = 60_000;
  constructor(private url: string, private keyPrefix: string) {}
  init(options: Options) { this.windowMs = options.windowMs; this.mem.init(options); }
  private ready() { const r = getRedis(this.url); return r?.status === 'ready' ? r : null; }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const r = this.ready();
    if (r) {
      try {
        const k = `${this.keyPrefix}${key}`;
        const hits = await r.incr(k);
        if (hits === 1) await r.pexpire(k, this.windowMs);
        let ttl = await r.pttl(k);
        if (ttl < 0) { await r.pexpire(k, this.windowMs); ttl = this.windowMs; }
        return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
      } catch { /* fall back to memory */ }
    }
    return this.mem.increment(key);
  }
  async decrement(key: string) {
    const r = this.ready();
    if (r) { try { await r.decr(`${this.keyPrefix}${key}`); return; } catch { /* fall back */ } }
    await this.mem.decrement(key);
  }
  async resetKey(key: string) {
    const r = this.ready();
    if (r) { try { await r.del(`${this.keyPrefix}${key}`); } catch { /* ignore */ } }
    await this.mem.resetKey(key);
  }
}

let seq = 0;
const make = (max: number, windowMs: number, keyer: (req: any) => string, redisUrl?: string) =>
  rateLimit({
    windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: keyer,
    validate: { keyGeneratorIpFallback: false },
    ...(redisUrl ? { store: new RedisRateStore(redisUrl, `rl:${seq++}:`) } : {}),
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', requestId: (req as any).id } });
    },
  });

export const globalLimiter = (l: RateLimits) => make(l.global, l.windowMs, (r) => r.ip ?? 'unknown', l.redisUrl);
export const authLimiter = (l: RateLimits) => make(l.auth, l.windowMs, (r) => r.ip ?? 'unknown', l.redisUrl);
// AI messages are limited per user, not per IP.
// Speech is requested per sentence-sized chunk, so it gets a higher per-user budget than chat messages.
export const ttsLimiter = (l: RateLimits) => make(l.tts, l.windowMs, (r) => r.user?.id ?? r.ip ?? 'unknown', l.redisUrl);
export const messageLimiter = (l: RateLimits) => make(l.messages, l.windowMs, (r) => r.user?.id ?? r.ip ?? 'unknown', l.redisUrl);
/** Generic limiter for feature routes (e.g. analytics ingestion). */
export const customLimiter = (max: number, l: RateLimits) => make(max, l.windowMs, (r) => r.user?.id ?? r.ip ?? 'unknown', l.redisUrl);
