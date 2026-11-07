import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';
import { SOCRATIC_FALLBACKS } from '../services/kaizenAiService.js';

const SPLIT = JSON.stringify({ tasks: [{ title: 'Pick the book tonight' }, { title: 'Read one page' }, { title: 'Note one line' }] });
const consent = (app: ReturnType<typeof makeApp>, token: string, consentType: string) =>
  request(app).post('/api/v1/consents').set(auth(token)).send({ consentType }).expect(201);

describe('guardInput on Kaizen and Sleep free text (crisis path, no model call)', () => {
  it('kaizen goal title: crisis in English, Bangla and indirect wording -> crisis payload, glm never called, nothing stored', async () => {
    const glm = fakeGlm(SPLIT);
    const app = makeApp({ glm });
    const u = await register(app);
    await consent(app, u.accessToken, 'JOURNAL_AI_SHARING');
    for (const title of ['I want to kill myself', 'আমি আত্মহত্যা করার কথা ভাবছি', "I don't want to live anymore"]) {
      const r = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title }).expect(200);
      expect(r.body.data.crisis).toBe(true);
      expect(r.body.data.safety.crisis).toBe(true);
      expect(['HIGH', 'IMMINENT']).toContain(r.body.data.safety.severity);
    }
    expect(glm.calls.length).toBe(0);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('goal anchor and edit title also hit the crisis path before any split', async () => {
    const glm = fakeGlm(SPLIT);
    const app = makeApp({ glm });
    const u = await register(app);
    await consent(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const a = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read more', anchor: 'I want to end my life' }).expect(200);
    expect(a.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(0);
    const g = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Read more' }).expect(201);
    const callsAfterCreate = glm.calls.length;
    const e = await request(app).post(`/api/v1/kaizen/goal/${g.body.data.id}/edit`).set(auth(u.accessToken)).send({ title: 'আমি আত্মহত্যা করার কথা ভাবছি' }).expect(200);
    expect(e.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(callsAfterCreate);
  });

  it('rolling window: a crisis split across two inputs (en and bn) is caught on the second, with no AI call', async () => {
    for (const [first, second] of [["I don't want to", 'be alive anymore'], ['আমি আর এভাবে পারি না, আমি মরে', 'যেতে চাই']] as const) {
      const glm = fakeGlm(SPLIT);
      const app = makeApp({ glm });
      const u = await register(app);
      await consent(app, u.accessToken, 'JOURNAL_AI_SHARING');
      const a = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: first });
      expect(a.body.data.crisis).not.toBe(true);
      const callsBefore = glm.calls.length;
      const b = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: second }).expect(200);
      expect(b.body.data.crisis).toBe(true);
      expect(glm.calls.length).toBe(callsBefore);
    }
  });

  it('model fallback: unreadable classifier output fails safe (skip AI, no block); HIGH from the model is a crisis', async () => {
    const bad = fakeGlm('not json');
    const app = makeApp({ glm: bad });
    const u = await register(app);
    await consent(app, u.accessToken, 'JOURNAL_AI_SHARING');
    const ok = await request(app).post('/api/v1/kaizen/goal').set(auth(u.accessToken)).send({ title: 'Quiero aprender a cocinar mejor cada semana' }).expect(201);
    expect(ok.body.data.tasks).toHaveLength(3);
    expect(bad.calls.length).toBe(1); // the classifier only; no split call
    expect(String(bad.calls[0]![0]!.content)).toContain('safety classifier');

    const high = fakeGlm('{"severity":"HIGH"}');
    const app2 = makeApp({ glm: high });
    const u2 = await register(app2);
    await consent(app2, u2.accessToken, 'JOURNAL_AI_SHARING');
    const r = await request(app2).post('/api/v1/kaizen/goal').set(auth(u2.accessToken)).send({ title: 'Quiero desaparecer para siempre de este mundo' }).expect(200);
    expect(r.body.data.crisis).toBe(true);
    expect(high.calls.length).toBe(1);
  });

  it('sleep night-whisper and lullaby userName: crisis path, no AI call', async () => {
    const glm = fakeGlm('{"text":"ok"}');
    const app = makeApp({ glm });
    const u = await register(app);
    await consent(app, u.accessToken, 'WELLNESS_AI_SHARING');
    const w = await request(app).post('/api/v1/sleep/night-whisper').set(auth(u.accessToken)).send({ thought: 'I want to kill myself tonight' }).expect(200);
    expect(w.body.data.crisis).toBe(true);
    const wb = await request(app).post('/api/v1/sleep/night-whisper').set(auth(u.accessToken)).send({ thought: 'আমি আত্মহত্যা করার কথা ভাবছি' }).expect(200);
    expect(wb.body.data.crisis).toBe(true);
    const l = await request(app).post('/api/v1/sleep/lullaby').set(auth(u.accessToken))
      .send({ setting: 'ocean', mood: 'calm', length: 'short', userName: 'I want to kill myself' }).expect(200);
    expect(l.body.data.crisis).toBe(true);
    const n = await request(app).post('/api/v1/sleep').set(auth(u.accessToken))
      .send({ bedtime: '23:00', wakeTime: '07:00', rested: 5, note: 'I want to end my life' }).expect(200);
    expect(n.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(0);
  });
});

describe('Bangla fallback strings are real Unicode', () => {
  it('SOCRATIC_FALLBACKS contain Bengali-block characters and no mojibake markers', () => {
    expect(/[\u0980-\u09FF]/.test(SOCRATIC_FALLBACKS.bn)).toBe(true);
    for (const s of Object.values(SOCRATIC_FALLBACKS)) expect(/Ã|â€|à¦|à§|Â|\uFFFD/.test(s), s).toBe(false);
    expect(SOCRATIC_FALLBACKS.bn.length).toBeGreaterThan(40);
  });
});
