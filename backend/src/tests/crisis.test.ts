import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, makeApp, register } from './helpers.js';

const app = makeApp();
const base = '/api/v1/crisis';

describe('crisis: trusted contacts', () => {
  it('CRUD, encrypted at rest, per-user, capped at 5', async () => {
    const u = await register(app);
    const other = await register(app);
    const c = await request(app).post(`${base}/contacts`).set(auth(u.accessToken)).send({ name: 'Amina', phone: '+880 1711-000000', relation: 'Sister' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ name: 'Amina', phone: '+880 1711-000000', relation: 'Sister' });

    const raw = await db.trustedContact.findUniqueOrThrow({ where: { id: c.body.data.id } });
    expect(raw.nameEncrypted).not.toContain('Amina');
    expect(raw.phoneEncrypted).not.toContain('1711');

    const upd = await request(app).put(`${base}/contacts/${c.body.data.id}`).set(auth(u.accessToken)).send({ name: 'Amina R', phone: '01711000000' });
    expect(upd.body.data).toMatchObject({ name: 'Amina R', relation: null });
    expect((await request(app).put(`${base}/contacts/${c.body.data.id}`).set(auth(other.accessToken)).send({ name: 'x', phone: '12345' })).status).toBe(404);
    expect((await request(app).get(`${base}/contacts`).set(auth(other.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).post(`${base}/contacts`).set(auth(u.accessToken)).send({ name: 'Bad', phone: 'abc' })).status).toBe(400);

    for (let i = 0; i < 4; i++) await request(app).post(`${base}/contacts`).set(auth(u.accessToken)).send({ name: `P${i}`, phone: '1234567' });
    const full = await request(app).post(`${base}/contacts`).set(auth(u.accessToken)).send({ name: 'Six', phone: '1234567' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('CONTACTS_FULL');

    expect((await request(app).delete(`${base}/contacts/${c.body.data.id}`).set(auth(u.accessToken))).status).toBe(204);
    expect((await request(app).get(`${base}/contacts`).set(auth(u.accessToken))).body.data).toHaveLength(4);
  });

  it('requires authentication', async () => {
    expect((await request(app).get(`${base}/contacts`)).status).toBe(401);
    expect((await request(app).get(`${base}/plan`)).status).toBe(401);
  });
});

describe('crisis: safety plan', () => {
  it('returns an empty plan, saves it encrypted, and validates sizes', async () => {
    const u = await register(app);
    const empty = await request(app).get(`${base}/plan`).set(auth(u.accessToken));
    expect(empty.body.data.plan.warningSigns).toEqual([]);
    expect(empty.body.data.updatedAt).toBeNull();

    const plan = { warningSigns: ['Not sleeping'], copingSteps: ['Slow breathing'], reasonsToLive: ['My family'] };
    const put = await request(app).put(`${base}/plan`).set(auth(u.accessToken)).send(plan);
    expect(put.status).toBe(200);
    const got = await request(app).get(`${base}/plan`).set(auth(u.accessToken));
    expect(got.body.data.plan).toMatchObject({ warningSigns: ['Not sleeping'], reasonsToLive: ['My family'], distractions: [] });

    const raw = await db.safetyPlan.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(raw.encryptedContent).not.toContain('Not sleeping');

    expect((await request(app).put(`${base}/plan`).set(auth(u.accessToken)).send({ warningSigns: Array(11).fill('a') })).status).toBe(400);
    expect((await request(app).put(`${base}/plan`).set(auth(u.accessToken)).send({ copingSteps: ['x'.repeat(201)] })).status).toBe(400);
  });
});

describe('crisis: resources expose sourceUrl only when verified', () => {
  it('serves sourceUrl for verified rows and null otherwise', async () => {
    const a = await db.supportResource.upsert({
      where: { countryCode_resourceType_name: { countryCode: 'ZZ', resourceType: 'EMERGENCY', name: 'T verified' } },
      create: { countryCode: 'ZZ', language: 'en', resourceType: 'EMERGENCY', name: 'T verified', contactDetails: '111', lastVerifiedAt: new Date(), sourceUrl: 'https://example.gov/x' }, update: {},
    });
    await db.supportResource.upsert({
      where: { countryCode_resourceType_name: { countryCode: 'ZZ', resourceType: 'EMERGENCY', name: 'T unverified' } },
      create: { countryCode: 'ZZ', language: 'en', resourceType: 'EMERGENCY', name: 'T unverified', contactDetails: '222' }, update: {},
    });
    expect(a.id).toBeTruthy();
    const res = await request(app).get('/api/v1/resources/crisis?country=zz');
    const rows = res.body.data.resources as { name: string; verified: boolean; sourceUrl: string | null }[];
    expect(rows.find((r) => r.name === 'T verified')).toMatchObject({ verified: true, sourceUrl: 'https://example.gov/x' });
    expect(rows.find((r) => r.name === 'T unverified')).toMatchObject({ verified: false, sourceUrl: null });
  });
});
