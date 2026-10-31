import { AppError, providerError } from '../utils/errors.js';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult { content: string; inputTokens: number; outputTokens: number }
export interface GlmConfig {
  apiKey: string; baseUrl: string; model: string; timeoutMs: number; maxOutputTokens: number; thinkingDisabled: boolean; streamUsage?: boolean;
  /** Sent as reasoning_effort to reasoning models (gpt-5 / o-series) only; ignored for other models. */
  reasoningEffort?: string;
  /** Repetition penalties for non-reasoning models. Sent by default only for api.openai.com (other OpenAI-compatible hosts may reject them); set sendPenalties true to force on, false to force off. */
  sendPenalties?: boolean; frequencyPenalty?: number; presencePenalty?: number;
}
export interface GlmClient {
  chat(messages: ChatMessage[], opts?: { signal?: AbortSignal; maxTokens?: number }): Promise<ChatResult>;
  stream(
    messages: ChatMessage[],
    onDelta: (text: string) => void,
    opts?: { signal?: AbortSignal; maxTokens?: number },
  ): Promise<ChatResult>;
}

type FetchLike = typeof fetch;

/** Reasoning models (o3, o4-mini, gpt-5 family) reject max_tokens / temperature. The "-chat" gpt-5 variants behave like normal chat models. */
export function isReasoningModel(model: string): boolean {
  return /^(o3|o4|gpt-5)/i.test(model) && !/-chat/i.test(model);
}
export const DEFAULT_FREQUENCY_PENALTY = 0.3;
export const DEFAULT_PRESENCE_PENALTY = 0.1;
/** Penalties default on only for api.openai.com; GLM / z.ai and other compatible hosts are left untouched unless sendPenalties is set. */
export function penaltiesEnabled(cfg: Pick<GlmConfig, 'baseUrl' | 'sendPenalties'>): boolean {
  if (cfg.sendPenalties !== undefined) return cfg.sendPenalties;
  try { return new URL(cfg.baseUrl).hostname === 'api.openai.com'; } catch { return false; }
}
/** Reasoning tokens count against max_completion_tokens, so reasoning models get headroom on top of the visible-reply cap. */
export const REASONING_HEADROOM_TOKENS = 700;

/** Maps provider HTTP failures to client-safe errors. Provider bodies are never forwarded to the client. */
// Z.AI reports exhausted balance / missing resource package as code 1113 inside an HTTP 429.
const BILLING_CODES = new Set(['1113', 'insufficient_quota', 'billing_not_active']); // Z.AI 1113; OpenAI insufficient_quota
function mapStatus(status: number, providerCode?: string): AppError {
  if (providerCode && BILLING_CODES.has(providerCode)) {
    return providerError('The AI service is not available right now.', 'AI_QUOTA_EXHAUSTED', 503);
  }
  if (status === 429) return providerError('The AI service is busy. Please try again shortly.', 'AI_RATE_LIMITED', 429);
  if (status === 401 || status === 403) return providerError('AI service is not configured correctly.', 'AI_MISCONFIGURED', 503);
  if (status === 400 || status === 404) return providerError('The AI request was rejected.', 'AI_REJECTED', 502);
  return providerError();
}

const retryable = (e: unknown) =>
  e instanceof AppError && (e.code === 'AI_UNAVAILABLE' || e.code === 'AI_TIMEOUT');

export function createGlmClient(cfg: GlmConfig, fetchImpl: FetchLike = fetch): GlmClient {
  function assertConfigured() {
    if (!cfg.apiKey || !cfg.model) throw providerError('AI service is not configured.', 'AI_NOT_CONFIGURED', 503);
  }

  async function request(messages: ChatMessage[], stream: boolean, opts: { signal?: AbortSignal; maxTokens?: number }) {
    assertConfigured();
    const timeout = AbortSignal.timeout(cfg.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const cap = Math.min(opts.maxTokens ?? cfg.maxOutputTokens, cfg.maxOutputTokens);
    const body: Record<string, unknown> = { model: cfg.model, messages, stream };
    if (isReasoningModel(cfg.model)) {
      body.max_completion_tokens = cap + REASONING_HEADROOM_TOKENS;
      if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
    } else {
      body.max_tokens = cap;
      body.temperature = 0.7;
      if (penaltiesEnabled(cfg)) {
        body.frequency_penalty = cfg.frequencyPenalty ?? DEFAULT_FREQUENCY_PENALTY;
        body.presence_penalty = cfg.presencePenalty ?? DEFAULT_PRESENCE_PENALTY;
      }
    }
    if (cfg.thinkingDisabled) body.thinking = { type: 'disabled' };
    if (stream && cfg.streamUsage) body.stream_options = { include_usage: true };
    try {
      const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, ...(stream ? { Accept: 'text/event-stream' } : {}) },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        let code: string | undefined;
        try { const j: any = await res.json(); code = String(j?.error?.code ?? j?.code ?? ''); } catch { /* body is not JSON */ }
        throw mapStatus(res.status, code); // provider message is never forwarded
      }
      return res;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (opts.signal?.aborted) throw new AppError(499, 'CANCELLED', 'Request cancelled');
      if (timeout.aborted) throw providerError('The AI service took too long to respond.', 'AI_TIMEOUT', 504);
      throw providerError();
    }
  }

  return {
    async chat(messages, opts = {}) {
      // Non-streaming completion is a pure read from the provider's view, so a single retry on transient failure is safe.
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await request(messages, false, opts);
          let json: any;
          try { json = await res.json(); } catch { throw providerError('Invalid response from the AI service.', 'AI_BAD_RESPONSE', 502); }
          const content = json?.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) {
            throw providerError('The AI service returned an empty response.', 'AI_BAD_RESPONSE', 502);
          }
          return {
            content: content.trim(),
            inputTokens: Number(json?.usage?.prompt_tokens) || 0,
            outputTokens: Number(json?.usage?.completion_tokens) || 0,
          };
        } catch (e) {
          if (attempt < 1 && retryable(e) && !opts.signal?.aborted) { await new Promise((r) => setTimeout(r, 400)); continue; }
          throw e;
        }
      }
    },

    async stream(messages, onDelta, opts = {}) {
      // No retry once streaming starts: re-sending could duplicate output the user already saw.
      const res = await request(messages, true, opts);
      if (!res.body) throw providerError('Invalid response from the AI service.', 'AI_BAD_RESPONSE', 502);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', content = '', inTok = 0, outTok = 0;
      const handle = (line: string) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let j: any;
        try { j = JSON.parse(data); } catch { return; }
        const delta = j?.choices?.[0]?.delta?.content; // reasoning_content is intentionally ignored
        if (typeof delta === 'string' && delta) { content += delta; onDelta(delta); }
        if (j?.usage) { inTok = Number(j.usage.prompt_tokens) || inTok; outTok = Number(j.usage.completion_tokens) || outTok; }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl).trim()); buf = buf.slice(nl + 1); }
        }
        if (buf.trim()) handle(buf.trim());
      } catch (e) {
        if (opts.signal?.aborted) throw new AppError(499, 'CANCELLED', 'Request cancelled');
        if (e instanceof AppError) throw e;
        throw providerError('The AI response was interrupted.', 'AI_UNAVAILABLE', 502);
      }
      if (!content.trim()) throw providerError('The AI service returned an empty response.', 'AI_BAD_RESPONSE', 502);
      // Token usage may be absent from streams: fall back to a rough estimate (flagged by approximation only in usage records).
      return { content: content.trim(), inputTokens: inTok || Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4), outputTokens: outTok || Math.ceil(content.length / 4) };
    },
  };
}
