import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { anonId, sanitizeProps } from '../modules/analytics/routes.js';
import { auth, db, makeApp, register } from './helpers.js';

const app = makeApp();

describe('analytics', () => {
  it('sanitizes props to allowlisted keys and safe primitives', () => {
    expect(sanitizeProps({ screen: 'Home', note: 'free text', feature: 'a b c', count: 3, ok: true, mode: { x: 1 } }))
      .toEqual({ screen: 'Home', count: 3, ok: true });
  });

  it('anon id rotates daily and does not contain the user id', () => {
    const a = anonId('secret', 'user-1', '2026-01-01');
    expect(a).toBe(anonId('secret', 'user-1', '2026-01-01'));
    expect(a).not.toBe(anonId('secret', 'user-1', '2026-01-02'));
    expect(a).not.toContain('user-1');
  });

  it('requires auth, stores allowlisted events only, no user id', async () => {
    expect((await request(app).post('/api/v1/analytics/events').send({ events: [{ name: 'screen_view' }] })).status).toBe(401);
    const u = await register(app);
    const before = await db.analyticsEvent.count();
    const res = await request(app).post('/api/v1/analytics/events').set(auth(u.accessToken))
      .send({ events: [{ name: 'screen_view', props: { screen: 'Home', secret: 'x' } }, { name: 'my_private_event' }] });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ accepted: 1, dropped: 1 });
    expect(await db.analyticsEvent.count()).toBe(before + 1);
    const row = await db.analyticsEvent.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(row)).not.toContain(u.userId);
    expect(row!.propsJson).toEqual({ screen: 'Home' });
    expect((await request(app).post('/api/v1/analytics/events').set(auth(u.accessToken)).send({ events: [] })).status).toBe(400);
  });
});
