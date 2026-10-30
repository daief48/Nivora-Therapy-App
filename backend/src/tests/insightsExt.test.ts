import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, makeApp, register } from './helpers.js';

const app = makeApp();

describe('Insights extensions', () => {
  it('check-ins store tags as arrays and stay backwards compatible', async () => {
    const u = await register(app);
    const a = await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'MORNING', mood: 6, stress: 5, energy: 5, tags: ['work', 'sleep', 'work'] });
    expect(a.status).toBe(201);
    expect(a.body.data.tags).toEqual(['work', 'sleep']);
    const b = await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'EVENING', mood: 6, stress: 5, energy: 5 });
    expect(b.body.data.tags).toEqual([]);
    const bad = await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'EVENING', mood: 6, stress: 5, energy: 5, tags: ['nope'] });
    expect(bad.status).toBe(400);
  });

  it('tag insights hide tags with fewer than 3 check-ins', async () => {
    const u = await register(app);
    for (let i = 0; i < 3; i++) await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'EVENING', mood: 8, stress: 3, energy: 6, tags: ['nature'] });
    await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'EVENING', mood: 3, stress: 8, energy: 3, tags: ['money'] });
    const r = await request(app).get('/api/v1/insights/tags?days=30').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data.tags.map((t: { tag: string }) => t.tag)).toEqual(['nature']);
    expect(r.body.data.tags[0].n).toBe(3);
    expect(r.body.data.tags[0].mood).toBe(8);
  });

  it('weekly report is structured, localised and private', async () => {
    const u = await register(app);
    await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'MORNING', mood: 5, stress: 5, energy: 5, tags: ['rest'] });
    const r = await request(app).get('/api/v1/insights/report?days=7').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data.range.days).toBe(7);
    expect(r.body.data.checkIns).toBe(1);
    expect(r.body.data.disclaimer).toMatch(/not a diagnosis/);
    expect(Array.isArray(r.body.data.observations)).toBe(true);
    const other = await register(app);
    const o = await request(app).get('/api/v1/insights/report').set(auth(other.accessToken));
    expect(o.body.data.checkIns).toBe(0);
  });
});
