import { defineConfig } from 'vitest/config';

/** Config for the LIVE eval only (the normal config's include pattern does not match *.eval.ts). Run from backend/. */
export default defineConfig({
  test: {
    globalSetup: ['src/tests/globalSetup.ts'],
    setupFiles: ['src/tests/setupEnv.ts'],
    include: ['src/tests/evals/behaviour.eval.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
