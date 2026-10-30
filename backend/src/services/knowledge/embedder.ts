export interface Embedder { embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> }
export interface EmbedderOptions { apiKey: string; baseUrl: string; model?: string; timeoutMs?: number }

/** OpenAI-compatible /embeddings. Returns null on any failure so callers can fall back to keyword search. */
export function createEmbedder(o: EmbedderOptions): Embedder {
  const model = o.model ?? 'text-embedding-3-small';
  return {
    async embed(texts, signal) {
      if (!o.apiKey || texts.length === 0) return null;
      const timeout = AbortSignal.timeout(o.timeoutMs ?? 8000);
      try {
        const res = await fetch(`${o.baseUrl.replace(/\/$/, '')}/embeddings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
          body: JSON.stringify({ model, input: texts }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!res.ok) return null;
        const body = await res.json() as { data?: { index: number; embedding: number[] }[] };
        if (!body.data || body.data.length !== texts.length) return null;
        return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      } catch { return null; }
    },
  };
}
