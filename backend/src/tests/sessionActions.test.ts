import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRelay, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';
import { ACTION_RULES } from '../services/actionMenu.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

const ANXIOUS = 'I feel so anxious and panicky about my exams, my chest is tight';
const BREATH_REPLY = 'That sounds like a lot to carry. If you like, we could try a few slow breaths together.\n[[ACTION:BREATHING]]';
async function newSession(app: any, token: string, body: Record<string, unknown> = { language: 'en' }) {
  const s = await request(app).post('/api/v1/sessions').set(auth(token)).send(body);
  expect(s.status).toBe(201);
  return s.body.data.id as string;
}
const say = (app: any, token: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(token)).send({ text });
/** Two plain turns first (the menu only appears once the person has been heard for a few turns), then the turn under test. */
async function warm(app: any, token: string, sid: string, glm: ReturnType<typeof fakeGlm>) {
  const keep = glm.reply;
  glm.reply = 'I hear you. That sounds really heavy for you right now.';
  await say(app, token, sid, 'Work has been so stressful this month');
  await say(app, token, sid, 'And I keep worrying about everything');
  glm.reply = keep;
}
const lastSystem = (glm: ReturnType<typeof fakeGlm>) => glm.calls[glm.calls.length - 1]![0]!.content;

describe('action menu in the session chat', () => {
  it('offers ONE valid action: marker stripped from the saved reply, offer recorded, card returned, menu sits after the static rules', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    expect(res.status).toBe(201);
    const { message, action } = res.body.data;
    expect(message.content).not.toContain('[[');
    expect(message.content).toContain('slow breaths');
    expect(action).toMatchObject({ id: 'BREATHING', kind: 'BREATHING', surface: 'CHAT', crisis: false, deepLink: { route: 'Exercise', params: { kind: 'breathing' } } });
    expect(action.offerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(action.title.length).toBeGreaterThan(3); expect(action.reason.length).toBeGreaterThan(3); expect(action.cta).toBe('Try it');
    const stored = await db.sessionMessage.findMany({ where: { sessionId: sid, role: 'assistant' } });
    expect(stored).toHaveLength(3);
    const offer = await db.actionOffer.findFirst({ where: { userId: u.userId } });
    expect(offer).toMatchObject({ actionId: 'BREATHING', kind: 'BREATHING', surface: 'CHAT', sessionId: sid, outcome: 'OFFERED', messageId: message.id });
    // static rules first, per-turn menu last (just before the reply reminder)
    const sys = lastSystem(glm);
    expect(sys.indexOf(ACTION_RULES)).toBeGreaterThan(-1);
    expect(sys.indexOf('ACTION MENU (this turn only')).toBeGreaterThan(sys.indexOf(ACTION_RULES));
    expect(sys.indexOf('ACTION MENU (this turn only')).toBeGreaterThan(sys.indexOf('WELLNESS CONTEXT') === -1 ? 0 : sys.indexOf('WELLNESS CONTEXT'));
    expect(sys.indexOf('FOR THIS REPLY')).toBeGreaterThan(sys.indexOf('ACTION MENU (this turn only'));
    // history: an earlier call's marker never reaches later prompts
    expect(glm.calls.slice(-1)[0]!.filter((m) => m.role !== 'system').map((m) => m.content).join(' ')).not.toContain('[[ACTION');
  });

  it('an invented id, or a real id that was not on this turn\'s menu, is dropped (reply kept, nothing recorded)', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = 'We could try a little something if you like.\n[[ACTION:TELEPORT_HOME]]';
    const a = await say(app, u.accessToken, sid, ANXIOUS);
    expect(a.body.data.action).toBeNull();
    expect(a.body.data.message.content).toBe('We could try a little something if you like.');
    glm.reply = 'Maybe have a look at your plan.\n[[ACTION:SAFETY_PLAN]]'; // crisis action: never on a normal menu
    const b = await say(app, u.accessToken, sid, 'I am still anxious about the exams');
    expect(b.body.data.action).toBeNull();
    expect(await db.actionOffer.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('no menu in the first turns, and an id returned then is dropped', async () => {
    const glm = fakeGlm(BREATH_REPLY);
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    expect(res.status).toBe(201);
    expect(lastSystem(glm)).not.toContain('ACTION MENU (this turn only');
    expect(res.body.data.action).toBeNull();
    expect(res.body.data.message.content).not.toContain('[[');
  });

  it('suggestion level NEVER: no menu in the prompt, any id dropped', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    await db.userProfile.update({ where: { userId: u.userId }, data: { suggestionLevel: 'NEVER' } });
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    expect(lastSystem(glm)).not.toContain('ACTION MENU (this turn only');
    expect(res.body.data.action).toBeNull();
  });

  it('risk signals: the model is shown ONLY crisis support options, never an exercise', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    const sys = lastSystem(glm);
    const menu = sys.slice(sys.indexOf('ACTION MENU (this turn only'));
    expect(menu).toContain('EMERGENCY'); expect(menu).toContain('SAFETY_PLAN');
    for (const id of ['BREATHING:', 'GROUNDING:', 'JOURNAL_TEXT:', 'WALK_10:', 'SOUNDS:']) expect(menu).not.toContain(id);
    expect(res.body.data.action).toBeNull(); // BREATHING was not on the menu
    glm.reply = 'You do not have to carry this alone. Your safety plan is there if you want it.\n[[ACTION:SAFETY_PLAN]]';
    const ok = await say(app, u.accessToken, sid, 'It has been a hard week');
    expect(ok.body.data.action).toMatchObject({ id: 'SAFETY_PLAN', crisis: true });
  });

  it('a crisis message never reaches the model and never carries an action', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    const before = glm.calls.length;
    const res = await say(app, u.accessToken, sid, 'I want to kill myself tonight');
    expect(res.body.data.safety.crisis).toBe(true);
    expect(res.body.data.action ?? null).toBeNull();
    expect(glm.calls.length).toBe(before);
  });

  it('variety: after an offer, the next replies get no menu until enough turns have passed (SOMETIMES), and a repeat is not offered', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    expect((await say(app, u.accessToken, sid, ANXIOUS)).body.data.action?.id).toBe('BREATHING');
    glm.reply = 'Take your time. I am here.';
    await say(app, u.accessToken, sid, 'It is still hard');
    expect(lastSystem(glm)).not.toContain('ACTION MENU (this turn only'); // gap since the last offer too short
    // the ledger says BREATHING was just shown: it is not on any later menu
    const rows = await db.actionOffer.count({ where: { userId: u.userId, actionId: 'BREATHING' } });
    expect(rows).toBe(1);
  });

  it('a thumbs-down on the message also marks the action card, so that kind is left out for a week', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    await request(app).post(`/api/v1/sessions/${sid}/messages/${res.body.data.message.id}/feedback`).set(auth(u.accessToken)).send({ value: -1 }).expect(204);
    expect((await db.actionOffer.findFirst({ where: { userId: u.userId } }))!.feedback).toBe(-1);
    const menu = await request(app).get('/api/v1/actions/menu?context=TODAY&tags=anxiety,stress').set(auth(u.accessToken));
    expect(menu.body.data.actions.map((a: any) => a.kind)).not.toContain('BREATHING');
  });

  it('streams: the marker is never emitted in a delta, an `action` event comes right before `done`, and done carries the same card', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken);
    await warm(app, u.accessToken, sid, glm);
    glm.reply = BREATH_REPLY;
    glm.streamParts = ['That sounds like a lot to carry. If you like, we could try a few slow ', 'breaths together.\n[[AC', 'TION:BREA', 'THING]]'];
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).set('Accept', 'text/event-stream').send({ text: ANXIOUS }).buffer(true).parse((r, cb) => { let s = ''; r.on('data', (c: Buffer) => (s += c.toString())); r.on('end', () => cb(null, s)); });
    const body = res.body as unknown as string;
    const events = body.split('\n\n').filter(Boolean).map((blk) => ({ event: /event: (\w+)/.exec(blk)![1]!, data: JSON.parse(/data: (.*)/.exec(blk)![1]!) }));
    const names = events.map((e) => e.event);
    expect(names.slice(-2)).toEqual(['action', 'done']);
    const streamed = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(streamed).not.toContain('[[');
    expect(streamed.trim()).toBe('That sounds like a lot to carry. If you like, we could try a few slow breaths together.');
    const action = events.find((e) => e.event === 'action')!.data;
    expect(action.action).toMatchObject({ id: 'BREATHING' });
    expect(events.find((e) => e.event === 'done')!.data.action.offerId).toBe(action.action.offerId);
    expect(action.messageId).toBe(events.find((e) => e.event === 'done')!.data.message.id);
  });

  it('voice sessions: same menu, surface CALL, marker never spoken, reply still short', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await newSession(app, u.accessToken, { language: 'en', sessionType: 'VOICE' });
    await warm(app, u.accessToken, sid, glm);
    glm.reply = 'That sounds heavy. If you like, we could try a few slow breaths together. Would that be okay?\n[[ACTION:BREATHING]]';
    const res = await say(app, u.accessToken, sid, ANXIOUS);
    expect(res.body.data.message.content).not.toContain('[[');
    expect(res.body.data.message.content.split(/[.?!]/).filter((s: string) => s.trim()).length).toBeLessThanOrEqual(3);
    expect(res.body.data.action).toMatchObject({ id: 'BREATHING', surface: 'CALL' });
    expect(lastSystem(glm)).toContain('SPOKEN REPLY');
  });
});

describe('realtime relay: assistant_action', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('forwards the card once, before assistant_done, and speaks only the reply text', async () => {
    const out: ServerMsg[] = [];
    const upstream: any[] = [];
    const card = { id: 'BREATHING', offerId: 'o1' };
    const converse = vi.fn(async (i: any) => { i.onDelta('I hear you. '); i.onAction?.(card, 'm1'); return 'I hear you. If you like, we could try slow breaths.'; });
    const deps: RelayDeps = {
      send: (m) => out.push(m), authenticate: async () => ({ userId: 'u1' }), openSession: async () => ({ language: 'en' }),
      connectUpstream: async () => ({ send: (e) => upstream.push(e), close: () => undefined }), converse, crisis: async () => 'x',
    };
    const relay = createRelay(deps);
    await relay.onClient(JSON.stringify({ type: 'hello', token: 't', sessionId: 's1' }));
    relay.onUpstream({ type: 'conversation.item.input_audio_transcription.completed', transcript: ANXIOUS });
    await tick();
    relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    const actions = out.filter((m) => m.type === 'assistant_action');
    expect(actions).toEqual([{ type: 'assistant_action', messageId: 'm1', action: card }]);
    const types = out.map((m) => m.type);
    expect(types.indexOf('assistant_action')).toBeLessThan(types.indexOf('assistant_done'));
    expect(JSON.stringify(upstream)).not.toContain('ACTION');
  });
});
