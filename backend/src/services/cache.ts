import { Redis } from 'ioredis';

export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

const clients = new Map<string, Redis>();
/** Shared lazy ioredis client. Never throws and never queues commands while down, so callers degrade to memory. */
export function getRedis(url?: string): Redis | null {
  if (!url) return null;
  let c = clients.get(url);
  if (!c) {
    try {
      c = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, retryStrategy: (n) => Math.min(n * 500, 10_000) });
      c.on('error', () => { /* degrade silently */ });
      c.connect().catch(() => { /* retryStrategy keeps trying */ });
      clients.set(url, c);
    } catch { return null; }
  }
  return c;
}

/** In-memory by default; Redis when REDIS_URL is set. Any Redis error falls back to the memory copy. */
export function createCache(redisUrl?: string): Cache {
  const mem = new Map<string, { v: unknown; exp: number }>();
  const redis = getRedis(redisUrl);
  const fromMem = <T>(key: string) => {
    const e = mem.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { mem.delete(key); return undefined; }
    return e.v as T;
  };
  return {
    async get<T>(key: string) {
      if (redis?.status === 'ready') {
        try { const raw = await redis.get(key); if (raw !== null) return JSON.parse(raw) as T; return undefined; } catch { /* fall through */ }
      }
      return fromMem<T>(key);
    },
    async set(key, value, ttlSeconds) {
      mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
      if (mem.size > 500) for (const [k, e] of mem) if (e.exp < Date.now()) mem.delete(k);
      if (redis?.status === 'ready') { try { await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* memory copy kept */ } }
    },
    async del(key) {
      mem.delete(key);
      if (redis?.status === 'ready') { try { await redis.del(key); } catch { /* ignore */ } }
    },
  };
}
