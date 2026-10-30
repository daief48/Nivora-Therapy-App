import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, makeApp, PASSWORD, register } from './helpers.js';

const app = makeApp();

describe('auth', () => {
  it('registers, logs in, and returns /me', async () => {
    const u = await register(app);
    const me = await request(app).get('/api/v1/me').set(auth(u.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(u.email);
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email.toUpperCase(), password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
    const row = await db.user.findUnique({ where: { id: u.userId } });
    expect(row!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('requires age, AI disclosure and privacy consent to register', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'noconsent@example.com', password: PASSWORD, displayName: 'x', consents: { age18Plus: false, aiDisclosure: true, privacy: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const u = await register(app);
    const weak = await request(app).post('/api/v1/auth/register').send({
      email: 'weak@example.com', password: 'short1', displayName: 'x', consents: { age18Plus: true, aiDisclosure: true, privacy: true },
    });
    expect(weak.status).toBe(400);
    const dup = await request(app).post('/api/v1/auth/register').send({
      email: u.email, password: PASSWORD, displayName: 'x', consents: { age18Plus: true, aiDisclosure: true, privacy: true },
    });
    expect(dup.status).toBe(409);
  });

  it('gives the same error for wrong password and unknown user', async () => {
    const u = await register(app);
    const a = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-1' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('rotates refresh tokens and detects reuse by revoking the family', async () => {
    const u = await register(app);
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.data.refreshToken).not.toBe(u.refreshToken);
    // Reusing the already-rotated token is treated as theft...
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    // ...and kills the newer token and access token too.
    const r2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.data.refreshToken });
    expect(r2.status).toBe(401);
    const me = await request(app).get('/api/v1/me').set(auth(r1.body.data.accessToken));
    expect(me.status).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const u = await register(app);
    expect((await request(app).post('/api/v1/auth/logout').send({ refreshToken: u.refreshToken })).status).toBe(204);
    expect((await request(app).get('/api/v1/me').set(auth(u.accessToken))).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
  });

  it('lists and revokes devices', async () => {
    const u = await register(app);
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD });
    const list = await request(app).get('/api/v1/auth/devices').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((d: any) => !d.current);
    await request(app).delete(`/api/v1/auth/devices/${other.id}`).set(auth(u.accessToken)).expect(204);
    expect((await request(app).get('/api/v1/me').set(auth(login.body.data.accessToken))).status).toBe(401);
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/me').set(auth('garbage'))).status).toBe(401);
    const u = await register(app);
    expect((await request(app).get('/api/v1/me').set(auth(u.accessToken + 'x'))).status).toBe(401);
  });

  it('password reset: answers 202 for unknown emails, resets, and revokes sessions', async () => {
    let sent = '';
    const a = makeApp({ mailer: { sendPasswordReset: async (_e, t) => { sent = t; } } });
    const u = await register(a);
    const unknown = await request(a).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(unknown.status).toBe(202);
    expect(sent).toBe('');
    expect((await request(a).post('/api/v1/auth/forgot-password').send({ email: u.email })).status).toBe(202);
    expect(sent).toBeTruthy();
    expect((await request(a).post('/api/v1/auth/reset-password').send({ token: sent, password: 'brand-new-pass-1' })).status).toBe(204);
    expect((await request(a).post('/api/v1/auth/reset-password').send({ token: sent, password: 'another-pass-22' })).status).toBe(400);
    expect((await request(a).get('/api/v1/me').set(auth(u.accessToken))).status).toBe(401);
    expect((await request(a).post('/api/v1/auth/login').send({ email: u.email, password: 'brand-new-pass-1' })).status).toBe(200);
  });
});

describe('request hygiene', () => {
  it('rate limits login attempts', async () => {
    const limited = makeApp({ limits: { auth: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await request(limited).post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'whatever-123' })).status);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('rejects oversized and malformed bodies with safe errors', async () => {
    const big = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{not json');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('SyntaxError');
  });

  it('exposes health/readiness and a request id, and unknown routes 404', async () => {
    expect((await request(app).get('/healthz')).body.status).toBe('ok');
    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.headers['x-request-id']).toBeTruthy();
    expect((await request(app).get('/api/v1/nope')).status).toBe(404);
  });
});
