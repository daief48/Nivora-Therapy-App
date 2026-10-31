import { defineConfig } from 'vitest/config';

/** Pure unit tests for services/humanness.ts: no database, no network, no globalSetup. Run from backend/: npx vitest run --config src/tests/evals/vitest.humanness-unit.config.ts */
export default defineConfig({
  test: { include: ['src/tests/humanness.test.ts'], testTimeout: 30_000 },
});
