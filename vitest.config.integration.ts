import { defineConfig } from 'vitest/config';

const dbUrl = process.env.DATABASE_URL_TEST;
if (!dbUrl) {
  throw new Error(
    'DATABASE_URL_TEST must be set to run integration tests.\n' +
      'Example: DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/collective_social_test npm run test:integration'
  );
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run integration tests serially to avoid DB contention
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
