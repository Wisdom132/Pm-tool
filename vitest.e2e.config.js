import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.js'],
    environment: 'node',
    // A real browser plus a build server; the default 5s is not enough.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Playwright pages share one browser instance.
    fileParallelism: false,
  },
});
