// Prints daily counts (and distinct daily pseudonymous visitors) per event. Usage: npx tsx scripts/analytics-report.ts [days=14]
import { getPrisma } from '../src/config/database.js';

const days = Number(process.argv[2] ?? 14);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const db = getPrisma();
const rows = await db.analyticsEvent.groupBy({ by: ['day', 'name'], where: { day: { gte: since } }, _count: { _all: true }, orderBy: [{ day: 'desc' }, { name: 'asc' }] });
const people = await db.$queryRaw<{ day: string; name: string; n: bigint }[]>`
  SELECT day, name, COUNT(DISTINCT "anonId") AS n FROM "AnalyticsEvent" WHERE day >= ${since} GROUP BY day, name`;
const uniq = new Map(people.map((p) => [`${p.day}|${p.name}`, Number(p.n)]));
console.log('day         event                      count  visitors');
for (const r of rows) console.log(`${r.day}  ${r.name.padEnd(25)} ${String(r._count._all).padStart(5)}  ${String(uniq.get(`${r.day}|${r.name}`) ?? 0).padStart(8)}`);
await db.$disconnect();
