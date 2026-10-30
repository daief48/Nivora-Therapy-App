import { describe, expect, it, vi } from 'vitest';
import { createGlmClient, isReasoningModel, REASONING_HEADROOM_TOKENS } from '../services/glmClient.js';
import { loadEnv } from '../config/env.js';

const base = { apiKey: 'k', baseUrl: 'https://example.test/v1', timeoutMs: 500, maxOutputTokens: 600, thinkingDisabled: false };
const msgs = [{ role: 'user' as const, content: 'hi' }];
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
async function bodyFor(model: string, extra: Record<string, unknown> = {}, maxTokens?: number) {
  const f = vi.fn(async () => ok());
  await createGlmClient({ ...base, model, ...extra }, f as any).chat(msgs, maxTokens ? { maxTokens } : {});
  return JSON.parse((f.mock.calls[0] as any)[1].body);
}

describe('model families', () => {
  it('detects reasoning models, not chat variants', () => {
    for (const m of ['gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.5', 'o3', 'o4-mini']) expect(isReasoningModel(m), m).toBe(true);
    for (const m of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-5-chat-latest', 'gpt-5.1-chat-latest', 'glm-4.6']) expect(isReasoningModel(m), m).toBe(false);
  });

  it('classic chat models keep max_tokens + temperature and never get reasoning_effort', async () => {
    const b = await bodyFor('gpt-4.1', { reasoningEffort: 'low' });
    expect(b).toMatchObject({ model: 'gpt-4.1', max_tokens: 600, temperature: 0.7, stream: false });
    expect(b.max_completion_tokens).toBeUndefined();
    expect(b.reasoning_effort).toBeUndefined();
  });

  it('reasoning models use max_completion_tokens (with headroom), omit temperature and send reasoning_effort', async () => {
    const b = await bodyFor('gpt-5-mini', { reasoningEffort: 'minimal' }, 260);
    expect(b.max_completion_tokens).toBe(260 + REASONING_HEADROOM_TOKENS);
    expect(b.max_tokens).toBeUndefined();
    expect(b.temperature).toBeUndefined();
    expect(b.reasoning_effort).toBe('minimal');
    const o = await bodyFor('o4-mini');
    expect(o.reasoning_effort).toBeUndefined(); // no effort configured -> omitted
    expect(o.max_completion_tokens).toBe(600 + REASONING_HEADROOM_TOKENS);
  });

  it('streaming requests are mapped the same way', async () => {
    const f = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200 }));
    await createGlmClient({ ...base, model: 'gpt-5.1', reasoningEffort: 'low', streamUsage: true }, f as any).stream(msgs, () => undefined);
    const b = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(b).toMatchObject({ model: 'gpt-5.1', stream: true, reasoning_effort: 'low', stream_options: { include_usage: true } });
    expect(b.temperature).toBeUndefined();
  });
});

describe('model tiering config', () => {
  const env = { NODE_ENV: 'test', DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'a'.repeat(32), DATA_ENCRYPTION_KEYS: 'k1:x' };
  it('has sensible defaults and reads the new variables', () => {
    const d = loadEnv(env as any);
    expect(d.OPENAI_SESSION_MODEL).toBe('gpt-4.1');
    expect(d.OPENAI_UTILITY_MODEL).toBe('');
    expect(d.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(d.EMOTION_READ_VOICE).toBe('0');
    const c = loadEnv({ ...env, OPENAI_SESSION_MODEL: 'gpt-5.1-chat-latest', OPENAI_UTILITY_MODEL: 'gpt-4.1-nano', EMOTION_READ_VOICE: '1' } as any);
    expect([c.OPENAI_SESSION_MODEL, c.OPENAI_UTILITY_MODEL, c.EMOTION_READ_VOICE]).toEqual(['gpt-5.1-chat-latest', 'gpt-4.1-nano', '1']);
  });
});
