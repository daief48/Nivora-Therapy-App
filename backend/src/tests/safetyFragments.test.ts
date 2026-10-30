import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { assess, pickLang, spokenLang } from '../services/safetyService.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

const sev = (t: string) => assess(t).severity;

describe('misheard / misspelled crisis phrases (conservative near-miss variants)', () => {
  const high = [
    'I want to kill my self', 'i keep killing my self', 'sometimes I wanna die', "I'm thinking about sue side", 'I want to commit sue side', 'I want too die',
    "I dont wanna live anymore", 'I do not want to live like this', 'I want to hang my self',
    'আত্ম হত্যা করব', 'আতমহত্যা', 'আত্মহনন করতে চাই', 'আমার মরতে ইচ্ছে করে', 'আমি মোরতে চাই', 'আমি বাচতে চাই না', 'আমি বেচে থাকতে চাই না',
    'আত্ম‌হত্যা', 'আমি মর‌তে চাই',
    'आत्म हत्या के बारे में सोचता हूँ', 'मेरा मर जाने का मन करता है', 'मरने की इच्छा होती है', 'अब जीना नही चाहता', 'मैं मरना चाहता हूँ',
    'मलाई मर्न मन लाग्यो', 'म बाँच्न चाहन्न', 'मर्नु पर्छ जस्तो लाग्छ',
  ];
  for (const t of high) it(`HIGH: ${JSON.stringify(t)}`, () => expect(['HIGH', 'IMMINENT']).toContain(sev(t)));

  it('vague near misses are ELEVATED, never silently NONE, and never HIGH', () => {
    for (const t of ['sue side', 'লজ্জায় মরে যাই', 'আমার ছাত্রজীবন শেষ হয়ে গেল']) expect(sev(t), t).toBe('ELEVATED');
  });

  it('a negated variant is downgraded like the originals (never ignored)', () => {
    expect(sev("I'm not going to kill my self")).toBe('ELEVATED');
  });

  it('adds nothing to benign phrases (including every benign case of the base suite)', () => {
    const benign = [
      'I had a stressful day and want to sleep better', 'আজ অফিসে অনেক কাজ ছিল, একটু ক্লান্ত লাগছে', 'This deadline is killing me, haha',
      'I want to kill my self-doubt', 'I want to dye my hair', 'sew side seams together', 'I need to cut my self-esteem down to size, ha', 'hang my coat on the hook',
      'I need to kill some time', 'My friend moved away and I miss him', 'I feel better after talking', 'I am tired and want to sleep',
      'আমি আজ খুব ক্লান্ত', 'আমি ভাত খেতে চাই', 'আমি বাড়ি যেতে চাই', 'মরিচ কিনতে হবে', 'আমি ভালো থাকতে চাই',
      'मुझे काम का बहुत तनाव है', 'मैं घर जाना चाहता हूँ', 'आज मौसम अच्छा है', 'मलाई आज थकाइ लागेको छ', 'म घर जान चाहन्छु',
      'ok thanks', 'Thanks, I feel better',
    ];
    for (const t of benign) expect(sev(t), t).toBe('NONE');
  });
});

describe('language stickiness in "same language as I speak" sessions', () => {
  const NE = 'मलाई आज एक्लो महसुस भइरहेको छ';
  const HI = 'मुझे काम का बहुत तनाव है';
  const BN = 'আমি আজ খুব চিন্তিত';

  it('is unchanged without previous messages', () => {
    expect(spokenLang(BN)).toBe('bn');
    expect(spokenLang(HI)).toBe('hi');
    expect(spokenLang(NE)).toBe('ne');
    expect(spokenLang('Thanks, I feel better')).toBe('auto');
    expect(spokenLang('okay')).toBe('auto');
    expect(spokenLang('हाँ')).toBe('hi'); // Hindi stays the default for Devanagari with no signal and no history
  });
  it('never flips Hindi <-> Nepali on a message with no distinguishing words', () => {
    expect(spokenLang('हाँ', [NE])).toBe('ne');
    expect(spokenLang('ठीक', [HI, NE])).toBe('ne');
    expect(spokenLang('हाँ', [HI])).toBe('hi');
    expect(spokenLang('ठीक', [NE, 'हाँ'])).toBe('ne'); // ambiguous history is skipped, the last clear message wins
    expect(spokenLang('हाँ', [BN])).toBe('hi'); // a Bangla history says nothing about Devanagari
  });
  it('distinguishing words still win over the history', () => {
    expect(spokenLang('मलाई ठीक छ', [HI])).toBe('ne');
    expect(spokenLang('मुझे ठीक नहीं लग रहा', [NE])).toBe('hi');
    expect(spokenLang('আমি ভালো আছি', [HI])).toBe('bn');
  });
  it('a very short Latin message keeps the language the user was speaking; a real switch to English does not', () => {
    expect(spokenLang('okay', [BN])).toBe('bn');
    expect(spokenLang('thanks', [NE])).toBe('ne');
    expect(spokenLang('yes please', [HI])).toBe('hi');
    expect(spokenLang('yes', [])).toBe('auto');
    expect(spokenLang('Thanks, I feel much better now', [BN])).toBe('auto'); // longer English message = switched
    expect(spokenLang('ok', [BN, 'I think I will be fine, thank you'])).toBe('auto'); // user already switched to English
    expect(spokenLang('ok', ['أشعر بالقلق اليوم'])).toBe('auto');
  });
  it('the crisis-reply language follows the same rule', () => {
    expect(pickLang('auto', 'okay', [BN])).toBe('bn');
    expect(pickLang('auto', 'हाँ', [NE])).toBe('ne');
    expect(pickLang('auto', 'okay', [])).toBe('en');
    expect(pickLang('hi', 'okay', [BN])).toBe('hi'); // explicit session languages are untouched
  });

  it('an auto session keeps answering in Nepali for "हाँ" and "ok", and follows a real switch', async () => {
    const glm = fakeGlm('ठीक छ');
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'auto' });
    const sid = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE', language: 'auto' })).body.data.id;
    const say = (text: string) => request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text });
    await say(NE);
    expect(glm.calls.at(-1)![0]!.content).toContain('Nepali ONLY');
    await say('हाँ');
    expect(glm.calls.at(-1)![0]!.content).toContain('Nepali ONLY');
    await say('ok');
    expect(glm.calls.at(-1)![0]!.content).toContain('Nepali ONLY');
    await say('Actually, I would like to continue in English now');
    expect(glm.calls.at(-1)![0]!.content).toMatch(/SAME language/);
  });
});

describe('crisis split across short messages (rolling window)', () => {
  const session = async (app: any, token: string, language = 'en') =>
    (await request(app).post('/api/v1/sessions').set(auth(token)).send({ language })).body.data.id as string;
  const say = (app: any, token: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(token)).send({ text });

  const cases: [string, string, string, string][] = [
    ['en', 'en', "I don't want to", 'be alive anymore'],
    ['bn', 'bn', 'আমি আর এভাবে পারি না, আমি মরে', 'যেতে চাই'],
    ['hi', 'hi', 'मैं अब मर', 'जाना चाहता हूँ'],
  ];
  for (const [name, language, first, second] of cases) {
    it(`${name}: two fragments together are a crisis; the model is not called and the new text is not stored`, async () => {
      expect(sev(first)).not.toBe('HIGH');
      expect(sev(second)).not.toBe('HIGH');
      const glm = fakeGlm();
      const app = makeApp({ glm });
      const u = await register(app);
      const sid = await session(app, u.accessToken, language);
      const a = await say(app, u.accessToken, sid, first);
      expect(a.body.data.safety.crisis).toBe(false);
      expect(glm.calls).toHaveLength(1);
      const b = await say(app, u.accessToken, sid, second);
      expect(b.status).toBe(201);
      expect(b.body.data.safety).toMatchObject({ crisis: true });
      expect(['HIGH', 'IMMINENT']).toContain(b.body.data.safety.severity);
      expect(glm.calls).toHaveLength(1); // no second model call
      const stored = await db.sessionMessage.findMany({ where: { sessionId: sid } });
      expect(stored.map((m) => m.role).sort()).toEqual(['assistant', 'assistant', 'user']); // the second fragment is not retained
      expect(await db.safetyEvent.count({ where: { sessionId: sid, severity: { in: ['HIGH', 'IMMINENT'] } } })).toBe(1);
    });
  }

  it('fragments older than two minutes are not combined', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await session(app, u.accessToken);
    await say(app, u.accessToken, sid, "I don't want to");
    await db.sessionMessage.updateMany({ where: { sessionId: sid }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const b = await say(app, u.accessToken, sid, 'be alive anymore');
    expect(b.body.data.safety.crisis).toBe(false);
    expect(glm.calls).toHaveLength(2);
  });

  it('a crisis text never reaches a later prompt', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await session(app, u.accessToken);
    await say(app, u.accessToken, sid, "I don't want to");
    await say(app, u.accessToken, sid, 'be alive anymore');
    await say(app, u.accessToken, sid, 'thanks for listening');
    for (const call of glm.calls) expect(call.some((m) => m.content.includes('be alive anymore'))).toBe(false);
  });
});
