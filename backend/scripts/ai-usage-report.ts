// Prints the opt-in, anonymous AI aggregates: action offered / accepted / dismissed by kind, fallback used by feature, model calls by feature
// and latency bucket. No text and no user ids exist in these events. Usage: npx tsx scripts/ai-usage-report.ts [days=14]
import { getPrisma } from '../src/config/database.js';

const days = Number(process.argv[2] ?? 14);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const db = getPrisma();
const names = ['action_offered', 'action_accepted', 'action_dismissed', 'fallback_used', 'model_call'];
const rows = await db.analyticsEvent.findMany({ where: { name: { in: names }, day: { gte: since } }, select: { name: true, propsJson: true } });

const tally = (name: string, key: string) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.name !== name) continue;
    const v = String((r.propsJson as Record<string, unknown>)[key] ?? '-');
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const print = (title: string, entries: [string, number][]) => {
  console.log(`\n${title}`);
  if (!entries.length) console.log('  (none)');
  for (const [k, n] of entries) console.log(`  ${k.padEnd(24)} ${String(n).padStart(6)}`);
};

console.log(`AI usage, last ${days} days (opted-in users only, ${rows.length} events)`);
const kinds = new Set([...tally('action_offered', 'kind'), ...tally('action_accepted', 'kind'), ...tally('action_dismissed', 'kind')].map(([k]) => k));
console.log('\nActions by kind            offered accepted dismissed');
const get = (name: string, kind: string) => tally(name, 'kind').find(([k]) => k === kind)?.[1] ?? 0;
for (const k of [...kinds].sort()) console.log(`  ${k.padEnd(24)} ${String(get('action_offered', k)).padStart(6)} ${String(get('action_accepted', k)).padStart(8)} ${String(get('action_dismissed', k)).padStart(9)}`);
print('Fallback used (template instead of model text), by feature', tally('fallback_used', 'feature'));
print('Model calls by feature', tally('model_call', 'feature'));
print('Model latency buckets (lt1s | 1to3s | 3to6s | gt6s)', tally('model_call', 'bucket'));
await db.$disconnect();
