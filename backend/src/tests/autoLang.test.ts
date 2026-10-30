import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { spokenLang, devanagariLang, pickLang } from '../services/safetyService.js';
import { languageDirective } from '../services/systemPrompt.js';
import { createSttClient } from '../services/sttClient.js';
import { createTtsClient } from '../services/ttsClient.js';
import { auth, fakeGlm, makeApp, register } from './helpers.js';

describe('"same language as I speak" (auto)', () => {
  it('tells Bangla, Hindi, Nepali and other scripts apart from the words', () => {
    expect(spokenLang('আমি আজ খুব চিন্তিত')).toBe('bn');
    expect(spokenLang('मुझे काम का बहुत तनाव है, क्या आप मदद कर सकते हैं?')).toBe('hi');
    expect(spokenLang('मलाई आज एक्लो महसुस भइरहेको छ।')).toBe('ne');
    expect(devanagariLang('मलाई रातमा निद्रा लाग्दैन, के गर्नुपर्छ?')).toBe('ne');
    expect(spokenLang('أشعر بالقلق اليوم')).toBe('auto');
    expect(spokenLang('Thanks, I feel better')).toBe('auto');
  });

  it('picks the crisis-reply language from what was said', () => {
    expect(pickLang('auto', 'আমি মরতে চাই')).toBe('bn');
    expect(pickLang('auto', 'मलाई मर्न मन छ')).toBe('ne');
    expect(pickLang('auto', 'I feel low')).toBe('en');
  });

  it('has a mirror-the-user directive that covers languages beyond Bangla and English', () => {
    const d = languageDirective('auto');
    expect(d).toMatch(/SAME language/);
    expect(d).toMatch(/Arabic/);
  });

  it('listens without a language hint and speaks the text in its own language', async () => {
    const seen: unknown[] = [];
    const stt = createSttClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', timeoutMs: 5000 }, (async (_u: unknown, init: any) => {
      seen.push(init.body.get('language'));
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
    }) as typeof fetch);
    await stt.transcribe(Buffer.alloc(2000, 1), 'audio/webm', 'auto');
    expect(seen).toEqual([null]);
    let instructions = '';
    const tts = createTtsClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', voice: 'v', timeoutMs: 5000 }, (async (_u: unknown, init: any) => {
      instructions = JSON.parse(init.body).instructions;
      return new Response(new Uint8Array(1200), { status: 200 });
    }) as typeof fetch);
    await tts.synthesize('مرحبا', 'auto');
    expect(instructions).toMatch(/whatever language it is written in/);
  });

  it('an auto session answers in the language of the latest message (Nepali stays Nepali after Hindi)', async () => {
    const glm = fakeGlm('ठीक छ');
    const app = makeApp({ glm });
    const u = await register(app, { locale: 'auto' });
    const me = await request(app).get('/api/v1/me').set(auth(u.accessToken));
    expect(me.body.data.locale).toBe('auto');
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ sessionType: 'VOICE', language: 'auto' });
    expect(s.status).toBe(201);
    const id = s.body.data.id;
    await request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(u.accessToken)).send({ text: 'मुझे काम का बहुत तनाव है' });
    expect(glm.calls.at(-1)![0]!.content).toContain('Hindi ONLY');
    await request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(u.accessToken)).send({ text: 'मलाई आज एक्लो महसुस भइरहेको छ' });
    expect(glm.calls.at(-1)![0]!.content).toContain('Nepali ONLY');
    await request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(u.accessToken)).send({ text: 'Thanks, much better now' });
    expect(glm.calls.at(-1)![0]!.content).toMatch(/SAME language/);
  });
});
