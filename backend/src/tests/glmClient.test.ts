import { describe, expect, it, vi } from 'vitest';
import { createGlmClient } from '../services/glmClient.js';
import { createCipher } from '../utils/crypto.js';

const cfg = { apiKey: 'k', baseUrl: 'https://example.test/v4', model: 'm', timeoutMs: 500, maxOutputTokens: 100, thinkingDisabled: true };
const msgs = [{ role: 'user' as const, content: 'hi' }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = { choices: [{ message: { content: ' hello ' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } };

describe('GLM client (mocked HTTP)', () => {
  it('sends the documented request and parses content + usage', async () => {
    const f = vi.fn(async () => json(ok));
    const r = await createGlmClient(cfg, f as any).chat(msgs);
    expect(r).toEqual({ content: 'hello', inputTokens: 5, outputTokens: 3 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v4/chat/completions');
    expect((init.headers as any).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'm', stream: false, max_tokens: 100, thinking: { type: 'disabled' } });
  });

  it('retries once on a transient 5xx, then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ code: 500 }, 500)).mockResolvedValueOnce(json(ok));
    expect((await createGlmClient(cfg, f as any).chat(msgs)).content).toBe('hello');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry 429 / 401 and maps them without leaking provider bodies', async () => {
    const f429 = vi.fn(async () => json({ error: { message: 'secret-provider-detail' } }, 429));
    await expect(createGlmClient(cfg, f429 as any).chat(msgs)).rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMITED' });
    expect(f429).toHaveBeenCalledTimes(1);
    const f401 = vi.fn(async () => json({}, 401));
    await expect(createGlmClient(cfg, f401 as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_MISCONFIGURED' });
  });

  it('maps exhausted provider balance (code 1113 in a 429) to AI_QUOTA_EXHAUSTED, not rate-limited', async () => {
    const f = vi.fn(async () => json({ error: { code: '1113', message: 'Insufficient balance' } }, 429));
    await expect(createGlmClient(cfg, f as any).chat(msgs)).rejects.toMatchObject({ status: 503, code: 'AI_QUOTA_EXHAUSTED' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps OpenAI insufficient_quota and requests stream usage when enabled', async () => {
    const f = vi.fn(async () => json({ error: { code: 'insufficient_quota', message: 'x' } }, 429));
    await expect(createGlmClient(cfg, f as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_QUOTA_EXHAUSTED' });
    const sse = 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\n';
    const g = vi.fn(async () => new Response(sse, { status: 200 }));
    await createGlmClient({ ...cfg, thinkingDisabled: false, streamUsage: true }, g as any).stream(msgs, () => {});
    const body = JSON.parse((g.mock.calls[0] as any)[1].body);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.thinking).toBeUndefined();
  });

  it('rejects empty/invalid provider responses', async () => {
    await expect(createGlmClient(cfg, (async () => json({ choices: [{ message: { content: '' } }] })) as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_BAD_RESPONSE' });
    await expect(createGlmClient(cfg, (async () => new Response('<html>', { status: 200 })) as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_BAD_RESPONSE' });
  });

  it('times out', async () => {
    const slow = (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(createGlmClient({ ...cfg, timeoutMs: 50 }, slow as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('fails clearly when not configured', async () => {
    await expect(createGlmClient({ ...cfg, apiKey: '' }, vi.fn() as any).chat(msgs)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('parses SSE streams, ignoring reasoning_content and [DONE]', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const f = vi.fn(async () => new Response(sse, { status: 200 }));
    const parts: string[] = [];
    const r = await createGlmClient(cfg, f as any).stream(msgs, (t) => parts.push(t));
    expect(parts).toEqual(['Hel', 'lo']);
    expect(r).toEqual({ content: 'Hello', inputTokens: 4, outputTokens: 2 });
  });

  it('supports caller cancellation', async () => {
    const ac = new AbortController();
    const f = (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
    const p = createGlmClient({ ...cfg, timeoutMs: 5000 }, f as any).chat(msgs, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('encryption', () => {
  const key = (n: number) => `k${n}:${Buffer.alloc(32, n).toString('base64')}`;
  it('round-trips unicode, uses random IVs, detects tampering and supports key rotation', () => {
    const c1 = createCipher(key(1));
    const a = c1.encrypt('বাংলা text'), b = c1.encrypt('বাংলা text');
    expect(a).not.toBe(b);
    expect(c1.decrypt(a)).toBe('বাংলা text');
    const parts = a.split('.'); parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => c1.decrypt(parts.join('.'))).toThrow();
    const rotated = createCipher(`${key(2)},${key(1)}`);
    expect(rotated.decrypt(a)).toBe('বাংলা text'); // old data still readable
    expect(rotated.encrypt('x').startsWith('k2.')).toBe(true); // new data uses new key
    expect(() => createCipher('k:short')).toThrow();
  });
});

describe('GLM client sampling penalties', () => {
  const bodyOf = async (c: any) => { const f = vi.fn(async () => json(ok)); await createGlmClient(c, f as any).chat(msgs); return JSON.parse((f.mock.calls[0] as any)[1].body); };
  it('sends frequency/presence penalties for OpenAI non-reasoning models only', async () => {
    const oa = { ...cfg, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', thinkingDisabled: false };
    expect(await bodyOf(oa)).toMatchObject({ frequency_penalty: 0.3, presence_penalty: 0.1, temperature: 0.7 });
    expect(await bodyOf({ ...oa, frequencyPenalty: 0.5, presencePenalty: 0.2 })).toMatchObject({ frequency_penalty: 0.5, presence_penalty: 0.2 });
    const reasoning = await bodyOf({ ...oa, model: 'gpt-5-mini' });
    expect(reasoning.frequency_penalty).toBeUndefined();
    expect(reasoning.presence_penalty).toBeUndefined();
    expect(reasoning.temperature).toBeUndefined();
  });
  it('does not send them to GLM / other compatible hosts unless the flag is on', async () => {
    const glm = { ...cfg, baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6' };
    const b = await bodyOf(glm);
    expect(b.frequency_penalty).toBeUndefined();
    expect(b.presence_penalty).toBeUndefined();
    expect(await bodyOf({ ...glm, sendPenalties: true })).toMatchObject({ frequency_penalty: 0.3, presence_penalty: 0.1 });
    expect((await bodyOf({ ...cfg, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', sendPenalties: false })).frequency_penalty).toBeUndefined();
  });
});
