import { defineConfig } from 'vitest/config';

/**
 * Vitest config for integration tests.
 *
 * These tests require a live PostgreSQL instance via DATABASE_URL_TEST.
 * Run with: npm run test:integration
 *
 * Unit tests are NOT included here — use `npm test` for those.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000,
    // Run integration tests serially to avoid DB-state races between files.
    singleThread: true,
  },
});
