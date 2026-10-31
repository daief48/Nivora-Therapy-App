// Staff-only aggregate report: thumbs feedback on assistant messages + humanness metrics over recent sessions.
// Usage: npx tsx scripts/humanness-report.ts [days=14]      (npm run eval:humanness:report)
// Privacy: message text is decrypted only in memory to compute metrics and is never printed or logged. Output is counts and rates only,
// no user, session or message ids. Sessions with fewer than MIN_REPLIES assistant replies are skipped (too short to score).
import { getPrisma } from '../src/config/database.js';
import { loadEnv } from '../src/config/env.js';
import { createCipher } from '../src/utils/crypto.js';
import { summarize, PASS_SCORE, type CheckName } from '../src/services/humanness.js';

const days = Number(process.argv[2] ?? 14);
const MIN_REPLIES = 4;
const config = loadEnv();
const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const db = getPrisma();
const since = new Date(Date.now() - days * 86_400_000);

const rows = await db.sessionMessage.findMany({
  where: { createdAt: { gte: since } }, orderBy: [{ sessionId: 'asc' }, { createdAt: 'asc' }],
  select: { sessionId: true, role: true, encryptedContent: true, feedback: true },
});

const up = rows.filter((r) => r.role === 'assistant' && r.feedback === 1).length;
const down = rows.filter((r) => r.role === 'assistant' && r.feedback === -1).length;
const assistantTotal = rows.filter((r) => r.role === 'assistant').length;

const bySession = new Map<string, typeof rows>();
for (const r of rows) { const l = bySession.get(r.sessionId); if (l) l.push(r); else bySession.set(r.sessionId, [r]); }

let scored = 0, passed = 0, scoreSum = 0, downInFailing = 0, downInPassing = 0, assistantInFailing = 0, assistantInPassing = 0;
const failCounts: Partial<Record<CheckName, number>> = {};
const buckets = [0, 0, 0, 0, 0]; // 0-19, 20-39, 40-59, 60-79, 80-100
for (const msgs of bySession.values()) {
  // Pair each assistant reply with the user message that preceded it.
  const replies: string[] = [], users: string[] = [];
  let lastUser = '';
  for (const m of msgs) {
    let text: string;
    try { text = cipher.decrypt(m.encryptedContent); } catch { continue; } // unreadable row (e.g. retired key): skip, never log
    if (m.role === 'user') lastUser = text;
    else if (m.role === 'assistant') { replies.push(text); users.push(lastUser); }
  }
  if (replies.length < MIN_REPLIES) continue;
  const s = summarize(replies, users);
  scored++; scoreSum += s.humannessScore; if (s.pass) passed++;
  buckets[Math.min(4, Math.floor(s.humannessScore / 20))]!++;
  for (const c of s.failingChecks) failCounts[c] = (failCounts[c] ?? 0) + 1;
  const d = msgs.filter((m) => m.role === 'assistant' && m.feedback === -1).length;
  const a = msgs.filter((m) => m.role === 'assistant').length;
  if (s.pass) { downInPassing += d; assistantInPassing += a; } else { downInFailing += d; assistantInFailing += a; }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
console.log(`Humanness report, last ${days} days`);
console.log(`Assistant messages: ${assistantTotal}   thumbs up: ${up}   thumbs down: ${down}   down share of rated: ${pct(down, up + down)}   rated share: ${pct(up + down, assistantTotal)}`);
console.log(`Sessions scored (>= ${MIN_REPLIES} replies): ${scored} of ${bySession.size}`);
if (scored) {
  console.log(`Mean humannessScore: ${(scoreSum / scored).toFixed(1)}   pass rate (score >= ${PASS_SCORE} and no failing check): ${pct(passed, scored)}`);
  console.log(`Score distribution  0-19: ${buckets[0]}  20-39: ${buckets[1]}  40-59: ${buckets[2]}  60-79: ${buckets[3]}  80-100: ${buckets[4]}`);
  console.log('Sessions failing each check: ' + (Object.entries(failCounts).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'));
  console.log(`Thumbs-down per assistant message  in failing sessions: ${pct(downInFailing, assistantInFailing)}   in passing sessions: ${pct(downInPassing, assistantInPassing)}`);
}
await db.$disconnect();
