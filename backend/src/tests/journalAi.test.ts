import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, makeApp, register, fakeGlm } from './helpers.js';

describe('journal AI', () => {
  it('prompts: returns three prompts, falls back to the static list when the AI fails', async () => {
    const ok = makeApp({ glm: fakeGlm('{"prompts":["What felt soft today?","What do you need?","What are you thankful for?"]}') });
    const u = await register(ok);
    const r = await request(ok).post('/api/v1/journal-ai/prompts').set(auth(u.accessToken)).send({ mood: 4, stress: 7 });
    expect(r.body.data.prompts).toHaveLength(3);
    expect(r.body.data.ai).toBe(true);
    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const u2 = await register(bad);
    const f = await request(bad).post('/api/v1/journal-ai/prompts').set(auth(u2.accessToken)).send({});
    expect(f.body.data.prompts).toHaveLength(3);
    expect(f.body.data.ai).toBe(false);
  });

  it('emotions: needs consent, returns words, and never calls the model on crisis text', async () => {
    const glm = fakeGlm('{"emotions":["tired","worried"],"reflection":"Words that showed up in your writing: tired, worried.","suggestion":"Take three slow breaths."}');
    const app = makeApp({ glm });
    const u = await register(app);
    const no = await request(app).post('/api/v1/journal-ai/emotions').set(auth(u.accessToken)).send({ text: 'Long day, I am tired and worried.' });
    expect(no.status).toBe(403);
    expect(no.body.error.code).toBe('CONSENT_REQUIRED');
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
    const ok = await request(app).post('/api/v1/journal-ai/emotions').set(auth(u.accessToken)).send({ text: 'Long day, I am tired and worried.' });
    expect(ok.body.data.emotions).toEqual(['tired', 'worried']);
    expect(ok.body.data.crisis).toBe(false);
    const calls = glm.calls.length;
    const crisis = await request(app).post('/api/v1/journal-ai/emotions').set(auth(u.accessToken)).send({ text: 'I want to kill myself' });
    expect(crisis.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(calls);
  });

  it('kaizen garden: counts completed steps as flowers', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    await request(app).post('/api/v1/kaizen/goals').set(auth(u.accessToken)).send({ title: 'Calm', category: 'BREATHING' });
    const t = await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken));
    await request(app).post(`/api/v1/kaizen/actions/${t.body.data.action.id}/complete`).set(auth(u.accessToken)).send({ level: 'FULL' });
    const g = await request(app).get('/api/v1/kaizen/garden').set(auth(u.accessToken));
    expect(g.body.data.total).toBe(1);
    expect(g.body.data.flowers).toHaveLength(1);
    expect(g.body.data.flowers[0].kind).toBe('BUD');
    expect(g.body.data.days).toHaveLength(90);
    expect(g.body.data.days.at(-1).count).toBe(1);
  });
});
