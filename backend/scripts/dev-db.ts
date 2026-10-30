// Starts a local, real PostgreSQL via the `embedded-postgres` package (dev/test convenience only).
// Production must use a managed PostgreSQL instance.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';

export async function startEmbedded(dataDir: string, port: number) {
  const fresh = !fs.existsSync(dataDir);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--no-sync'],
  });
  if (fresh) await pg.initialise();
  await pg.start();
  return pg;
}

if (process.argv[1]?.endsWith('dev-db.ts')) {
  const port = Number(process.env.DEV_DB_PORT ?? 5434);
  const pg = await startEmbedded('.pgdata', port);
  try { await pg.createDatabase('nivora'); } catch { /* exists */ }
  console.log(`Dev PostgreSQL running: postgresql://postgres:postgres@localhost:${port}/nivora`);
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
}
