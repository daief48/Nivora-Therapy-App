import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { cleanForSpeech, createTtsClient, type TtsClient } from '../services/ttsClient.js';
import { providerError } from '../utils/errors.js';
import { auth, captureLogs, config, db, fakeGlm, register } from './helpers.js';
import { createLogger } from '../utils/logger.js';

const MP3 = Buffer.alloc(1024, 1);
function makeSpeechApp(tts: TtsClient, logStream?: NodeJS.WritableStream) {
  const logger = logStream ? createLogger('trace', logStream as any) : createLogger('silent');
  return createApp({ config, db, logger, glm: fakeGlm(), tts, limits: { global: 10_000, auth: 10_000, messages: 10_000, tts: 10_000 } });
}
const okTts = (): TtsClient & { calls: any[] } => {
  const t: any = { calls: [], synthesize: async (text: string, lang: string) => { t.calls.push({ text, lang }); return MP3; } };
  return t;
};
const post = (app: any, token: string | null, body: unknown) => {
  const r = request(app).post('/api/v1/speech').send(body as object);
  return token ? r.set(auth(token)) : r;
};

describe('POST /speech', () => {
  it('requires authentication', async () => {
    expect((await post(makeSpeechApp(okTts()), null, { text: 'হ্যালো', language: 'bn' })).status).toBe(401);
  });

  it('returns mp3 audio for a Bangla reply and passes the language through', async () => {
    const tts = okTts();
    const app = makeSpeechApp(tts);
    const u = await register(app);
    const res = await post(app, u.accessToken, { text: 'আমি এখানে আছি।', language: 'bn' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(res.body).length).toBe(1024);
    expect(tts.calls[0]).toEqual({ text: 'আমি এখানে আছি।', lang: 'bn' });
  });

  it('enforces consent like chat does', async () => {
    const app = makeSpeechApp(okTts());
    const u = await register(app);
    const cs = await request(app).get('/api/v1/consents').set(auth(u.accessToken));
    const ai = cs.body.data.find((c: any) => c.consentType === 'AI_DISCLOSURE');
    await request(app).delete(`/api/v1/consents/${ai.id}`).set(auth(u.accessToken)).expect(204);
    const res = await post(app, u.accessToken, { text: 'hello', language: 'en' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('validates input: empty, oversized and unknown language', async () => {
    const app = makeSpeechApp(okTts());
    const u = await register(app);
    expect((await post(app, u.accessToken, { text: '   ', language: 'bn' })).status).toBe(400);
    expect((await post(app, u.accessToken, { text: 'ক'.repeat(1201), language: 'bn' })).status).toBe(400);
    expect((await post(app, u.accessToken, { text: 'hi', language: 'fr' })).status).toBe(400);
  });

  it('maps provider failures to safe errors', async () => {
    const app = makeSpeechApp({ synthesize: async () => { throw providerError('Natural voice is not available right now.', 'TTS_QUOTA_EXHAUSTED', 503); } });
    const u = await register(app);
    const res = await post(app, u.accessToken, { text: 'hello', language: 'en' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TTS_QUOTA_EXHAUSTED');
  });

  it('rate limits per user', async () => {
    const logger = createLogger('silent');
    const app = createApp({ config, db, logger, glm: fakeGlm(), tts: okTts(), limits: { global: 10_000, auth: 10_000, messages: 10_000, tts: 2 } });
    const u = await register(app);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post(app, u.accessToken, { text: 'hi', language: 'en' })).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it('never writes the spoken text to the logs', async () => {
    const logs = captureLogs();
    const app = makeSpeechApp(okTts(), logs.stream);
    const u = await register(app);
    await post(app, u.accessToken, { text: 'SPOKEN-SECRET-টেক্সট-991', language: 'mixed' });
    expect(logs.text().length).toBeGreaterThan(0);
    expect(logs.text()).not.toContain('SPOKEN-SECRET');
  });
});

describe('TTS client (mocked HTTP)', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'gpt-4o-mini-tts', voice: 'nova', timeoutMs: 500 };
  const audio = () => new Response(MP3, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

  it('sends model, voice, a Bangla instruction and mp3 format', async () => {
    const f = vi.fn(async () => audio());
    await createTtsClient(cfg, f as any).synthesize('আমি এখানে আছি 😊 **ঠিক আছে**', 'bn');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/audio/speech');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', response_format: 'mp3' });
    expect(body.instructions).toMatch(/Bangla/);
    expect(body.input).toBe('আমি এখানে আছি ঠিক আছে'); // emoji and markdown are not read aloud
  });

  it('maps quota, rate limit, auth and outage errors', async () => {
    const run = (status: number, code?: string) => createTtsClient(cfg, (async () => new Response(JSON.stringify({ error: { code } }), { status })) as any).synthesize('hi', 'en');
    await expect(run(429, 'insufficient_quota')).rejects.toMatchObject({ code: 'TTS_QUOTA_EXHAUSTED' });
    await expect(run(429, 'rate_limit_exceeded')).rejects.toMatchObject({ status: 429, code: 'TTS_RATE_LIMITED' });
    await expect(run(401)).rejects.toMatchObject({ code: 'TTS_MISCONFIGURED' });
    await expect(run(500)).rejects.toMatchObject({ code: 'TTS_UNAVAILABLE' });
  });

  it('fails clearly when unconfigured and rejects tiny/empty responses', async () => {
    await expect(createTtsClient({ ...cfg, apiKey: '' }, vi.fn() as any).synthesize('hi', 'en')).rejects.toMatchObject({ code: 'TTS_NOT_CONFIGURED' });
    await expect(createTtsClient(cfg, (async () => new Response(Buffer.alloc(10), { status: 200 })) as any).synthesize('hi', 'en')).rejects.toMatchObject({ code: 'TTS_BAD_RESPONSE' });
  });

  it('cleanForSpeech strips markdown, links, code and emoji', () => {
    expect(cleanForSpeech('## Title\n- item **bold** https://x.co `code` 😊')).toBe('Title\nitem bold code');
  });
});

describe('POST /speech/transcribe (Bangla listening)', () => {
  const AUDIO = Buffer.alloc(4000, 3);
  const stt = (text = 'আমি আজ খুব ক্লান্ত') => { const s: any = { calls: [], transcribe: async (b: Buffer, mime: string, lang: string) => { s.calls.push({ n: b.length, mime, lang }); return text; } }; return s; };
  const appWith = (s: any) => createApp({ config, db, logger: createLogger('silent'), glm: fakeGlm(), tts: okTts(), stt: s, limits: { global: 10_000, auth: 10_000, messages: 10_000, tts: 10_000 } });
  const send = (app: any, token: string | null, body: Buffer, type = 'audio/mp4', q = '?language=bn') => {
    const r = request(app).post(`/api/v1/speech/transcribe${q}`).set('Content-Type', type).send(body);
    return token ? r.set(auth(token)) : r;
  };

  it('requires authentication', async () => {
    expect((await send(appWith(stt()), null, AUDIO)).status).toBe(401);
  });

  it('turns a recording into text and passes the language through', async () => {
    const s = stt();
    const app = appWith(s);
    const u = await register(app);
    const res = await send(app, u.accessToken, AUDIO);
    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe('আমি আজ খুব ক্লান্ত');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(s.calls[0]).toEqual({ n: 4000, mime: 'audio/mp4', lang: 'bn' });
  });

  it('rejects empty/tiny audio and non-audio uploads', async () => {
    const app = appWith(stt());
    const u = await register(app);
    expect((await send(app, u.accessToken, Buffer.alloc(10, 1))).status).toBe(400);
    expect((await send(app, u.accessToken, AUDIO, 'text/plain')).status).toBe(415);
  });

  it('enforces consent', async () => {
    const app = appWith(stt());
    const u = await register(app);
    const cs = await request(app).get('/api/v1/consents').set(auth(u.accessToken));
    const ai = cs.body.data.find((c: any) => c.consentType === 'AI_DISCLOSURE');
    await request(app).delete(`/api/v1/consents/${ai.id}`).set(auth(u.accessToken)).expect(204);
    expect((await send(app, u.accessToken, AUDIO)).status).toBe(403);
  });
});

describe('createSttClient', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'gpt-4o-transcribe', timeoutMs: 500 };
  it('forces the Bangla hint, sends the audio as a file and returns the text', async () => {
    const f = vi.fn(async (_u: any, init: any) => { expect(init.body.get('language')).toBe('bn'); expect(init.body.get('file').name).toBe('speech.m4a'); return new Response(JSON.stringify({ text: ' হ্যালো ' }), { status: 200 }); });
    const { createSttClient } = await import('../services/sttClient.js');
    expect(await createSttClient(cfg, f as any).transcribe(Buffer.alloc(900), 'audio/mp4', 'bn')).toBe('হ্যালো');
  });
  it('maps quota and rate-limit errors to safe codes, and fails closed without a key', async () => {
    const { createSttClient } = await import('../services/sttClient.js');
    const quota = createSttClient(cfg, (async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })) as any);
    await expect(quota.transcribe(Buffer.alloc(900), 'audio/mp4', 'bn')).rejects.toMatchObject({ code: 'STT_QUOTA_EXHAUSTED' });
    await expect(createSttClient({ ...cfg, apiKey: '' }).transcribe(Buffer.alloc(900), 'audio/mp4', 'bn')).rejects.toMatchObject({ code: 'STT_NOT_CONFIGURED' });
  });
});
