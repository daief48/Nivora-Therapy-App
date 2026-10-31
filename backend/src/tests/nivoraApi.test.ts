import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, makeApp, register, fakeGlm } from './helpers.js';

const app = makeApp({ glm: fakeGlm('Notice that you slept less when stress was high. Try a short wind-down tonight.') });

describe('Nivora API', () => {
  it('check-ins store, list and flag high-risk text without saving it', async () => {
    const u = await register(app);
    const ok = await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'MORNING', mood: 6, stress: 7, energy: 4, sleepQuality: 'OKAY', rested: 5, note: 'tired but fine' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.note).toBe('tired but fine');
    const bad = await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'EVENING', mood: 2, stress: 9, energy: 2, worry: 'I want to kill myself' });
    expect(bad.status).toBe(201);
    expect(bad.body.data.safety.crisis).toBe(true);
    expect(bad.body.data.worry).toBeNull();
    const list = await request(app).get('/api/v1/checkins').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(2);
  });

  it('sleep diary scores the night and builds a routine', async () => {
    const u = await register(app);
    const s = await request(app).post('/api/v1/sleep').set(auth(u.accessToken)).send({ bedtime: '23:00', wakeTime: '06:45', latencyMin: 10, awakenings: 1, rested: 8 });
    expect(s.status).toBe(201);
    expect(s.body.data.durationMin).toBe(465);
    expect(s.body.data.score).toBeGreaterThan(60);
    expect(s.body.data.breakdown.max.duration).toBe(30);
    const routine = await request(app).get('/api/v1/sleep/routine').set(auth(u.accessToken));
    expect(routine.body.data.steps).toHaveLength(4);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    const coach = await request(app).post('/api/v1/sleep/coach').set(auth(u.accessToken));
    expect(coach.body.data.ai).toBe(true);
  });

  it('kaizen: one goal, one action a day, adaptive after completion, user can adjust', async () => {
    const u = await register(app);
    const t0 = await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken));
    expect(t0.body.data.needsGoal).toBe(true);
    const g = await request(app).post('/api/v1/kaizen/goals').set(auth(u.accessToken)).send({ title: 'Manage stress', category: 'BREATHING' });
    expect(g.status).toBe(201);
    const t1 = await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken));
    expect(t1.body.data.action.targetValue).toBe(2);
    const t1b = await request(app).get('/api/v1/kaizen/today').set(auth(u.accessToken));
    expect(t1b.body.data.action.id).toBe(t1.body.data.action.id);
    const harder = await request(app).post(`/api/v1/kaizen/actions/${t1.body.data.action.id}/adjust`).set(auth(u.accessToken)).send({ direction: 'harder' });
    expect(harder.body.data.targetValue).toBe(3);
    const done = await request(app).post(`/api/v1/kaizen/actions/${t1.body.data.action.id}/complete`).set(auth(u.accessToken)).send({ level: 'FULL', feedback: 'EASY' });
    expect(done.body.data.status).toBe('DONE');
    expect(done.body.data.message).toBeTruthy();
    const refl = await request(app).post(`/api/v1/kaizen/actions/${t1.body.data.action.id}/reflect`).set(auth(u.accessToken)).send({ felt: 4, usefulness: 4, next: 'SAME' });
    expect(refl.body.data.reflected).toBe(true);
    const prog = await request(app).get('/api/v1/kaizen/progress').set(auth(u.accessToken));
    expect(prog.body.data.completed).toBe(1);
    expect(prog.body.data.stage).toBe('SEED');
  });

  it('insights timeline, summary, plan and analysis work and are private per user', async () => {
    const u = await register(app);
    const other = await register(app);
    await request(app).post('/api/v1/checkins').set(auth(u.accessToken)).send({ kind: 'MORNING', mood: 5, stress: 5, energy: 5 });
    await request(app).post('/api/v1/sleep').set(auth(u.accessToken)).send({ bedtime: '23:00', wakeTime: '07:00', rested: 7 });
    const tl = await request(app).get('/api/v1/insights/timeline?days=7').set(auth(u.accessToken));
    expect(tl.body.data).toHaveLength(7);
    expect(tl.body.data.at(-1).mood).toBe(5);
    const sum = await request(app).get('/api/v1/insights/summary').set(auth(u.accessToken));
    expect(sum.body.data.checkInsLast7).toBe(1);
    const plan = await request(app).get('/api/v1/insights/plan').set(auth(u.accessToken));
    expect(plan.body.data.items).toHaveLength(4);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);
    const an = await request(app).post('/api/v1/insights/analysis').set(auth(u.accessToken));
    expect(an.body.data.text).toBeTruthy();
    const otherTl = await request(app).get('/api/v1/insights/timeline').set(auth(other.accessToken));
    expect(otherTl.body.data.every((d: any) => d.mood === null)).toBe(true);
  });

  it('memories can be added, appear in chat context and be deleted', async () => {
    const glm = fakeGlm();
    const a = makeApp({ glm });
    const u = await register(a);
    await request(a).post('/api/v1/memories').set(auth(u.accessToken)).send({ text: 'I have an exam on Friday' });
    const s = await request(a).post('/api/v1/sessions').set(auth(u.accessToken)).send({});
    await request(a).post(`/api/v1/sessions/${s.body.data.id}/messages`).set(auth(u.accessToken)).send({ text: 'hello' });
    expect(glm.calls[0]![0]!.content).toContain('I have an exam on Friday');
    const list = await request(a).get('/api/v1/memories').set(auth(u.accessToken));
    await request(a).delete(`/api/v1/memories/${list.body.data[0].id}`).set(auth(u.accessToken)).expect(204);
    await request(a).patch('/api/v1/me').set(auth(u.accessToken)).send({ preferences: { memoryEnabled: false } });
    await request(a).post('/api/v1/memories').set(auth(u.accessToken)).send({ text: 'secret thing' });
    await request(a).post(`/api/v1/sessions/${s.body.data.id}/messages`).set(auth(u.accessToken)).send({ text: 'again' });
    expect(glm.calls[1]![0]!.content).not.toContain('secret thing');
  });
});
