import { describe, expect, it } from 'vitest';
import { createCache } from '../services/cache.js';

describe('cache', () => {
  it('memory cache get/set/del with ttl', async () => {
    const c = createCache();
    expect(await c.get('k')).toBeUndefined();
    await c.set('k', { a: 1 }, 60);
    expect(await c.get('k')).toEqual({ a: 1 });
    await c.del('k');
    expect(await c.get('k')).toBeUndefined();
    await c.set('short', 1, -1);
    expect(await c.get('short')).toBeUndefined();
  });

  it('unreachable REDIS_URL degrades silently to memory', async () => {
    const c = createCache('redis://127.0.0.1:1');
    await c.set('x', 'y', 60);
    expect(await c.get('x')).toBe('y');
  });
});
