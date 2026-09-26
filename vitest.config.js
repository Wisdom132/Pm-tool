import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E runs separately: it needs a Playwright browser and is far slower.
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**'],
    environment: 'node',
    // Keep expected log output from drowning the test report.
    env: { LOG_LEVEL: 'error' },
  },
});
