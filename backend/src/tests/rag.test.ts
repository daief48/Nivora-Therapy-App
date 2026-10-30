import { describe, expect, it } from 'vitest';
import { CORPUS } from '../services/knowledge/corpus.js';
import { createRetriever, formatKnowledge } from '../services/knowledge/retriever.js';
import type { Embedder } from '../services/knowledge/embedder.js';
import { auth, fakeGlm, makeApp, register } from './helpers.js';
import request from 'supertest';

const failing: Embedder = { async embed() { return null; } };

describe('RAG knowledge', () => {
  it('corpus is bilingual and large enough', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    for (const e of CORPUS) { expect(e.en.content.length).toBeGreaterThan(40); expect(/[ঀ-৿]/.test(e.bn.content)).toBe(true); }
  });

  it('keyword fallback finds relevant passages in the right language', async () => {
    const r = createRetriever({ embedder: failing });
    const en = await r.retrieve('I cannot sleep and my mind races at bedtime', 'en');
    expect(en.length).toBeGreaterThan(0);
    expect(en.length).toBeLessThanOrEqual(3);
    const bn = await r.retrieve('আমার ঘুম আসে না, রাতে চিন্তা দৌড়ায়', 'bn');
    expect(bn.length).toBeGreaterThan(0);
    expect(await r.retrieve('qwertyuiop zxcvb', 'en')).toEqual([]);
    expect(formatKnowledge(en)).toContain('RETRIEVED KNOWLEDGE (use only if relevant, never quote as medical advice)');
    expect(formatKnowledge([])).toBe('');
  });

  it('uses cosine similarity when embeddings exist', async () => {
    const fakeDb: any = { knowledgeChunk: { findMany: async () => [
      { source: 's', title: 'A', language: 'en', content: 'about a', embedding: [1, 0] },
      { source: 's', title: 'B', language: 'en', content: 'about b', embedding: [0, 1] },
    ] } };
    const r = createRetriever({ db: fakeDb, embedder: { async embed() { return [[0, 1]]; } } });
    const out = await r.retrieve('anything', 'en');
    expect(out.map((p) => p.title)).toEqual(['B']);
  });

  it('chat injects retrieved knowledge for normal messages, never for crisis, and survives retrieval errors', async () => {
    const glm = fakeGlm('ok');
    const retriever = { async retrieve() { return [{ title: 'T', content: 'C', source: 'S', score: 1 }]; } };
    const app = makeApp({ glm, retriever } as any);
    const u = await register(app);
    const s = await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({});
    const id = s.body.data.id;
    await request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(u.accessToken)).send({ text: 'I feel stressed about exams' });
    expect(glm.calls.at(-1)![0]!.content).toContain('RETRIEVED KNOWLEDGE');
    const before = glm.calls.length;
    await request(app).post(`/api/v1/sessions/${id}/messages`).set(auth(u.accessToken)).send({ text: 'I want to kill myself' });
    expect(glm.calls.length).toBe(before);

    const glm2 = fakeGlm('ok');
    const app2 = makeApp({ glm: glm2, retriever: { async retrieve() { throw new Error('boom'); } } } as any);
    const u2 = await register(app2);
    const s2 = await request(app2).post('/api/v1/sessions').set(auth(u2.accessToken)).send({});
    const r2 = await request(app2).post(`/api/v1/sessions/${s2.body.data.id}/messages`).set(auth(u2.accessToken)).send({ text: 'hello there' });
    expect(r2.status).toBeLessThan(300);
    expect(glm2.calls.at(-1)![0]!.content).not.toContain('RETRIEVED KNOWLEDGE');
  });
});
