import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACTION_RULES } from '../services/actionMenu.js';
import { latencyBucket } from '../services/aiTelemetry.js';
import { isSleepLow } from '../services/kaizenExtras.js';
import { coachExtraFor, composeRoutine, inWindDownWindow } from '../services/routineSteps.js';
import { DEFAULT_SYSTEM_PROMPT, languageDirective } from '../services/systemPrompt.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

describe('rule-based pieces', () => {
  it('latency buckets', () => {
    expect([200, 1500, 4000, 9000].map(latencyBucket)).toEqual(['lt1s', '1to3s', '3to6s', 'gt6s']);
  });
  it('sleep is low under a score of 55, under 6 hours, or an hour under the person\'s own median', () => {
    expect(isSleepLow({ score: 50, durationMin: 480 }, [])).toBe(true);
    expect(isSleepLow({ score: 80, durationMin: 350 }, [])).toBe(true);
    expect(isSleepLow({ score: 80, durationMin: 420 }, [])).toBe(false);
    expect(isSleepLow({ score: 80, durationMin: 420 }, [500, 510, 520, 480, 500])).toBe(true);
    expect(isSleepLow({ score: 80, durationMin: 450 }, [500, 510, 520, 480, 500])).toBe(false);
    expect(isSleepLow({ score: 80, durationMin: 420 }, [500, 510, 520, 480])).toBe(false); // needs 5 earlier nights
  });
  it('wind-down window: from 30 min before the routine starts until 90 min after bedtime, across midnight', () => {
    const start = 22 * 60 + 5, bed = 22 * 60 + 30;
    expect(inWindDownWindow(22 * 60, start, bed)).toBe(true);
    expect(inWindDownWindow(21 * 60 + 40, start, bed)).toBe(true);
    expect(inWindDownWindow(21 * 60, start, bed)).toBe(false);
    expect(inWindDownWindow(23 * 60 + 55, start, bed)).toBe(true);
    expect(inWindDownWindow(1 * 60, start, bed)).toBe(false);
    expect(inWindDownWindow(12 * 60, start, bed)).toBe(false);
  });
  it('the coach\'s routine step is picked by simple rules from the diary', () => {
    const night = (o: Partial<{ latencyMin: number; awakenings: number; rested: number | null; bedtime: string }> = {}) => ({ latencyMin: 10, awakenings: 0, rested: 7, bedtime: '23:00', ...o });
    expect(coachExtraFor([])).toBe('DIM_LIGHTS');
    expect(coachExtraFor([night({ latencyMin: 40 })])).toBe('WRITE_WORRIES');
    expect(coachExtraFor([night({ awakenings: 3 })])).toBe('SOUNDS');
    expect(coachExtraFor([night({ bedtime: '21:00' }), night({ bedtime: '01:00' })])).toBe('PHONE_AWAY');
    expect(coachExtraFor([night({ rested: 3 })])).toBe('STRETCH');
    expect(coachExtraFor([night()])).toBe('DIM_LIGHTS');
  });
  it('composeRoutine puts extras before the wind-down and counts them', () => {
    const r = composeRoutine('22:30', 5, [{ id: 'PHONE_AWAY', minutes: 10 }], ['PHONE_AWAY', 'breathing'], 'en');
    expect(r.steps.map((s) => s.id)).toEqual(['PHONE_AWAY', 'breathing', 'reflection', 'audio', 'sleep']);
    expect(r.steps[0]!.at).toBe('21:55'); expect(r.steps[1]!.at).toBe('22:05');
    expect(r).toMatchObject({ stepsDone: 2, stepsTotal: 4 });
  });
});

describe('prompt structure (cost) and "no new model call"', () => {
  it('static first: two different people share the same prompt prefix (persona + language + action rules); the per-turn menu is last', async () => {
    const glm1 = fakeGlm(), glm2 = fakeGlm();
    const a = makeApp({ glm: glm1 }), b = makeApp({ glm: glm2 });
    const ua = await register(a, { displayName: 'Asha' }), ub = await register(b, { displayName: 'Bimal' });
    for (const [app, u] of [[a, ua], [b, ub]] as const) {
      const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' });
      await request(app).post(`/api/v1/sessions/${s.body.data.id}/messages`).set(auth(u.accessToken)).send({ text: 'I had a long day and I am tired' }).expect(201);
    }
    const p1 = glm1.calls[0]![0]!.content, p2 = glm2.calls[0]![0]!.content;
    const staticHead = `${DEFAULT_SYSTEM_PROMPT}\n\n${languageDirective('en')}\n\n${ACTION_RULES}`;
    expect(p1.startsWith(staticHead)).toBe(true); expect(p2.startsWith(staticHead)).toBe(true);
    expect(p1.indexOf('FOR THIS REPLY')).toBeGreaterThan(p1.indexOf(ACTION_RULES));
    expect(p1.trimEnd().endsWith('in their language.')).toBe(true); // the reply reminder stays the very last thing
  });
  it('the menu, outcomes, walk, gratitude, reach-out, session close, routine steps, feed and AI-data page never call a model', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const t = u.accessToken;
    const s = (await request(app).post('/api/v1/sessions').set(auth(t)).send({ language: 'en' })).body.data.id;
    glm.reply = 'ok'; // the one chat turn below is the only legitimate call
    await request(app).post(`/api/v1/sessions/${s}/messages`).set(auth(t)).send({ text: 'hello' }).expect(201);
    const base = glm.calls.length;
    await request(app).post(`/api/v1/sessions/${s}/end`).set(auth(t)).send({}).catch(() => undefined);
    const afterEnd = glm.calls.length; // ending a session may summarise: not part of this feature set
    const get = (url: string) => request(app).get(`/api/v1${url}`).set(auth(t));
    const post = (url: string, body: object = {}) => request(app).post(`/api/v1${url}`).set(auth(t)).send(body);
    await get('/actions/menu?context=TODAY'); await post('/actions/BREATHING/outcome', { outcome: 'ACCEPTED', saveToKaizen: true });
    await post('/actions/walk', { choice: 'walk' }); await post('/actions/gratitude', { text: 'tea' }); await get('/actions/reach-out');
    await post('/actions/session-close', { sessionId: s }); await post('/sleep/routine/steps', { stepId: 'DIM_LIGHTS' }); await get('/sleep/routine');
    await get('/today/feed'); await get('/kaizen/today'); await get('/privacy/ai-data'); await get('/me/ai-settings');
    await post('/practice/breathing', { minutes: 2 }); await post('/practice/sounds', {}); await get('/insights/monthly?ai=0');
    expect(glm.calls.length).toBe(afterEnd);
    expect(base).toBeGreaterThan(0);
    expect(await db.actionOffer.count({ where: { userId: u.userId } })).toBeGreaterThan(0);
  });
});
