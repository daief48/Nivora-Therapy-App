import { defineConfig } from 'vitest/config';

/** Offline deterministic evals (no database, no network, no API key): safety recall and reply-style. Run from backend/: npm run eval:safety */
export default defineConfig({
  test: {
    include: ['src/tests/evals/safety-recall.eval.ts', 'src/tests/evals/reply-style.eval.ts'],
    testTimeout: 30_000,
  },
});
