// Staff-only: dumps the de-identified excerpts users chose to share (JSON lines on stdout). No user id, email or session id is included.
// Usage: npx tsx scripts/quality-export.ts [days=30] > samples.jsonl
import { getPrisma } from '../src/config/database.js';
import { loadEnv } from '../src/config/env.js';
import { createCipher } from '../src/utils/crypto.js';
import { scrub } from '../src/services/piiScrubber.js';

const days = Number(process.argv[2] ?? 30);
const config = loadEnv();
const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const db = getPrisma();
const since = new Date(Date.now() - days * 86_400_000);
const rows = await db.qualityReviewSample.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, encryptedContent: true } });
for (const r of rows) {
  const c = JSON.parse(cipher.decrypt(r.encryptedContent)) as { messages: { role: string; text: string }[] };
  // Scrub a second time on export: cheap, and catches anything the patterns learned since the sample was stored.
  const messages = c.messages.map((m) => ({ role: m.role, text: scrub(m.text).text }));
  console.log(JSON.stringify({ sample: r.id.slice(0, 8), day: r.createdAt.toISOString().slice(0, 10), messages }));
}
console.error(`${rows.length} samples`);
await db.$disconnect();
