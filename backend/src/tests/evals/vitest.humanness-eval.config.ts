import { defineConfig } from 'vitest/config';

/** LIVE humanness eval (needs the embedded test DB like behaviour.eval.ts, plus EVAL_LIVE=1 and OPENAI_API_KEY). Run from backend/: npm run eval:humanness */
export default defineConfig({
  test: {
    globalSetup: ['src/tests/globalSetup.ts'],
    setupFiles: ['src/tests/setupEnv.ts'],
    include: ['src/tests/evals/humanness.eval.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
