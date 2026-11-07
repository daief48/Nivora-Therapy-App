import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../utils/logger.js';
import { auth, config, db, fakeGlm, register } from './helpers.js';

// The shipped default is ALLOW_STANDALONE_SESSIONS=0 (setupEnv forces '1' for the older suites).
// This suite runs the main session path under the real default: program -> sitting -> message -> end,
// and asserts a standalone session is refused with PROGRAM_REQUIRED.
const app = createApp({
  config: { ...config, ALLOW_STANDALONE_SESSIONS: '0' }, db, logger: createLogger('silent'), glm: fakeGlm(),
  limits: { global: 10_000, auth: 10_000, messages: 10_000 },
});

describe('main session path with ALLOW_STANDALONE_SESSIONS=0 (default)', () => {
  it('program -> sitting -> message works; standalone POST /sessions is PROGRAM_REQUIRED', async () => {
    const u = await register(app);

    const standalone = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' });
    expect(standalone.status).toBe(400);
    expect(standalone.body.error.code).toBe('PROGRAM_REQUIRED');

    const p = await request(app).post('/api/v1/session-programs').set(auth(u.accessToken))
      .send({ title: 'Sleeping better', goal: 'Fall asleep by 11', plannedDays: 3, dailyMinutes: 30, kind: 'SLEEP' });
    expect(p.status).toBe(201);

    const sit = await request(app).post(`/api/v1/session-programs/${p.body.data.id}/sittings`).set(auth(u.accessToken)).send({});
    expect(sit.status).toBe(201);
    const sid = sit.body.data.sittingId as string;

    const msg = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'I had a long day and feel tired' });
    expect(msg.status).toBe(201);

    const end = await request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(u.accessToken)).send({ force: true });
    expect(end.status).toBeLessThan(300);

    // opening a session through a (fresh) program is still allowed
    const p2 = await request(app).post('/api/v1/session-programs').set(auth(u.accessToken))
      .send({ title: 'Calmer mornings', plannedDays: 3, dailyMinutes: 30, kind: 'SLEEP' });
    const viaProgram = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ programId: p2.body.data.id });
    expect(viaProgram.status).toBe(201);
  });
});
