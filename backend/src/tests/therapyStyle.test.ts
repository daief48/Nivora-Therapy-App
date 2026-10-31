import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DEFAULT_SYSTEM_PROMPT, ELEVATED_ADDENDUM, LEGACY_SYSTEM_PROMPT, replyReminder } from '../services/systemPrompt.js';
import { examplesBlock, pickExamples, THERAPY_EXAMPLES } from '../services/therapyExamples.js';
import { auth, config, db, fakeGlm, register } from './helpers.js';
import { createLogger } from '../utils/logger.js';

const EMOTION = JSON.stringify({ emotions: ['overwhelmed'], intensity: 4, need: 'listen', theme: 'exam', userWords: ['my mind goes blank'] });
const GOOD = 'Your mind going blank with everyone watching sounds exhausting. What is it like when you sit down to study?';

function appWith(glm: ReturnType<typeof fakeGlm>, utilityGlm?: ReturnType<typeof fakeGlm>, env: Record<string, string> = {}) {
  return createApp({ config: { ...config, ...env }, db, logger: createLogger('silent'), glm, utilityGlm, limits: { global: 10_000, auth: 10_000, messages: 10_000 } });
}
async function session(app: ReturnType<typeof appWith>, type: 'TEXT' | 'VOICE' = 'TEXT') {
  const u = await register(app);
  const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: type, language: 'en' });
  expect(s.status).toBe(201);
  const send = (text: string) => request(app).post(`/api/v1/sessions/${s.body.data.id}/messages`).set(auth(u.accessToken)).send({ text });
  return { send };
}
const systemOf = (g: ReturnType<typeof fakeGlm>, i = -1) => g.calls.at(i)![0]!.content;

describe('therapy-style prompt', () => {
  it('keeps the honesty wording, forbids definitions and lists, and keeps the legacy text', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('AI mental wellness and sleep companion');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('NOT a human and NOT a licensed therapist');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/FORBIDDEN unless the person explicitly asks/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/definitions or explanations of concepts/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/at most ONE open question/);
    expect(LEGACY_SYSTEM_PROMPT).toContain('AI mental wellness and sleep companion');
    expect(LEGACY_SYSTEM_PROMPT).toContain('Speak like a warm, attentive counsellor');
    expect(replyReminder(false)).toMatch(/^FOR THIS REPLY: Reflect the feeling/);
    expect(replyReminder(true)).toMatch(/Spoken: 1-3/);
  });

  it('picks themed examples per language within the budget and has 5 reviewed-pair slots for en, bn, hi, ne', () => {
    for (const l of ['en', 'bn', 'hi', 'ne'] as const) expect(THERAPY_EXAMPLES.filter((e) => e.lang === l)).toHaveLength(5);
    expect(pickExamples('en', 'I am so lonely here')[0]!.theme).toBe('lonely');
    expect(pickExamples('bn', 'পরীক্ষা নিয়ে ভয় লাগছে')[0]!.theme).toBe('exam');
    expect(pickExamples('hi', 'ऑफिस में बहुत दबाव है')[0]!.theme).toBe('work');
    expect(pickExamples('ne', 'बुवा बित्नुभयो')[0]!.theme).toBe('grief');
    expect(pickExamples('mixed', 'hello')[0]!.lang).toBe('bn');
    expect(pickExamples('en', 'hello', 2).length).toBe(2);
    expect(examplesBlock('en', 'I failed again')).toMatch(/^EXAMPLES OF THE STYLE \(never copy/);
  });
});

describe('conversation: emotion read, examples, reminder, style guard', () => {
  it('puts the emotion read, 2 examples and the recency reminder (last) in the session prompt; the read uses the utility model', async () => {
    const glm = fakeGlm(GOOD), utility = fakeGlm(EMOTION);
    const { send } = await session(appWith(glm, utility));
    const r = await send('My mind goes blank when I study for my exam');
    expect(r.status).toBe(201);
    expect(utility.calls).toHaveLength(1);
    expect(glm.calls).toHaveLength(1);
    const sys = systemOf(glm);
    expect(sys).toContain('EMOTION READ (private, never mention it)');
    expect(sys).toContain('"my mind goes blank"');
    expect(sys).toContain('EXAMPLES OF THE STYLE');
    expect(sys.match(/GOOD:/g)).toHaveLength(2);
    expect(sys.endsWith(replyReminder(false))).toBe(true);
    expect(sys.indexOf('EMOTION READ')).toBeLessThan(sys.indexOf('FOR THIS REPLY'));
  });

  it('works without an emotion read when the utility model fails or is absent', async () => {
    const glm = fakeGlm(GOOD);
    const { send } = await session(appWith(glm, fakeGlm(new Error('down'))));
    expect((await send('I feel low about work')).status).toBe(201);
    expect(systemOf(glm)).not.toContain('EMOTION READ');
    const g2 = fakeGlm(GOOD);
    const s2 = await session(appWith(g2));
    expect((await s2.send('I feel low about work')).status).toBe(201);
    expect(systemOf(g2)).not.toContain('EMOTION READ');
  });

  it('voice: no emotion read by default, on with EMOTION_READ_VOICE=1; reminder is the spoken one', async () => {
    const g1 = fakeGlm(GOOD), u1 = fakeGlm(EMOTION);
    await (await session(appWith(g1, u1), 'VOICE')).send('I feel stuck and tired');
    expect(u1.calls).toHaveLength(0);
    expect(systemOf(g1).endsWith(replyReminder(true))).toBe(true);
    const g2 = fakeGlm(GOOD), u2 = fakeGlm(EMOTION);
    await (await session(appWith(g2, u2, { EMOTION_READ_VOICE: '1' }), 'VOICE')).send('I feel stuck and tired');
    expect(u2.calls).toHaveLength(1);
    expect(systemOf(g2)).toContain('EMOTION READ');
  });

  it('crisis messages never reach any model, including the emotion read', async () => {
    const glm = fakeGlm(GOOD), utility = fakeGlm(EMOTION);
    const { send } = await session(appWith(glm, utility));
    const r = await send('I want to kill myself tonight');
    expect(r.status).toBe(201);
    expect(glm.calls).toHaveLength(0);
    expect(utility.calls).toHaveLength(0);
  });

  it('regenerates once when the text reply lectures, keeping the better draft; the retry carries a corrective note', async () => {
    const bad = 'Anxiety is a feeling of worry. Here are some tips:\n1. Breathe\n2. Sleep. It is important to rest.';
    const glm = fakeGlm(bad);
    let n = 0;
    const orig = glm.chat.bind(glm);
    glm.chat = async (m, o) => (++n === 1 ? orig(m, o) : { content: GOOD, inputTokens: 1, outputTokens: 1 });
    const { send } = await session(appWith(glm));
    const r = await send('I am anxious about my exam');
    expect(r.body.data.message.content).toBe(GOOD);
    expect(n).toBe(2); // the draft plus exactly one regeneration
  });

  it('keeps the first reply when the retry is no better, and never calls more than once more', async () => {
    const bad = 'Anxiety is a feeling of worry about things.';
    const glm = fakeGlm(bad);
    const { send } = await session(appWith(glm));
    const r = await send('I am anxious');
    expect(r.body.data.message.content).toBe(bad);
    expect(glm.calls).toHaveLength(2); // original + one retry, then stop
    expect(systemOf(glm)).toContain('CORRECTION (private, never mention it)');
  });

  it('does not run the style guard for spoken sessions or when disabled', async () => {
    const bad = 'Anxiety is a feeling of worry about things.';
    const g1 = fakeGlm(bad);
    await (await session(appWith(g1), 'VOICE')).send('I am anxious');
    expect(g1.calls).toHaveLength(1);
    const g2 = fakeGlm(bad);
    await (await session(appWith(g2, undefined, { STYLE_GUARD: '0' }))).send('I am anxious');
    expect(g2.calls).toHaveLength(1);
  });
});

describe('humane prompt additions', () => {
  it('has a CHARACTER section first, mirrors length and Bangla register, and keeps identity / safety / prohibitions', async () => {
    const { CALLBACK_DIRECTIVE } = await import('../services/systemPrompt.js');
    const p = DEFAULT_SYSTEM_PROMPT;
    expect(p.indexOf('CHARACTER')).toBeGreaterThan(0);
    expect(p.indexOf('CHARACTER')).toBeLessThan(p.indexOf('IDENTITY'));
    expect(p).toMatch(/thoughtful friend who has studied counselling/);
    expect(p).toMatch(/mirror the length of the user's message/);
    expect(p).toMatch(/আপনি or তুমি/);
    expect(p).toContain('হুম');
    expect(p).toContain('আমি আপনার অনুভূতি বুঝতে পারছি');
    expect(p).toMatch(/Never claim human experiences/);
    expect(p).toMatch(/Never claim to be human or a licensed professional/);
    expect(p).toMatch(/Never diagnose mental disorders/);
    expect(p).toMatch(/SAFETY\n- Never encourage or give methods for self-harm/);
    expect(p).toMatch(/FORBIDDEN unless the person explicitly asks/);
    expect(replyReminder(false)).toMatch(/Match the length of what they wrote/);
    expect(replyReminder(false)).toMatch(/one is fine/);
    expect(CALLBACK_DIRECTIVE).toMatch(/at most 2-3 times per sitting/);
    expect(CALLBACK_DIRECTIVE).toMatch(/Never recite notes/);
    expect(CALLBACK_DIRECTIVE).toMatch(/never push the user/);
  });

  it('adds a private REPLY SHAPE block to text prompts (also without an emotion read) but not to voice', async () => {
    const glm = fakeGlm(GOOD);
    await (await session(appWith(glm))).send('I feel low about work');
    expect(systemOf(glm)).toContain('REPLY SHAPE (private, never mention it)');
    expect(systemOf(glm).indexOf('REPLY SHAPE')).toBeLessThan(systemOf(glm).indexOf('FOR THIS REPLY'));
    const v = fakeGlm(GOOD);
    await (await session(appWith(v), 'VOICE')).send('I feel low about work');
    expect(systemOf(v)).not.toContain('REPLY SHAPE (private'); // the base prompt itself mentions the note; only the per-turn block must be absent
  });

  it('safety wins over style: an ELEVATED turn gets the addendum and no shape/emotion/examples, and the support footer still follows', async () => {
    const glm = fakeGlm(GOOD);
    const utility = fakeGlm(EMOTION);
    const { send } = await session(appWith(glm, utility));
    const res = await send('I feel hopeless about work and nothing seems to change.');
    expect(res.body.data.safety.severity).toBe('ELEVATED');
    const sys = systemOf(glm, 0);
    expect(sys).toContain(ELEVATED_ADDENDUM);
    expect(sys).toContain('NOT a human and NOT a licensed therapist');
    expect(sys).toContain('Never encourage or give methods for self-harm');
    expect(sys).not.toContain('REPLY SHAPE (private');
    expect(utility.calls).toHaveLength(0); // no emotion read on the safety path
    expect(res.body.data.message.content.length).toBeGreaterThan(GOOD.length); // support footer appended
  });

  it('flags a reply that repeats the previous assistant reply and regenerates once', async () => {
    const glm = fakeGlm(GOOD);
    const { send } = await session(appWith(glm));
    await send('My mind goes blank when I study');
    const before = glm.calls.length;
    await send('It happens every night');
    expect(glm.calls.length - before).toBe(2); // same GOOD opening again -> one corrective retry, then stop
    expect(systemOf(glm)).toContain('earlier replies');
  });
});
