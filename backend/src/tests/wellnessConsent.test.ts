import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDate } from '../utils/dates.js';
import { auth, makeApp, register, fakeGlm } from './helpers.js';

type App = ReturnType<typeof makeApp>;
const grant = (app: App, token: string, consentType: string) =>
  request(app).post('/api/v1/consents').set(auth(token)).send({ consentType }).expect(201);

function expectConsentRequired(res: request.Response, consentType: string) {
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  expect(res.body.error.details.consentType).toBe(consentType);
}

/** Two sleep entries (UTC "today" and yesterday; new users default to UTC) so the daily analysis has enough data to call the model. */
async function seedSleep(app: App, token: string) {
  const today = localDate('UTC');
  for (const date of [addDays(today, -1), today]) {
    await request(app).post('/api/v1/sleep').set(auth(token)).send({ bedtime: '23:00', wakeTime: '07:00', rested: 6, date }).expect(201);
  }
}

describe('AI tools need an explicit consent before any model call', () => {
  it('sleep coach: blocked without consent, AI with consent, rule-based tip (ai:false) when the model fails', async () => {
    const glm = fakeGlm('Try winding down 15 minutes earlier tonight.');
    const app = makeApp({ glm });
    const u = await register(app);
    await seedSleep(app, u.accessToken);
    expectConsentRequired(await request(app).post('/api/v1/sleep/coach').set(auth(u.accessToken)), 'WELLNESS_AI_SHARING');
    expect(glm.calls.length).toBe(0);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const ok = await request(app).post('/api/v1/sleep/coach').set(auth(u.accessToken));
    expect(ok.body.data.ai).toBe(true);
    expect(glm.calls.length).toBe(1);

    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const u2 = await register(bad);
    await seedSleep(bad, u2.accessToken);
    await grant(bad, u2.accessToken, 'WELLNESS_AI_SHARING');
    const fb = await request(bad).post('/api/v1/sleep/coach').set(auth(u2.accessToken));
    expect(fb.body.data.ai).toBe(false);
    expect(fb.body.data.text).toBeTruthy();
  });

  it('daily analysis: blocked without consent, AI with consent, template (ai:false) on failure', async () => {
    const glm = fakeGlm('You slept better on calmer days. Try a short walk tomorrow.');
    const app = makeApp({ glm });
    const u = await register(app);
    await seedSleep(app, u.accessToken);
    expectConsentRequired(await request(app).post('/api/v1/insights/analysis').set(auth(u.accessToken)), 'WELLNESS_AI_SHARING');
    expect(glm.calls.length).toBe(0);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const ok = await request(app).post('/api/v1/insights/analysis').set(auth(u.accessToken));
    expect(ok.body.data.ai).toBe(true);
    expect(glm.calls.length).toBe(1);

    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const u2 = await register(bad);
    await seedSleep(bad, u2.accessToken);
    await grant(bad, u2.accessToken, 'WELLNESS_AI_SHARING');
    const fb = await request(bad).post('/api/v1/insights/analysis').set(auth(u2.accessToken));
    expect(fb.body.data.ai).toBe(false);
    expect(fb.body.data.text).toBeTruthy();
  });

  it('kaizen weekly review: blocked without consent, AI with consent, template (ai:false) on failure', async () => {
    const setup = async (app: App) => {
      const u = await register(app);
      await request(app).post('/api/v1/kaizen/goals').set(auth(u.accessToken)).send({ title: 'Calm', category: 'BREATHING' }).expect(201);
      await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken)).expect(200);
      return u;
    };
    const glm = fakeGlm('You showed up for a small step this week. Keep one focus next week.');
    const app = makeApp({ glm });
    const u = await setup(app);
    expectConsentRequired(await request(app).post('/api/v1/kaizen/weekly-review').set(auth(u.accessToken)), 'WELLNESS_AI_SHARING');
    expect(glm.calls.length).toBe(0);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const ok = await request(app).post('/api/v1/kaizen/weekly-review').set(auth(u.accessToken));
    expect(ok.body.data.ai).toBe(true);
    expect(glm.calls.length).toBe(1);

    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const u2 = await setup(bad);
    await grant(bad, u2.accessToken, 'WELLNESS_AI_SHARING');
    const fb = await request(bad).post('/api/v1/kaizen/weekly-review').set(auth(u2.accessToken));
    expect(fb.body.data.ai).toBe(false);
    expect(fb.body.data.text).toBeTruthy();
  });

  it('journal prompts: blocked without JOURNAL_AI_SHARING, AI with consent, static list (ai:false) on failure', async () => {
    const glm = fakeGlm('{"prompts":["What felt soft today?","What do you need?","What are you thankful for?"]}');
    const app = makeApp({ glm });
    const u = await register(app);
    expectConsentRequired(await request(app).post('/api/v1/journal-ai/prompts').set(auth(u.accessToken)).send({ mood: 4 }), 'JOURNAL_AI_SHARING');
    expect(glm.calls.length).toBe(0);
    await grant(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const ok = await request(app).post('/api/v1/journal-ai/prompts').set(auth(u.accessToken)).send({ mood: 4 });
    expect(ok.body.data.ai).toBe(true);

    const bad = makeApp({ glm: fakeGlm(new Error('down')) });
    const u2 = await register(bad);
    await grant(bad, u2.accessToken, 'JOURNAL_AI_SHARING');
    const fb = await request(bad).post('/api/v1/journal-ai/prompts').set(auth(u2.accessToken)).send({});
    expect(fb.body.data.ai).toBe(false);
    expect(fb.body.data.prompts).toHaveLength(3);
  });

  it('a withdrawn consent blocks again before the model is called', async () => {
    const glm = fakeGlm('Try winding down earlier.');
    const app = makeApp({ glm });
    const u = await register(app);
    await seedSleep(app, u.accessToken);
    const c = await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    await request(app).delete(`/api/v1/consents/${c.body.data.id}`).set(auth(u.accessToken)).expect(204);
    expectConsentRequired(await request(app).post('/api/v1/sleep/coach').set(auth(u.accessToken)), 'WELLNESS_AI_SHARING');
    expect(glm.calls.length).toBe(0);
  });

  it('model output that fails checkOutput is replaced by the template (ai:false) in all three tools', async () => {
    const glm = fakeGlm('You probably have depression, so you should rest.');
    const app = makeApp({ glm });
    const u = await register(app);
    await seedSleep(app, u.accessToken);
    await request(app).post('/api/v1/kaizen/goals').set(auth(u.accessToken)).send({ title: 'Calm', category: 'BREATHING' }).expect(201);
    await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken)).expect(200);
    await grant(app, u.accessToken, 'WELLNESS_AI_SHARING');
    for (const path of ['/api/v1/sleep/coach', '/api/v1/insights/analysis', '/api/v1/kaizen/weekly-review']) {
      const r = await request(app).post(path).set(auth(u.accessToken));
      expect(r.status).toBe(200);
      expect(r.body.data.ai).toBe(false);
      expect(r.body.data.text).not.toMatch(/depression/);
    }
    expect(glm.calls.length).toBe(3); // the model was called, its output was rejected
  });
});
