import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { askedToConfirm, classifyReply, decideStage, goalClarity, goalCopy, LUC_SINGLE_SHOT, lucBlock, sectionCapabilities, SECTIONS } from '../services/lucRule.js';
import { createLogger } from '../utils/logger.js';
import { addDays, localDate } from '../utils/dates.js';
import { auth, config, db, fakeGlm, register } from './helpers.js';

// The older suites run with LUC_FLOW=0 (see setupEnv.ts); this one turns the listen-confirm flow on.
const appWith = (glm: ReturnType<typeof fakeGlm>, utilityGlm?: ReturnType<typeof fakeGlm>) =>
  createApp({ config: { ...config, LUC_FLOW: '1' }, db, logger: createLogger('silent'), glm, utilityGlm, limits: { global: 10_000, auth: 10_000, messages: 10_000 } });
type App = ReturnType<typeof appWith>;
const BN = /[ঀ-৿]/;
const CONFIRM_Q = 'It sounds like the exam pressure is wearing you down. Did I get that right?';
const sysOf = (g: ReturnType<typeof fakeGlm>) => g.calls.at(-1)![0]!.content;
const MENU = 'ACTION MENU (this turn only';

beforeAll(async () => {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
    create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
  });
});

async function chat(glm: ReturnType<typeof fakeGlm>, regOver: Record<string, unknown> = {}, lang = 'en') {
  const app = appWith(glm);
  const u = await register(app, regOver);
  const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: lang });
  expect(s.status).toBe(201);
  const say = (text: string) => request(app).post(`/api/v1/sessions/${s.body.data.id}/messages`).set(auth(u.accessToken)).send({ text });
  return { app, u, say, sid: s.body.data.id as string };
}

describe('lucRule: stage decision (pure)', () => {
  it('detects that the last assistant turn asked for confirmation (en / bn / hi / ne)', () => {
    expect(askedToConfirm('That sounds heavy. Did I get that right?')).toBe(true);
    expect(askedToConfirm('তাহলে পরীক্ষার চাপটাই ভারী লাগছে। ঠিক বুঝেছি তো?')).toBe(true);
    expect(askedToConfirm('तो परीक्षा का दबाव भारी लग रहा है। क्या मैंने सही समझा?')).toBe(true);
    expect(askedToConfirm('त्यसो भए परीक्षाको दबाब भारी लाग्दैछ। के मैले सही बुझें?')).toBe(true);
    expect(askedToConfirm('That sounds heavy. What is the hardest part?')).toBe(false);
    expect(askedToConfirm(undefined)).toBe(false);
  });
  it('a clean yes is AFFIRM in all four languages; corrections and anything unclear are not', () => {
    for (const y of ['yes', 'Yes, exactly', 'right', "that's right", 'হ্যাঁ', 'হ্যাঁ, ঠিক', 'ঠিক বলেছেন', 'हाँ', 'हां सही', 'बिल्कुल', 'हो', 'हजुर', 'ठीक छ हो']) expect(classifyReply(y), y).toBe('AFFIRM');
    for (const n of ['no', 'not really', 'not quite, it is more about my boss', 'yes but actually it is my family', 'না', 'ঠিক না', 'ঠিক নয়, আসলে অন্য কিছু', 'नहीं', 'सही नहीं है', 'होइन', 'ठीक छैन']) expect(classifyReply(n), n).toBe('CORRECT');
    for (const o of ['hmm', 'maybe', 'I do not know what to say about all of this, it keeps changing every day', 'yes?', '']) expect(classifyReply(o), o).not.toBe('AFFIRM');
  });
  it('stages: nothing pending => LISTEN; yes after a confirm question => SUGGEST; correction / unclear => CONFIRM; risk => BYPASS', () => {
    const asked = CONFIRM_Q;
    expect(decideStage({ riskBypass: false, lastAssistant: undefined, userText: 'I am anxious' })).toBe('LISTEN');
    expect(decideStage({ riskBypass: false, lastAssistant: 'What is hardest?', userText: 'yes' })).toBe('LISTEN');
    expect(decideStage({ riskBypass: false, lastAssistant: asked, userText: 'yes' })).toBe('SUGGEST');
    expect(decideStage({ riskBypass: false, lastAssistant: asked, userText: 'not exactly' })).toBe('CONFIRM');
    expect(decideStage({ riskBypass: false, lastAssistant: asked, userText: 'hmm maybe' })).toBe('CONFIRM');
    expect(decideStage({ riskBypass: true, lastAssistant: asked, userText: 'yes' })).toBe('BYPASS');
    expect(lucBlock('BYPASS')).toBe('');
  });
});

describe('lucRule: curly apostrophes, confirmation-loop exit', () => {
  it('curly and modifier apostrophes do not defeat negation (stays CONFIRM)', () => {
    for (const n of ['Yeah, it isn’t right', 'Yes it doesn’t fit', 'sure, that wasn’t it', 'yes, I don‘t think so', 'yeah it isnʼt']) {
      expect(classifyReply(n), n).toBe('CORRECT');
      expect(decideStage({ riskBypass: false, lastAssistant: CONFIRM_Q, userText: n }), n).toBe('CONFIRM');
    }
    expect(classifyReply('that’s right')).toBe('AFFIRM');
  });
  const a = (content: string) => ({ role: 'assistant' as const, content });
  const u = (content: string) => ({ role: 'user' as const, content });
  it('after a clean yes earlier, ordinary turns are FREE (no re-asking), until the window passes', () => {
    const hist = [u('I am anxious'), a(CONFIRM_Q), u('yes'), a('Would breathing help?'), u('maybe later'), a('ok')];
    expect(decideStage({ riskBypass: false, lastAssistant: 'ok', userText: 'my boss is hard', history: hist })).toBe('FREE');
    const old = [...hist, ...Array.from({ length: 7 }, (_, i) => [u('x'), a('reply ' + i)]).flat()];
    expect(decideStage({ riskBypass: false, lastAssistant: 'ok', userText: 'hi', history: old })).not.toBe('FREE');
    expect(lucBlock('FREE')).toContain('do NOT ask');
    expect(decideStage({ riskBypass: true, lastAssistant: 'ok', userText: 'hi', history: hist })).toBe('BYPASS');
  });
  it('every 3rd listen turn without a confirmed cycle gets a gentle options turn; a correction is not a confirmed cycle', () => {
    const w = 'It sounds heavy. What part is hardest?'; // worded differently, no confirm phrase
    const h1 = [u('a'), a(w)], h2 = [...h1, u('b'), a(w)], h3 = [...h2, u('c'), a(w)], h4 = [...h3, u('d'), a(w)];
    expect(decideStage({ riskBypass: false, lastAssistant: w, userText: 'b', history: h1 })).toBe('LISTEN');
    expect(decideStage({ riskBypass: false, lastAssistant: w, userText: 'c', history: h2 })).toBe('LISTEN');
    expect(decideStage({ riskBypass: false, lastAssistant: w, userText: 'd', history: h3 })).toBe('OPTIONS');
    expect(decideStage({ riskBypass: false, lastAssistant: w, userText: 'e', history: h4 })).toBe('LISTEN');
    const corrected = [u('a'), a(CONFIRM_Q), u('not really'), a(w)];
    expect(decideStage({ riskBypass: false, lastAssistant: w, userText: 'x', history: corrected })).toBe('LISTEN');
    expect(lucBlock('OPTIONS', true)).toContain('gentle options');
  });
});

describe('chat: listen -> confirm -> suggest', () => {
  it('a distressed message that asks what to do is a BYPASS: no LISTEN-only block', async () => {
    const glm = fakeGlm('I am here with you. Let us slow down together.');
    const { say } = await chat(glm);
    await say("I'm having a panic attack, what do I do");
    const sys = sysOf(glm);
    expect(sys).not.toContain('THIS TURN (listen and confirm)');
    expect(sys).not.toContain('would like to be sure you understood first');
  });
  it('after a confirmed cycle the next ordinary turn does not re-ask (FREE)', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say } = await chat(glm);
    await say('I feel so anxious about my exams');
    glm.reply = 'Thanks. Would slow breathing help, or keep talking?';
    await say('yes');
    expect(sysOf(glm)).toContain('THIS TURN (they confirmed)');
    glm.reply = 'That sounds tiring.';
    await say('My boss keeps adding work');
    expect(sysOf(glm)).toContain('THIS TURN (continue)');
    expect(sysOf(glm)).not.toContain('THIS TURN (listen and confirm)');
  });

  it('first message: reflect + confirm question, NO menu, NO options; first reply carries the "what I can do here" menu', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say } = await chat(glm);
    const r = await say('I feel so anxious about my exams, my chest is tight');
    expect(r.status).toBe(201);
    const sys = sysOf(glm);
    expect(sys).toContain('THIS TURN (listen and confirm)');
    expect(sys).not.toContain(MENU);
    expect(r.body.data.action).toBeNull();
    const caps = r.body.data.capabilities;
    expect(caps.section).toBe('CHAT');
    expect(caps.items.length).toBeGreaterThanOrEqual(3);
    expect(caps.items.length).toBeLessThanOrEqual(4);
    // the reminder stays last
    expect(sys.indexOf('FOR THIS REPLY: Reflect')).toBeGreaterThan(sys.indexOf('THIS TURN (listen and confirm)'));
  });

  it('capabilities appear on the first turn only', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say } = await chat(glm);
    await say('I feel so anxious about my exams');
    const r2 = await say('Hmm, maybe');
    expect(r2.body.data.capabilities).toBeUndefined();
  });

  it('after a clear yes: menu with up to 3 options, SUGGEST block, and ONE action card at most', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say, u } = await chat(glm);
    await say('I feel so anxious and panicky about my exams, my chest is tight');
    glm.reply = 'Thank you. If you like, we could try slow breaths, or a grounding exercise, or just keep talking.\n[[ACTION:BREATHING]]';
    const r = await say('Yes, exactly');
    expect(r.status).toBe(201);
    const sys = sysOf(glm);
    expect(sys).toContain('THIS TURN (they confirmed)');
    expect(sys).toContain(MENU);
    const menu = sys.slice(sys.indexOf(MENU), sys.indexOf('THIS TURN (they confirmed)'));
    expect(menu.split('\n').filter((l) => l.startsWith('- ')).length).toBeLessThanOrEqual(3);
    expect(r.body.data.message.content).not.toContain('[[');
    expect(r.body.data.action).toMatchObject({ id: 'BREATHING' });
    expect(await db.actionOffer.count({ where: { userId: u.userId } })).toBe(1); // one suggestion card at a time
  });

  it('a correction stays in CONFIRM: no menu, no options, even with an action marker in the model reply', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say } = await chat(glm);
    await say('I feel so anxious about my exams');
    glm.reply = 'Thank you for telling me. So it is more about your boss than the exams. Did I get that right?\n[[ACTION:BREATHING]]';
    const r = await say('No, not really, it is more about my boss');
    const sys = sysOf(glm);
    expect(sys).toContain('THIS TURN (confirm again)');
    expect(sys).not.toContain(MENU);
    expect(sys).not.toContain('THIS TURN (they confirmed)');
    expect(r.body.data.action).toBeNull(); // dropped: not on a menu
    // ambiguity also stays in CONFIRM, and a later clean yes then suggests
    glm.reply = 'So it is mostly your boss. Did I get that right?';
    await say('hmm maybe');
    expect(sysOf(glm)).toContain('THIS TURN (confirm again)');
    glm.reply = 'Thanks. Would slow breathing help, or would you rather keep talking?';
    await say('yes');
    expect(sysOf(glm)).toContain('THIS TURN (they confirmed)');
  });

  it('Bangla: "ঠিক বুঝেছি তো?" then "হ্যাঁ" reaches SUGGEST; a "না" does not', async () => {
    const glm = fakeGlm('পরীক্ষার চাপে আপনি ক্লান্ত বোধ করছেন। ঠিক বুঝেছি তো?');
    const { say } = await chat(glm, { locale: 'bn' }, 'bn');
    await say('পরীক্ষা নিয়ে খুব দুশ্চিন্তা হচ্ছে, বুকে চাপ লাগছে');
    await say('না, আসলে অন্য কিছু');
    expect(sysOf(glm)).toContain('THIS TURN (confirm again)');
    await say('হ্যাঁ');
    expect(sysOf(glm)).toContain('THIS TURN (they confirmed)');
  });

  it('crisis bypass: the fixed crisis flow runs, the model is not called, no capabilities / LUC block', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say } = await chat(glm);
    const r = await say('I want to kill myself');
    expect(r.status).toBe(201);
    expect(r.body.data.safety.crisis).toBe(true);
    expect(glm.calls).toHaveLength(0);
    expect(r.body.data.capabilities).toBeUndefined();
    // the session is now flagged: even a "yes" after a confirm-style question gets no flow and no menu
    glm.reply = CONFIRM_Q;
    const r2 = await say('yes');
    if (glm.calls.length) {
      const sys = sysOf(glm);
      expect(sys).not.toContain('THIS TURN (');
      expect(sys).not.toContain('Offer NO options');
    }
    expect(r2.body.data.capabilities).toBeUndefined();
  });

  it('a person with earlier risk signals gets no LUC flow and no capabilities in a new session', async () => {
    const glm = fakeGlm(CONFIRM_Q);
    const { say, u } = await chat(glm);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const r = await say('I feel low today and tired');
    expect(r.status).toBe(201);
    expect(sysOf(glm)).not.toContain('THIS TURN (');
    expect(r.body.data.capabilities).toBeUndefined();
  });
});

describe('section start menus', () => {
  it('every section has a short menu in en / bn / hi / ne; chat topics add one kind-specific item; Bangla is real Unicode', () => {
    for (const s of SECTIONS) {
      for (const l of ['en', 'bn', 'hi', 'ne']) {
        const c = sectionCapabilities(s, 'ANXIETY', l);
        expect(c.items.length, `${s}/${l}`).toBeGreaterThanOrEqual(3);
        expect(c.items.length).toBeLessThanOrEqual(4);
        expect(c.title.length).toBeGreaterThan(5);
      }
      expect(BN.test(sectionCapabilities(s, null, 'bn').items[0]!.label)).toBe(true);
    }
    expect(sectionCapabilities('CHAT', 'ANXIETY', 'en').items.some((i) => i.id === 'WORRY')).toBe(true);
    expect(sectionCapabilities('CHAT', null, 'en').items.some((i) => i.id === 'WORRY')).toBe(false);
  });
  it('GET /actions/capabilities serves it in the account language', async () => {
    const app = appWith(fakeGlm());
    const u = await register(app, { locale: 'bn' });
    const r = await request(app).get('/api/v1/actions/capabilities?section=SLEEP').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.data.section).toBe('SLEEP');
    expect(BN.test(r.body.data.title)).toBe(true);
    expect((await request(app).get('/api/v1/actions/capabilities?section=NOPE').set(auth(u.accessToken))).status).toBe(400);
  });
});

describe('kaizen: guided goal flow (opt-in via guided:true)', () => {
  const post = (app: App, t: string, body: Record<string, unknown>) => request(app).post('/api/v1/kaizen/goal').set(auth(t)).send(body);

  it('rules: vague vs clear', () => {
    expect(goalClarity('be better').clear).toBe(false);
    expect(goalClarity('health').clear).toBe(false);
    expect(goalClarity('read more books').clear).toBe(false);
    expect(goalClarity('Walk for 10 minutes every morning').clear).toBe(true);
    expect(goalClarity('sleep before 11pm on weekdays').clear).toBe(true);
    expect(goalClarity('Get healthier', { timePerDayMin: 10 }).clear).toBe(false); // fuzzy words only; time alone counts as measurable, but there is no action
    expect(goalClarity('প্রতিদিন ১০ মিনিট হাঁটব').clear).toBe(true);
  });

  it('vague goal => clarifying questions (1-2), NO model call, nothing saved', async () => {
    const glm = fakeGlm('{"tasks":[]}');
    const app = appWith(glm);
    const u = await register(app);
    const r = await post(app, u.accessToken, { title: 'be better', guided: true });
    expect(r.status).toBe(200);
    expect(r.body.data.needsClarification).toBe(true);
    expect(r.body.data.questions.length).toBeGreaterThanOrEqual(1);
    expect(r.body.data.questions.length).toBeLessThanOrEqual(2);
    expect(glm.calls).toHaveLength(0);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('answers => confirm step; confirm:true => split and saved (answers reach the split prompt)', async () => {
    const glm = fakeGlm('{"tasks":[{"title":"a"},{"title":"b"},{"title":"c"}],"anchor":"after tea"}');
    const app = appWith(glm);
    const u = await register(app);
    await request(app).post('/api/v1/consents').set(auth(u.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
    const c = await post(app, u.accessToken, { title: 'be better', guided: true, answers: ['walk', '10 minutes a day'] });
    expect(c.body.data.needsConfirmation).toBe(true);
    expect(c.body.data.understood).toContain('be better');
    expect(c.body.data.understood).toContain('10 minutes a day');
    expect(c.body.data.actions.confirm.length).toBeGreaterThan(2);
    expect(glm.calls).toHaveLength(0);
    const done = await post(app, u.accessToken, { title: 'be better', guided: true, confirm: true, answers: ['walk', '10 minutes a day'] });
    expect(done.status).toBe(201);
    expect(done.body.data.tasks.length).toBeGreaterThanOrEqual(3);
    expect(glm.calls).toHaveLength(1);
    expect(glm.calls[0]![1]!.content).toContain('10 minutes a day');
  });

  it('clear goal => confirm first (no split call), then split on confirm:true', async () => {
    const glm = fakeGlm('{"tasks":[{"title":"a"},{"title":"b"},{"title":"c"}],"anchor":"after tea"}');
    const app = appWith(glm);
    const u = await register(app);
    const c = await post(app, u.accessToken, { title: 'Walk for 10 minutes every morning', guided: true });
    expect(c.status).toBe(200);
    expect(c.body.data.needsConfirmation).toBe(true);
    expect(c.body.data.needsClarification).toBeUndefined();
    expect(glm.calls).toHaveLength(0);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
    const done = await post(app, u.accessToken, { title: 'Walk for 10 minutes every morning', guided: true, confirm: true });
    expect(done.status).toBe(201);
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(1);
  });

  it('model clarity check: "not clear" asks questions; a failing / odd model counts as clear', async () => {
    const mk = (reply: string | Error) => {
      const glm = fakeGlm('{"tasks":[]}'); const util = fakeGlm(reply);
      return { glm, util, app: appWith(glm, util) };
    };
    const a = mk('{"clear":false}');
    const ua = await register(a.app);
    await request(a.app).post('/api/v1/consents').set(auth(ua.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
    expect((await post(a.app, ua.accessToken, { title: 'Walk for 10 minutes every morning', guided: true })).body.data.needsClarification).toBe(true);
    for (const reply of [new Error('down'), 'garbage']) {
      const b = mk(reply);
      const ub = await register(b.app);
      await request(b.app).post('/api/v1/consents').set(auth(ub.accessToken)).send({ consentType: 'JOURNAL_AI_SHARING' }).expect(201);
      expect((await post(b.app, ub.accessToken, { title: 'Walk for 10 minutes every morning', guided: true })).body.data.needsConfirmation).toBe(true);
    }
  });

  it('Bangla account gets Bangla questions and confirm text', async () => {
    const app = appWith(fakeGlm());
    const u = await register(app, { locale: 'bn' });
    const q = await post(app, u.accessToken, { title: 'ভালো থাকা', guided: true });
    expect(q.body.data.needsClarification).toBe(true);
    expect(q.body.data.questions.every((x: string) => BN.test(x))).toBe(true);
    const c = await post(app, u.accessToken, { title: 'ভালো থাকা', guided: true, answers: ['হাঁটব'] });
    expect(BN.test(c.body.data.understood)).toBe(true);
    expect(c.body.data.understood).toContain('ঠিক বুঝেছি তো?');
    expect(goalCopy('hi', { clear: false, reasons: ['SHORT'] }, 'x').questions.length).toBeGreaterThan(0);
  });

  it('default (no guided flag) is unchanged: the goal is created at once', async () => {
    const glm = fakeGlm('{"tasks":[]}');
    const app = appWith(glm);
    const u = await register(app);
    const r = await post(app, u.accessToken, { title: 'be better' });
    expect(r.status).toBe(201);
    expect(r.body.data.needsClarification).toBeUndefined();
  });

  it('crisis: the crisis payload is returned, nothing is created, no questions', async () => {
    const glm = fakeGlm('{"tasks":[]}');
    const app = appWith(glm);
    const u = await register(app);
    const r = await post(app, u.accessToken, { title: 'I want to kill myself', guided: true });
    expect(r.status).toBe(200);
    expect(r.body.data.crisis).toBe(true);
    expect(r.body.data.needsClarification).toBeUndefined();
    expect(await db.userGoal.count({ where: { userId: u.userId } })).toBe(0);
    // a crisis hidden in an answer is caught too
    const r2 = await post(app, u.accessToken, { title: 'be better', guided: true, answers: ['I want to kill myself'] });
    expect(r2.body.data.crisis).toBe(true);
  });

  it('a person with risk signals skips the guided flow (direct, no-model split)', async () => {
    const glm = fakeGlm('{"tasks":[]}');
    const app = appWith(glm);
    const u = await register(app);
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const r = await post(app, u.accessToken, { title: 'be better', guided: true });
    expect(r.status).toBe(201);
    expect(r.body.data.needsClarification).toBeUndefined();
  });
});

describe('sleep and home: single-shot prompts carry the listen + gentle check rule', () => {
  const GRANT = (app: App, t: string) => request(app).post('/api/v1/consents').set(auth(t)).send({ consentType: 'WELLNESS_AI_SHARING' }).expect(201);

  it('night whisper: the prompt asks to name the feeling in their words and phrase the reframe as a check; crisis text bypasses the model', async () => {
    const glm = fakeGlm('{"validation":"v","reframe":"r?","release":"x"}');
    const app = appWith(glm);
    const u = await register(app);
    await GRANT(app, u.accessToken);
    const r = await request(app).post('/api/v1/sleep/night-whisper').set(auth(u.accessToken)).send({ thought: 'I keep replaying the meeting' });
    expect(r.status).toBe(200);
    const sys = sysOf(glm);
    expect(sys).toContain("name the feeling in the user's own words");
    expect(sys).toContain('does that fit?');
    const n = glm.calls.length;
    const c = await request(app).post('/api/v1/sleep/night-whisper').set(auth(u.accessToken)).send({ thought: 'I want to kill myself' });
    expect(c.body.data.crisis).toBe(true);
    expect(glm.calls.length).toBe(n);
  });

  it('sleep coach: the system prompt includes the shared rule', async () => {
    const glm = fakeGlm('Your nights look short. If you like, you could start winding down a little earlier. Does that fit?');
    const app = appWith(glm);
    const u = await register(app);
    await GRANT(app, u.accessToken);
    await request(app).post('/api/v1/sleep').set(auth(u.accessToken)).send({ bedtime: '23:00', wakeTime: '07:00', rested: 7 }).expect(201);
    const r = await request(app).post('/api/v1/sleep/coach').set(auth(u.accessToken));
    expect(r.status).toBe(200);
    expect(sysOf(glm)).toContain(LUC_SINGLE_SHOT);
  });

  it('home analysis: the system prompt includes the shared rule; with risk signals the model is not called', async () => {
    const glm = fakeGlm('Sleep and stress tended to go together. If you like, you could try an earlier wind-down. Does that fit?');
    const app = appWith(glm);
    const u = await register(app);
    await GRANT(app, u.accessToken);
    const day = (n: number) => addDays(localDate('UTC'), -n);
    for (const n of [1, 2]) await db.sleepEntry.create({ data: { userId: u.userId, date: day(n), bedtime: '23:00', wakeTime: '07:00', durationMin: 480, awakenings: 0, latencyMin: 10, rested: 6, score: 70, source: 'manual' } });
    await request(app).post('/api/v1/insights/analysis').set(auth(u.accessToken)).expect(200);
    expect(sysOf(glm)).toContain(LUC_SINGLE_SHOT);
    const n = glm.calls.length;
    await db.safetyEvent.create({ data: { userId: u.userId, severity: 'HIGH', category: 'SUICIDE', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const r = await request(app).post('/api/v1/insights/analysis').set(auth(u.accessToken));
    expect(r.body.data.riskMode).toBe(true);
    expect(glm.calls.length).toBe(n);
  });
});
