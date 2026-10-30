import type { Db } from '../../config/database.js';
import { CORPUS } from './corpus.js';
import type { Embedder } from './embedder.js';

export interface Passage { title: string; content: string; source: string; score: number }
export interface Retriever { retrieve(query: string, lang: 'en' | 'bn' | 'hi' | 'ne' | 'mixed' | 'auto', k?: number): Promise<Passage[]> }

interface Chunk { source: string; title: string; language: string; content: string; embedding: number[]; tokens: string[] }

const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2);
// Light suffix stripping so Bangla inflections ("চিন্তাগুলো", "ঘুমের") still match their stems.
const BN_SUFFIX = /(গুলো|গুলি|দের|কে|রা|টা|টি|ের|র|ে)$/u;
const stem = (w: string) => (/[ঀ-৿]/.test(w) ? w.replace(BN_SUFFIX, '') : w.replace(/(ing|ed|es|s)$/, ''));
const terms = (s: string) => tokenize(s).map(stem).filter((w) => w.length > 1);
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'was', 'have', 'not', 'but', 'can', 'what', 'about', 'feel', 'feeling']);

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RetrieverOptions { db?: Db; embedder?: Embedder; minVectorScore?: number; minKeywordScore?: number; cacheMs?: number }

export function createRetriever(o: RetrieverOptions = {}): Retriever {
  const minVec = o.minVectorScore ?? 0.3, minKw = o.minKeywordScore ?? 1.5, cacheMs = o.cacheMs ?? 10 * 60_000;
  let cache: { at: number; chunks: Chunk[] } | null = null;

  async function load(): Promise<Chunk[]> {
    if (cache && Date.now() - cache.at < cacheMs) return cache.chunks;
    let chunks: Chunk[] = [];
    try {
      const rows = o.db ? await o.db.knowledgeChunk.findMany() : [];
      chunks = rows.map((r) => ({ source: r.source, title: r.title, language: r.language, content: r.content, embedding: r.embedding, tokens: terms(`${r.title} ${r.content}`) }));
    } catch { /* table unavailable: use the built-in corpus */ }
    if (chunks.length === 0) {
      chunks = CORPUS.flatMap((e) => (['en', 'bn'] as const).map((language) => ({
        source: e.source, title: e[language].title, language, content: e[language].content, embedding: [] as number[],
        tokens: terms(`${e[language].title} ${e[language].content}`),
      })));
    }
    cache = { at: Date.now(), chunks };
    return chunks;
  }

  function keyword(query: string, pool: Chunk[], k: number): Passage[] {
    const q = [...new Set(terms(query).filter((w) => !STOP.has(w)))];
    if (q.length === 0) return [];
    const avg = pool.reduce((s, c) => s + c.tokens.length, 0) / (pool.length || 1);
    const df = new Map<string, number>();
    for (const w of q) df.set(w, pool.filter((c) => c.tokens.some((t) => t === w || (w.length > 3 && t.startsWith(w)))).length);
    return pool.map((c) => {
      let score = 0;
      for (const w of q) {
        const tf = c.tokens.filter((t) => t === w || (w.length > 3 && t.startsWith(w))).length;
        if (!tf) continue;
        const idf = Math.log(1 + (pool.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * c.tokens.length / avg));
      }
      return { title: c.title, content: c.content, source: c.source, score };
    }).filter((p) => p.score >= minKw).sort((a, b) => b.score - a.score).slice(0, k);
  }

  return {
    async retrieve(query, lang, k = 3) {
      const text = query.trim();
      if (!text) return [];
      const all = await load();
      const want = lang === 'mixed' || lang === 'auto' ? (/[ঀ-৿]/.test(text) ? 'bn' : 'en') : lang === 'bn' ? 'bn' : 'en'; // hi/ne: corpus is en/bn only, use English
      const pool = all.filter((c) => c.language === want);
      if (pool.length === 0) return [];
      const withVec = pool.filter((c) => c.embedding.length > 0);
      if (o.embedder && withVec.length > 0) {
        const qv = (await o.embedder.embed([text.slice(0, 1500)]))?.[0];
        if (qv) {
          return withVec.map((c) => ({ title: c.title, content: c.content, source: c.source, score: cosine(qv, c.embedding) }))
            .filter((p) => p.score >= minVec).sort((a, b) => b.score - a.score).slice(0, k);
        }
      }
      return keyword(text, pool, k);
    },
  };
}

/** Formats passages for the system prompt. Empty string when there is nothing relevant. */
export function formatKnowledge(passages: Passage[]): string {
  if (passages.length === 0) return '';
  const body = passages.map((p, i) => `${i + 1}. ${p.title} (${p.source}): ${p.content}`).join('\n');
  return `RETRIEVED KNOWLEDGE (use only if relevant, never quote as medical advice):\n${body}`;
}
