import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { CONTEXT_CHAR_BUDGET, buildSessionSystemPrompt, fitSections } from '../services/sessionContext.js';
import { buildScopeCard, enrichScopeCard, unpackCard } from '../services/scopeCard.js';
import { checkDrift, redirectCopy, ruleVerdict } from '../services/topicDrift.js';
import { auth, config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const OFF = 'Can you help me debug my python code for the homework assignment tonight';
const ON = 'I keep lying awake at night and my mind races when I try to sleep';
const say = (app: any, t: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(t)).send({ text });
const sysOf = (glm: ReturnType<typeof fakeGlm>) => glm.calls.at(-1)![0]!.content;

async function sleepSession(opts: { utilityGlm?: any; body?: Record<string, unknown> } = {}) {
  const glm = fakeGlm();
  const app = makeApp({ glm, utilityGlm: opts.utilityGlm });
  const u = await register(app);
  const topic = await request(app).post('/api/v1/topics').set(auth(u.accessToken)).send({ kind: 'SLEEP' });
  const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ topicId: topic.body.data.id, ...opts.body });
  expect(s.status).toBe(201);
  return { glm, app, u, sid: s.body.data.id as string };
}

describe('scope card', () => {
  it('is built from rules per kind, including KAIZEN, and a goal becomes in-scope', () => {
    const k = buildScopeCard('KAIZEN', { goal: 'I want to feel better and walk every day' });
    expect(k).toMatchObject({ kind: 'KAIZEN', goal: 'I want to feel better and walk every day' });
    expect(k.inScope[0]).toContain('feel better and walk');
    expect(k.outOfScope.length).toBeGreaterThan(0);
    expect(buildScopeCard('SLEEP').topic).toBe('sleep');
    expect(buildScopeCard('OTHER', { label: 'Moving abroad' }).topic).toBe('Moving abroad');
  });

  it('model enrichment adds items; any failure or garbage falls back to the rules', async () => {
    const base = buildScopeCard('SLEEP', { goal: 'fall asleep faster' });
    const good = await enrichScopeCard(fakeGlm('{"inScope":["screen time before bed"],"outOfScope":["tax questions"]}'), base);
    expect(good.inScope).toContain('screen time before bed');
    expect(good.outOfScope).toEqual(['tax questions']);
    expect(await enrichScopeCard(fakeGlm(new Error('down')), base)).toEqual(base);
    expect(await enrichScopeCard(fakeGlm('not json'), base)).toEqual(base);
    expect(await enrichScopeCard(undefined, base)).toEqual(base);
  });

  it('POST /sessions with scopeKind KAIZEN / SLEEP and a goal stores an encrypted card and shows it in the prompt', async () => {
    for (const kind of ['KAIZEN', 'SLEEP'] as const) {
      const glm = fakeGlm();
      const app = makeApp({ glm });
      const u = await register(app);
      const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ scopeKind: kind, goal: 'I want to feel better and walk every day' });
      expect(s.status).toBe(201);
      expect(s.body.data.scope).toMatchObject({ kind, goal: 'I want to feel better and walk every day' });
      const row = await db.therapySession.findUniqueOrThrow({ where: { id: s.body.data.id } });
      expect(row.scopeKind).toBe(kind);
      expect(row.scopeCardEnc).toBeTruthy();
      expect(row.scopeCardEnc).not.toContain('walk every');
      expect(unpackCard(cipher, row.scopeCardEnc)?.goal).toBe('I want to feel better and walk every day');
      await say(app, u.accessToken, s.body.data.id, 'Hello there');
      expect(sysOf(glm)).toContain('SESSION SCOPE');
      expect(sysOf(glm)).toContain('I want to feel better and walk every day');
    }
  });

  it('a goal containing a crisis phrase stores nothing and returns the crisis payload', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const r = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ scopeKind: 'KAIZEN', goal: 'I want to kill myself tonight, I have pills ready' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ crisis: true });
    expect(r.body.data.safety.crisis).toBe(true);
    expect(await db.therapySession.count({ where: { userId: u.userId } })).toBe(0);
    expect(glm.calls).toHaveLength(0);
    expect(JSON.stringify(await db.safetyEvent.findMany({ where: { userId: u.userId } }))).not.toContain('pills');
  });

  it('a topic session gets a lazily built card; unscoped sessions have no scope block', async () => {
    const { glm, app, u, sid } = await sleepSession();
    await say(app, u.accessToken, sid, ON);
    expect(sysOf(glm)).toContain('SESSION SCOPE');
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: sid } })).scopeCardEnc).toBeTruthy();
    const plain = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({});
    await say(app, u.accessToken, plain.body.data.id, 'hello there friend');
    expect(sysOf(glm)).not.toContain('SESSION SCOPE');
  });
});

describe('scope card is pinned against the context budget', () => {
  it('survives heavy budget pressure; the other sections still obey the budget and the old fitSections behaviour is unchanged', async () => {
    const huge = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, source: 's', content: 'x'.repeat(3000) }));
    const retriever = { retrieve: async () => huge as any };
    const glm = fakeGlm();
    const app = makeApp({ glm, retriever });
    const u = await register(app);
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ scopeKind: 'KAIZEN', goal: 'I want to feel better and walk every day', lengthMin: 30, moodBefore: 5 });
    await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: { continuityOptIn: true } } });
    const sys = await buildSessionSystemPrompt(
      { db, cipher, systemPrompt: 'PERSONA', retriever },
      { userId: u.userId, sessionId: s.body.data.id, lang: 'en', userText: 'hello' },
    );
    expect(sys).toContain('SESSION SCOPE');
    expect(sys).toContain('I want to feel better and walk every day');
    expect(sys).toContain('exactly two choices'); // the tail of the block is intact (not truncated)
    expect(sys).toContain('RETRIEVED KNOWLEDGE'.slice(0, 9)); // others still present, trimmed
    expect(sys.length - 'PERSONA'.length).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET + 400); // + persona/language/action rules head
    // old behaviour: lowest-priority (last) sections are trimmed first, highest kept
    const out = fitSections([{ text: 'A'.repeat(3000), max: 3000 }, { text: 'B'.repeat(3000), max: 3000 }, { text: 'C'.repeat(3000), max: 3000 }], 6000);
    expect(out[0]).toHaveLength(3000);
    expect(out.join('').length).toBeLessThanOrEqual(6000);
    expect(out[2]!.length).toBeLessThan(3000);
    // and with a reserved scope budget the same function trims MORE, never the pinned block
    const tight = fitSections([{ text: 'A'.repeat(3000), max: 3000 }, { text: 'B'.repeat(3000), max: 3000 }], CONTEXT_CHAR_BUDGET - 1500);
    expect(tight.join('').length).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET - 1500);
  });
});

describe('drift rules', () => {
  const sleepCard = buildScopeCard('SLEEP');
  it('on-topic, short and continuing messages pass; clear off-topic is OFF; non-English / unclear is UNKNOWN', () => {
    expect(ruleVerdict(ON, sleepCard)).toBe('ON');
    expect(ruleVerdict('ok thanks', sleepCard)).toBe('ON');
    expect(ruleVerdict(OFF, sleepCard)).toBe('OFF');
    expect(ruleVerdict('এটা আমি ঠিক বুঝতে পারছি না আজকে কী করব', sleepCard)).toBe('UNKNOWN');
    expect(ruleVerdict('the neighbour fence needs repairs again before spring arrives', sleepCard)).toBe('UNKNOWN');
    // continuity with an on-topic previous message
    expect(ruleVerdict('the neighbour fence keeps banging in the wind outside', sleepCard, { previousUser: [ON] })).toBe('ON');
    // another section's own words, without the section's
    expect(ruleVerdict('my husband and my wife talked about their marriage yesterday', buildScopeCard('ANXIETY'))).toBe('OFF');
  });

  it('ANY failure of the model check means on-topic', async () => {
    const card = sleepCard;
    const text = 'the neighbour fence needs repairs again before spring arrives and the garden';
    expect((await checkDrift({ card, text, previousUser: [], userTurn: 1, utilityGlm: fakeGlm(new Error('boom')) })).drift).toBe(false);
    expect((await checkDrift({ card, text, previousUser: [], userTurn: 1, utilityGlm: fakeGlm('garbage') })).drift).toBe(false);
    expect((await checkDrift({ card, text, previousUser: [], userTurn: 1 })).drift).toBe(false);
    expect((await checkDrift({ card, text, previousUser: [], userTurn: 1, utilityGlm: fakeGlm('{"onTopic":false}') })).drift).toBe(true);
  });

  it('long conversation: a slow drift no single message shows is caught by the periodic check (every 4th turn)', async () => {
    const card = buildScopeCard('ANXIETY');
    const msgs = ['my husband said something about the weekend plans again', 'and my wife thinks the weekend plans matter more than expected', 'my father also has opinions about the weekend plans'];
    for (const m of msgs) expect(ruleVerdict(m, card)).not.toBe('OFF');
    const base = { card, text: msgs[2]!, previousUser: msgs.slice(0, 2) };
    expect((await checkDrift({ ...base, userTurn: 3 })).drift).toBe(false);
    expect(await checkDrift({ ...base, userTurn: 4 })).toEqual({ drift: true, via: 'periodic' });
  });
});

describe('gentle redirect through the chat', () => {
  it('on-topic gets no redirect; off-topic gets a redirect block and exactly two choices; the next message is not re-prompted', async () => {
    const { glm, app, u, sid } = await sleepSession();
    const a = await say(app, u.accessToken, sid, ON);
    expect(a.status).toBe(201);
    expect(a.body.data.scopeRedirect).toBeUndefined();
    expect(sysOf(glm)).not.toContain('TOPIC REDIRECT');
    const b = await say(app, u.accessToken, sid, OFF);
    expect(b.status).toBe(201);
    expect(b.body.data.message.content).toBeTruthy(); // never blocked: the model still answers
    expect(sysOf(glm)).toContain('TOPIC REDIRECT');
    expect(b.body.data.scopeRedirect.choices.map((c: any) => c.id)).toEqual(['RETURN', 'SEPARATE']);
    expect(b.body.data.scopeRedirect.choices[0].label).toContain('sleep');
    const c = await say(app, u.accessToken, sid, OFF);
    expect(c.body.data.scopeRedirect).toBeUndefined(); // cooldown
    expect(sysOf(glm)).not.toContain('TOPIC REDIRECT');
  });

  it('choosing a separate section lifts the lock for the session and suggests a new-section action', async () => {
    const { glm, app, u, sid } = await sleepSession();
    expect((await say(app, u.accessToken, sid, OFF)).body.data.scopeRedirect).toBeTruthy();
    const ch = await request(app).post(`/api/v1/sessions/${sid}/scope-choice`).set(auth(u.accessToken)).send({ choice: 'SEPARATE' });
    expect(ch.status).toBe(200);
    expect(ch.body.data).toMatchObject({ scopeChoice: 'SWITCHED', action: { kind: 'NEW_SECTION' } });
    for (let i = 0; i < 6; i++) {
      const r = await say(app, u.accessToken, sid, OFF);
      expect(r.body.data.scopeRedirect).toBeUndefined();
    }
    expect(sysOf(glm)).not.toContain('SESSION SCOPE');
    expect((await request(app).post(`/api/v1/sessions/${sid}/scope-choice`).set(auth(u.accessToken)).send({ choice: 'NOPE' })).status).toBe(400);
  });

  it('RETURN keeps the lock but does not re-prompt for a few turns; saying "let us talk about something else" switches', async () => {
    const { app, u, sid } = await sleepSession();
    await say(app, u.accessToken, sid, OFF);
    await request(app).post(`/api/v1/sessions/${sid}/scope-choice`).set(auth(u.accessToken)).send({ choice: 'RETURN' });
    expect((await say(app, u.accessToken, sid, OFF)).body.data.scopeRedirect).toBeUndefined();
    const s2 = await sleepSession();
    const sw = await say(s2.app, s2.u.accessToken, s2.sid, "Actually, let's talk about something else instead, my python code");
    expect(sw.body.data.scopeRedirect).toBeUndefined();
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: s2.sid } })).scopeChoice).toBe('SWITCHED');
  });

  it('the optional small-model check can flag drift for unclear text, and failing means on-topic', async () => {
    const unclear = 'the neighbour fence needs repairs again before spring arrives and the garden';
    const flag = await sleepSession({ utilityGlm: fakeGlm('{"onTopic":false}') });
    expect((await say(flag.app, flag.u.accessToken, flag.sid, unclear)).body.data.scopeRedirect).toBeTruthy();
    const fail = await sleepSession({ utilityGlm: fakeGlm(new Error('down')) });
    expect((await say(fail.app, fail.u.accessToken, fail.sid, unclear)).body.data.scopeRedirect).toBeUndefined();
  });

  it('safety overrides topic: a crisis message runs the crisis flow, and afterwards the lock is gone entirely', async () => {
    const { glm, app, u, sid } = await sleepSession();
    await say(app, u.accessToken, sid, ON);
    const calls = glm.calls.length;
    const cr = await say(app, u.accessToken, sid, 'I want to kill myself tonight, I have pills ready');
    expect(cr.body.data.safety.crisis).toBe(true);
    expect(cr.body.data.scopeRedirect).toBeUndefined();
    expect(glm.calls).toHaveLength(calls); // fixed crisis reply, model not called
    const after = await say(app, u.accessToken, sid, OFF);
    expect(after.body.data.scopeRedirect).toBeUndefined();
    expect(sysOf(glm)).not.toContain('SESSION SCOPE');
    expect(sysOf(glm)).not.toContain('TOPIC REDIRECT');
  });

  it('an elevated message drops the lock for that turn (no scope block, no redirect)', async () => {
    const { glm, app, u, sid } = await sleepSession();
    const r = await say(app, u.accessToken, sid, 'I feel hopeless and python code homework does not matter anymore');
    expect(r.body.data.scopeRedirect).toBeUndefined();
    if (r.body.data.safety.severity !== 'NONE') expect(sysOf(glm)).not.toContain('SESSION SCOPE');
  });

  it('redirect copy exists for en, bn, hi and ne with two choices each', () => {
    const card = buildScopeCard('SLEEP');
    for (const l of ['en', 'bn', 'hi', 'ne']) {
      const r = redirectCopy(card, l);
      expect(r.choices).toHaveLength(2);
      expect(r.intro.length).toBeGreaterThan(5);
    }
    expect(redirectCopy(card, 'bn').choices[1]!.label).toBe('এর জন্য আলাদা সেকশন খুলি');
  });
});
