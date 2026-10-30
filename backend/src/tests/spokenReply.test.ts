import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { checkOutput, checkSpokenOutput, UNSAFE_OUTPUT_FALLBACK } from '../services/safetyService.js';
import { shortenForSpeech, splitSentences, SPOKEN_MAX_CHARS, SPOKEN_MAX_TOKENS } from '../services/spokenReply.js';
import { SPOKEN_ADDENDUM } from '../services/systemPrompt.js';
import type { GlmClient } from '../services/glmClient.js';
import { auth, fakeGlm, makeApp, register } from './helpers.js';

const EN = 'I hear how much this has been weighing on you. It makes sense that you feel tired after such a long week. Many people feel this way when work piles up. Taking a few slow breaths can help your body settle a little. Would you like to try that with me now?';
const BN = 'আমি শুনছি, আপনার জন্য এটা সত্যিই কঠিন। এই অবস্থায় ক্লান্ত লাগাটা খুবই স্বাভাবিক। অনেকেই কাজের চাপে এমন অনুভব করেন। কয়েকবার ধীরে শ্বাস নিলে শরীর একটু শান্ত হতে পারে। আপনি কি এখন আমার সাথে সেটা করে দেখতে চান?';
const HI = 'मैं सुन रहा हूँ, आपके लिए यह सचमुच मुश्किल है। इतने लंबे हफ़्ते के बाद थकान होना स्वाभाविक है। बहुत से लोग काम का दबाव बढ़ने पर ऐसा महसूस करते हैं। कुछ धीमी साँसें लेने से शरीर थोड़ा शांत हो सकता है। क्या आप अभी मेरे साथ यह करके देखना चाहेंगे?';

describe('spoken reply post-processor', () => {
  it('splits on . ? ! and the Devanagari / Bangla danda, but not inside numbers', () => {
    expect(splitSentences('One. Two! Three? Four।')).toEqual(['One.', 'Two!', 'Three?', 'Four।']);
    expect(splitSentences('It costs 3.5 dollars. Fine.')).toEqual(['It costs 3.5 dollars.', 'Fine.']);
    expect(splitSentences('একটি। দুইটি।\nতিনটি')).toEqual(['একটি।', 'দুইটি।', 'তিনটি']);
    expect(splitSentences('He said "stop." Then left.')).toEqual(['He said "stop."', 'Then left.']);
  });

  it('leaves a short reply untouched', () => {
    for (const t of ['That sounds heavy. What part felt hardest?', 'ঠিক আছে।', 'ठीक है। आप कैसा महसूस कर रहे हैं?']) expect(shortenForSpeech(t)).toBe(t);
  });

  for (const [name, text, firstTwo, question] of [
    ['en', EN, 2, 'Would you like to try that with me now?'],
    ['bn', BN, 2, 'আপনি কি এখন আমার সাথে সেটা করে দেখতে চান?'],
    ['hi', HI, 2, 'क्या आप अभी मेरे साथ यह करके देखना चाहेंगे?'],
  ] as const) {
    it(`${name}: keeps the first sentences whole and the closing question`, () => {
      const out = shortenForSpeech(text);
      const parts = splitSentences(out);
      const original = splitSentences(text);
      expect(parts.length).toBeLessThanOrEqual(3);
      expect(out.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS);
      expect(parts.slice(0, firstTwo)).toEqual(original.slice(0, firstTwo)); // whole sentences, in order
      expect(parts.at(-1)).toBe(question); // the question is not dropped
      for (const p of parts) expect(original).toContain(p); // never cut mid-sentence
    });
  }

  it('keeps at most 3 whole sentences when there is no closing question, and within the character budget', () => {
    const out = shortenForSpeech('First one is here. Second one is here. Third one is here. Fourth one is here. Fifth one.');
    expect(out).toBe('First one is here. Second one is here. Third one is here.');
    const long = 'A'.repeat(150) + '. ' + 'B'.repeat(150) + '. ' + 'C'.repeat(150) + '.';
    expect(shortenForSpeech(long)).toBe('A'.repeat(150) + '. ' + 'B'.repeat(150) + '.');
    const huge = 'W'.repeat(500) + '. next.';
    expect(shortenForSpeech(huge)).toBe('W'.repeat(500) + '.'); // a complete sentence beats a cut one
  });
});

describe('spoken honesty / medication guard', () => {
  const blocked = [
    "I'm a licensed therapist and I can help you with this.", 'I am a real person, just like you.', "I'm your doctor now.", 'I am not an AI, I am a human being.',
    'You can stop taking your pills if you feel better.', 'Take 20 mg every morning.', 'You should double your dose tonight.', 'A dosage of 50 should be fine.',
    'আমি একজন মানুষ, আপনার বন্ধু।', 'আমি একজন ডাক্তার, আমি বলছি ওষুধ বন্ধ করে দিন।', 'প্রতিদিন ৫০০ মিলিগ্রাম খান।',
    'मैं एक इंसान हूँ और आपकी मदद करूँगा।', 'मैं एक डॉक्टर हूँ।', 'दवा बंद कर दीजिए, आप ठीक हो जाएँगे।', 'रोज़ 20 mg लीजिए।',
    'म एक मानिस हुँ।', 'म एक डाक्टर हुँ।', 'औषधि बन्द गर्नुहोस्, तपाईं ठीक हुनुहुन्छ।',
  ];
  for (const t of blocked) it(`blocks ${JSON.stringify(t)}`, () => expect(checkSpokenOutput(t).ok).toBe(false));

  const fine = [
    "I'm an AI, not a therapist or a doctor. I'm here to listen.", 'I am not a doctor, so please ask yours about your medication.', "Please don't stop your medication without asking your doctor.",
    'That sounds really hard. Would you like to try a slow breath together?', 'You took 10 minutes for yourself today, that matters.',
    'আমি একটি AI, মানুষ নই। আমি মন দিয়ে শুনছি।', 'আমি মানুষের কথা মন দিয়ে শুনি।', 'আমি ডাক্তার নই, তবে আপনার কথা শুনতে এখানে আছি।', 'ওষুধ নিয়ে ডাক্তারের সাথে কথা বলুন।',
    'मैं एक AI हूँ, इंसान नहीं। मैं ध्यान से सुन रहा हूँ।', 'मैं डॉक्टर नहीं हूँ, पर आपकी बात सुनने के लिए यहाँ हूँ।', 'दवा के बारे में अपने डॉक्टर से बात कीजिए।',
    'म एक AI हुँ, मानिस होइन। म ध्यानपूर्वक सुन्दैछु।', 'औषधिबारे आफ्नो डाक्टरसँग कुरा गर्नुहोस्।',
  ];
  for (const t of fine) it(`allows ${JSON.stringify(t)}`, () => expect(checkSpokenOutput(t).ok).toBe(true));

  it('still applies every existing output check', () => {
    expect(checkSpokenOutput('You have clinical depression.').ok).toBe(false);
    expect(checkSpokenOutput("I've contacted emergency services for you.").ok).toBe(false);
    expect(checkOutput("I'm a licensed therapist.").ok).toBe(true); // text chats keep the original, unchanged behaviour
  });
});

describe('spoken (VOICE) sessions end to end', () => {
  const session = async (app: any, token: string, language: string, sessionType: 'VOICE' | 'TEXT') =>
    (await request(app).post('/api/v1/sessions').set(auth(token)).send({ sessionType, language })).body.data.id as string;
  const say = (app: any, token: string, id: string, text: string) => request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(token)).send({ text });
  const capture = (reply: string) => {
    const seen: { maxTokens?: number }[] = [];
    const glm: GlmClient = {
      async chat(_m, o) { seen.push({ maxTokens: o?.maxTokens }); return { content: reply, inputTokens: 1, outputTokens: 1 }; },
      async stream(_m, onDelta, o) { seen.push({ maxTokens: o?.maxTokens }); onDelta(reply); return { content: reply, inputTokens: 1, outputTokens: 1 }; },
    };
    return { glm, seen };
  };

  it('caps tokens, shortens a long reply to whole sentences, and saves exactly what is spoken', async () => {
    for (const [lang, text, user] of [['en', EN, 'I am tired'], ['bn', BN, 'আমি ক্লান্ত'], ['hi', HI, 'मैं थका हुआ हूँ']] as const) {
      const { glm, seen } = capture(text);
      const app = makeApp({ glm });
      const u = await register(app);
      const sid = await session(app, u.accessToken, lang, 'VOICE');
      const res = await say(app, u.accessToken, sid, user);
      expect(res.status).toBe(201);
      expect(seen[0]!.maxTokens).toBe(SPOKEN_MAX_TOKENS);
      const spoken = res.body.data.message.content as string;
      expect(spoken).toBe(shortenForSpeech(text));
      expect(spoken.length).toBeLessThan(text.length);
      const hist = await request(app).get(`/api/v1/sessions/${sid}`).set(auth(u.accessToken));
      expect(hist.body.data.messages.at(-1).content).toBe(spoken); // saved == spoken
    }
  });

  it('text chats keep the full reply and the normal token budget', async () => {
    const { glm, seen } = capture(EN);
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = await session(app, u.accessToken, 'en', 'TEXT');
    const res = await say(app, u.accessToken, sid, 'I am tired');
    expect(res.body.data.message.content).toBe(EN);
    expect(seen[0]!.maxTokens).toBeUndefined();
  });

  it('the spoken addendum states the hard limit', () => {
    expect(SPOKEN_ADDENDUM).toMatch(/HARD LIMIT: at most 3 short sentences/);
  });

  it('replaces a human / doctor / dosage claim with the safe fallback in spoken sessions only', async () => {
    for (const bad of ["I'm a licensed therapist, so trust me.", 'Take 20 mg every morning.', 'आप दवा बंद कर दीजिए।']) {
      const app = makeApp({ glm: fakeGlm(bad) });
      const u = await register(app);
      const voice = await session(app, u.accessToken, 'en', 'VOICE');
      const v = await say(app, u.accessToken, voice, 'is it okay if I talk to you');
      expect(v.body.data.message.content).toBe(UNSAFE_OUTPUT_FALLBACK.en);
      const text = await session(app, u.accessToken, 'en', 'TEXT');
      const t = await say(app, u.accessToken, text, 'is it okay if I talk to you');
      expect(t.body.data.message.content).toBe(bad); // text chats are unchanged
    }
  });
});
