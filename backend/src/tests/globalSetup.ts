import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { startEmbedded } from '../../scripts/dev-db.js';

const URL = 'postgresql://postgres:postgres@localhost:5440/therapy_test';

// Starts a throw-away real PostgreSQL and applies migrations from scratch (this also proves a clean-DB migrate works).
export default async function setup() {
  fs.rmSync('.pgdata-test', { recursive: true, force: true });
  const pg = await startEmbedded('.pgdata-test', 5440);
  await pg.createDatabase('therapy_test');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: URL }, stdio: 'pipe' });
  return async () => {
    await pg.stop();
    fs.rmSync('.pgdata-test', { recursive: true, force: true });
  };
}
