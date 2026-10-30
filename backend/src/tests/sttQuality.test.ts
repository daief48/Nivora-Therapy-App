import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../utils/logger.js';
import { contextTail, createSttClient, isSttNoise } from '../services/sttClient.js';
import { acceptCleaned, cleanTranscript, similarity } from '../services/transcriptCleanup.js';
import type { GlmClient } from '../services/glmClient.js';
import { auth, config, db, fakeGlm, register } from './helpers.js';

const audio = Buffer.alloc(2000, 1);
const cfg = { apiKey: 'k', baseUrl: 'https://x', model: 'm', timeoutMs: 5000 };
const okRes = (text: string) => new Response(JSON.stringify({ text }), { status: 200 });

describe('STT noise / hallucination filter', () => {
  const noise = [
    '', '   ', '...', '?!', '♪♪', '♪ ♫ ♪', '[Music]', '(applause)', 'um', 'Hmm...', 'uh uh', 'aaaaaaa', 'you you you you you',
    'Thank you for watching!', 'Thanks for watching.', 'Subtitles by the Amara.org community', 'Please subscribe to my channel',
    'দেখার জন্য ধন্যবাদ', 'হুম', 'सब्सक्राइब करें', 'देखने के लिए धन्यवाद।', 'हेर्नुभएकोमा धन्यवाद', 'उम',
  ];
  for (const n of noise) it(`drops ${JSON.stringify(n)}`, () => expect(isSttNoise(n)).toBe(true));

  const speech = [
    'I feel anxious today', 'ok', 'yes', 'Thank you', 'আমি আজ খুব ক্লান্ত', 'আমি ভয় পাচ্ছি', 'मुझे नींद नहीं आती', 'मलाई आज एक्लो महसुस भइरहेको छ', 'no, not really',
    'I watched a video and felt calmer',
  ];
  for (const n of speech) it(`keeps ${JSON.stringify(n)}`, () => expect(isSttNoise(n)).toBe(false));

  it('drops the prompt echoed back (language prompt and conversation tail)', () => {
    expect(isSttNoise('Rahim and I talked about the exam yesterday', 'Rahim and I talked about the exam yesterday')).toBe(true);
    expect(isSttNoise('talked about the exam yesterday', 'Rahim and I talked about the exam yesterday')).toBe(true);
    expect(isSttNoise('the exam', 'Rahim and I talked about the exam yesterday')).toBe(false); // short real words that also occur in the context are kept
  });

  it('is applied by the client in every language', async () => {
    for (const [lang, text] of [['en', 'Thank you for watching'], ['bn', 'দেখার জন্য ধন্যবাদ'], ['hi', 'देखने के लिए धन्यवाद'], ['ne', 'हेर्नुभएकोमा धन्यवाद']] as const) {
      const stt = createSttClient(cfg, (async () => okRes(text)) as typeof fetch);
      expect(await stt.transcribe(audio, 'audio/webm', lang)).toBe('');
    }
  });
});

describe('STT context and retry', () => {
  it('forwards the last ~200 characters of the conversation as the prompt; auto sends no language hint', async () => {
    const seen: { language: unknown; prompt: unknown }[] = [];
    const stt = createSttClient(cfg, (async (_u: unknown, init: any) => {
      seen.push({ language: init.body.get('language'), prompt: init.body.get('prompt') });
      return okRes('ok then');
    }) as typeof fetch);
    const long = 'x'.repeat(500) + ' Tanvir lives in Sylhet';
    await stt.transcribe(audio, 'audio/webm', 'auto', undefined, long);
    await stt.transcribe(audio, 'audio/webm', 'en', undefined, 'We talked about Tanvir');
    await stt.transcribe(audio, 'audio/webm', 'bn', undefined, 'Tanvir');
    await stt.transcribe(audio, 'audio/webm', 'en');
    expect(seen[0]!.language).toBeNull();
    expect(String(seen[0]!.prompt).length).toBeLessThanOrEqual(200);
    expect(String(seen[0]!.prompt)).toMatch(/Tanvir lives in Sylhet$/);
    expect(seen[1]!.prompt).toBe('We talked about Tanvir');
    expect(String(seen[2]!.prompt)).toMatch(/বাংলা.*Tanvir$/); // language prompt first, then the context
    expect(seen[3]!.prompt).toBeNull(); // backwards compatible: no context, no prompt for English
    expect(contextTail('  a \n b  ')).toBe('a b');
  });

  it('retries once on a transient 5xx and then succeeds; gives up after the second failure', async () => {
    let n = 0;
    const flaky = createSttClient(cfg, (async () => (++n === 1 ? new Response('{}', { status: 502 }) : okRes('ঠিক আছে'))) as typeof fetch);
    expect(await flaky.transcribe(audio, 'audio/webm', 'bn')).toBe('ঠিক আছে');
    expect(n).toBe(2);
    let m = 0;
    const down = createSttClient(cfg, (async () => { m++; return new Response('{}', { status: 503 }); }) as typeof fetch);
    await expect(down.transcribe(audio, 'audio/webm', 'bn')).rejects.toMatchObject({ code: 'STT_UNAVAILABLE' });
    expect(m).toBe(2);
  });
});

describe('transcript clean-up (opt-in)', () => {
  const glmReturning = (content: string | Error | 'hang'): GlmClient & { calls: number } => {
    const g: any = {
      calls: 0,
      async chat() {
        g.calls++;
        if (content === 'hang') return new Promise(() => undefined);
        if (content instanceof Error) throw content;
        return { content, inputTokens: 1, outputTokens: 1 };
      },
      async stream() { throw new Error('unused'); },
    };
    return g;
  };

  it('fixes an obvious recognition mistake', async () => {
    const g = glmReturning('I feel anxious today');
    expect(await cleanTranscript(g, 'I feel anxius today', { lang: 'en' })).toBe('I feel anxious today');
  });
  it('returns the original on failure, timeout, empty or very different output', async () => {
    const t = 'I feel anxius today';
    expect(await cleanTranscript(glmReturning(new Error('boom')), t, {})).toBe(t);
    expect(await cleanTranscript(glmReturning(''), t, {})).toBe(t);
    expect(await cleanTranscript(glmReturning('Here is a long unrelated answer about breathing exercises that you can do'), t, {})).toBe(t);
    expect(await cleanTranscript(glmReturning('I feel anxious today\nand more lines'), t, {})).toBe(t);
    const started = Date.now();
    expect(await cleanTranscript(glmReturning('hang'), t, { timeoutMs: 60 })).toBe(t);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('never calls the model on crisis-looking text', async () => {
    const g = glmReturning('I feel fine');
    for (const t of ['I want to die', 'আমি মরতে চাই', 'मुझे जीना नहीं है', 'मलाई मर्न मन छ', 'I feel hopeless today']) expect(await cleanTranscript(g, t, {})).toBe(t);
    expect(g.calls).toBe(0);
  });
  it('similarity guard', () => {
    expect(similarity('abc def', 'abc def')).toBe(1);
    expect(acceptCleaned('I will meet Rahim at five', 'I will meet Rahim at 5')).toBe(true);
    expect(acceptCleaned('I will meet Rahim at five', 'Sure!')).toBe(false);
  });
});

describe('POST /speech/transcribe options', () => {
  const AUDIO = Buffer.alloc(4000, 3);
  const mk = (glm = fakeGlm('I feel anxious today')) => {
    const s: any = { calls: [], transcribe: async (_b: Buffer, _mime: string, lang: string, _sig?: AbortSignal, ctx?: string) => { s.calls.push({ lang, ctx }); return 'I feel anxius today'; } };
    const app = createApp({ config, db, logger: createLogger('silent'), glm, tts: { synthesize: async () => Buffer.alloc(1200) } as any, stt: s, limits: { global: 10_000, auth: 10_000, messages: 10_000, tts: 10_000 } });
    return { s, app, glm };
  };
  const post = (app: any, token: string, q: string) => request(app).post(`/api/v1/speech/transcribe${q}`).set(auth(token)).set('Content-Type', 'audio/mp4').send(AUDIO);

  it('clean-up is off by default and on with clean=1', async () => {
    const { app, glm } = mk();
    const u = await register(app);
    expect((await post(app, u.accessToken, '?language=en')).body.data.text).toBe('I feel anxius today');
    expect(glm.calls).toHaveLength(0);
    expect((await post(app, u.accessToken, '?language=en&clean=1')).body.data.text).toBe('I feel anxious today');
    expect(glm.calls).toHaveLength(1);
  });

  it("passes the tail of the user's own session as recognition context, never another user's", async () => {
    const { app, s } = mk();
    const u = await register(app);
    const other = await register(app);
    const sid = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({})).body.data.id;
    await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'My friend Tanvir is moving away' });
    await post(app, u.accessToken, `?language=en&sessionId=${sid}`);
    await post(app, other.accessToken, `?language=en&sessionId=${sid}`);
    await post(app, u.accessToken, '?language=en');
    expect(s.calls[0].ctx).toContain('Tanvir');
    expect(s.calls[1].ctx).toBeUndefined();
    expect(s.calls[2].ctx).toBeUndefined();
  });
});
