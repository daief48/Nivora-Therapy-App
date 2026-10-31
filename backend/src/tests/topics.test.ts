import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

const mk = (app: any, t: string, body: object) => request(app).post('/api/v1/topics').set(auth(t)).send(body);

describe('topics', () => {
  it('creates topics, stores them encrypted and lists session counts', async () => {
    const app = makeApp();
    const u = await register(app);
    const a = await mk(app, u.accessToken, { kind: 'ADDICTION' });
    expect(a.status).toBe(201);
    const o = await mk(app, u.accessToken, { kind: 'OTHER', label: 'Moving abroad' });
    expect(o.body.data).toMatchObject({ kind: 'OTHER', label: 'Moving abroad', sessionCount: 0 });
    expect((await mk(app, u.accessToken, { kind: 'NOPE' })).status).toBe(400);
    const raw = await db.topic.findMany({ where: { userId: u.userId } });
    expect(raw.every((r) => !r.encryptedContent.includes('Moving') && !r.encryptedContent.includes('ADDICTION'))).toBe(true);

    for (let i = 0; i < 2; i++) {
      const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ topicId: a.body.data.id });
      expect(s.status).toBe(201);
      expect(s.body.data).toMatchObject({ topicId: a.body.data.id, topic: { kind: 'ADDICTION' } });
    }
    const list = await request(app).get('/api/v1/topics').set(auth(u.accessToken));
    const row = list.body.data.find((t: any) => t.id === a.body.data.id);
    expect(row.sessionCount).toBe(2);
    expect(row.lastSessionAt).toBeTruthy();
    expect(list.body.data.find((t: any) => t.id === o.body.data.id).sessionCount).toBe(0);

    const ts = await request(app).get(`/api/v1/topics/${a.body.data.id}/sessions`).set(auth(u.accessToken));
    expect(ts.status).toBe(200);
    expect(ts.body.data.sessions).toHaveLength(2);
    const sl = await request(app).get('/api/v1/sessions').set(auth(u.accessToken));
    expect(sl.body.data[0].topic.kind).toBe('ADDICTION');
  });

  it('isolates topics between users (404)', async () => {
    const app = makeApp();
    const a = await register(app);
    const b = await register(app);
    const t = (await mk(app, a.accessToken, { kind: 'GRIEF' })).body.data.id;
    const h = auth(b.accessToken);
    expect((await request(app).get(`/api/v1/topics/${t}/sessions`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/topics/${t}`).set(h)).status).toBe(404);
    expect((await request(app).post('/api/v1/sessions').set(h).send({ topicId: t })).status).toBe(404);
    expect((await request(app).get('/api/v1/topics').set(h)).body.data).toEqual([]);
    expect(await db.topic.count({ where: { id: t } })).toBe(1);
  });

  it('deletes a topic keeping or deleting its sessions', async () => {
    const app = makeApp();
    const u = await register(app);
    const h = auth(u.accessToken);
    const t1 = (await mk(app, u.accessToken, { kind: 'SLEEP' })).body.data.id;
    const t2 = (await mk(app, u.accessToken, { kind: 'ANXIETY' })).body.data.id;
    const s1 = (await request(app).post('/api/v1/sessions').set(h).send({ topicId: t1 })).body.data.id;
    const s2 = (await request(app).post('/api/v1/sessions').set(h).send({ topicId: t2 })).body.data.id;
    expect((await request(app).delete(`/api/v1/topics/${t1}?deleteSessions=false`).set(h)).status).toBe(204);
    const kept = await request(app).get(`/api/v1/sessions/${s1}`).set(h);
    expect(kept.status).toBe(200);
    expect(kept.body.data.topicId).toBeNull();
    expect((await request(app).delete(`/api/v1/topics/${t2}?deleteSessions=true`).set(h)).status).toBe(204);
    expect((await request(app).get(`/api/v1/sessions/${s2}`).set(h)).status).toBe(404);
    expect((await request(app).get('/api/v1/topics').set(h)).body.data).toEqual([]);
  });

  it('adds the topic coaching block to the system prompt of a topic session only', async () => {
    const glm = fakeGlm('I hear you.');
    const app = makeApp({ glm });
    const u = await register(app);
    const h = auth(u.accessToken);
    const t = (await mk(app, u.accessToken, { kind: 'ADDICTION' })).body.data.id;
    const s = (await request(app).post('/api/v1/sessions').set(h).send({ topicId: t })).body.data.id;
    await request(app).post(`/api/v1/sessions/${s}/messages`).set(h).send({ text: 'I feel a craving tonight' }).expect(201);
    const sys = glm.calls[0]![0]!.content;
    expect(sys).toMatch(/SESSION TOPIC: ADDICTION/);
    expect(sys).toMatch(/urge surfing/i);
    expect(sys).toMatch(/not a therapist/);
    const plain = (await request(app).post('/api/v1/sessions').set(h).send({})).body.data.id;
    await request(app).post(`/api/v1/sessions/${plain}/messages`).set(h).send({ text: 'hello there' }).expect(201);
    expect(glm.calls[glm.calls.length - 1]![0]!.content).not.toMatch(/SESSION TOPIC/);
  });

  it('never records custom labels in analytics', async () => {
    const app = makeApp();
    const u = await register(app);
    await db.userProfile.update({ where: { userId: u.userId }, data: { analyticsOptIn: true } });
    const res = await request(app).post('/api/v1/analytics/events').set(auth(u.accessToken)).send({
      events: [{ name: 'topic_created', props: { kind: 'other', label: 'my secret topic' } }, { name: 'topic_selected', props: { kind: 'addiction', label: 'x y' } }],
    });
    expect(res.body.data.accepted).toBe(2);
    const rows = await db.analyticsEvent.findMany({ where: { name: { in: ['topic_created', 'topic_selected'] } }, orderBy: { createdAt: 'desc' }, take: 2 });
    expect(JSON.stringify(rows.map((r) => r.propsJson))).not.toMatch(/secret|label/);
    expect(JSON.stringify(rows.map((r) => r.propsJson))).toMatch(/addiction/);
  });
});
