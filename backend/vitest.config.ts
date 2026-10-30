import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['src/tests/globalSetup.ts'],
    setupFiles: ['src/tests/setupEnv.ts'],
    include: ['src/tests/**/*.test.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
