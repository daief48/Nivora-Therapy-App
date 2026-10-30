// Upserts the built-in corpus into KnowledgeChunk and computes embeddings when OPENAI_API_KEY is set.
// Usage: npx tsx scripts/ingest-knowledge.ts   (idempotent: replaces all rows)
import { getPrisma } from '../src/config/database.js';
import { loadEnv } from '../src/config/env.js';
import { CORPUS } from '../src/services/knowledge/corpus.js';
import { createEmbedder } from '../src/services/knowledge/embedder.js';

const env = loadEnv();
const db = getPrisma();
const rows = CORPUS.flatMap((e) => (['en', 'bn'] as const).map((language) => ({ source: e.source, title: e[language].title, language, content: e[language].content })));

const embedder = createEmbedder({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, timeoutMs: 30_000 });
const vectors = await embedder.embed(rows.map((r) => `${r.title}. ${r.content}`));
if (!vectors) console.warn('No embeddings computed (missing OPENAI_API_KEY or API error): storing text only, retrieval will use keyword search.');

await db.$transaction([
  db.knowledgeChunk.deleteMany(),
  db.knowledgeChunk.createMany({ data: rows.map((r, i) => ({ ...r, embedding: vectors?.[i] ?? [] })) }),
]);
console.log(`Ingested ${rows.length} chunks (${vectors ? 'with' : 'without'} embeddings).`);
await db.$disconnect();
