// One-off: encrypts legacy plaintext UserGoal.tasksJson into tasksEnc and clears tasksJson.
// Idempotent (only rows with tasksJson set and tasksEnc null). Dry run by default.
// Usage: npx tsx scripts/backfill-goal-tasks-enc.ts [--apply]
import { getPrisma } from '../src/config/database.js';
import { loadEnv } from '../src/config/env.js';
import { createCipher } from '../src/utils/crypto.js';

const apply = process.argv.includes('--apply');
const db = getPrisma();
const cipher = createCipher(loadEnv().DATA_ENCRYPTION_KEYS);
const rows = await db.userGoal.findMany({ where: { tasksEnc: null, tasksJson: { not: null } }, select: { id: true, tasksJson: true } });
let done = 0, bad = 0;
for (const r of rows) {
  try { JSON.parse(r.tasksJson!); } catch { bad++; continue; } // leave unparseable rows untouched
  if (apply) {
    // tasksEnc: null in the filter: a concurrent app write (which sets tasksEnc) is never clobbered.
    const res = await db.userGoal.updateMany({ where: { id: r.id, tasksEnc: null }, data: { tasksEnc: cipher.encrypt(r.tasksJson!), tasksJson: null } });
    if (res.count === 0) continue;
  }
  done++;
}
console.log(`${apply ? 'encrypted' : 'would encrypt'} ${done} rows; ${bad} unparseable left untouched`);
await db.$disconnect();
