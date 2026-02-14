import { describe, it, expect } from 'vitest';

/**
 * Tests for the config module.
 * Validates that environment variable handling works correctly, especially
 * the security-critical parts like cookie secret validation.
 */

describe('config', () => {
  // Save and restore env vars around each test
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache so config re-evaluates
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use default values in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    // Re-import to pick up new env
    const configModule = await import('../src/config');
    expect(configModule.config.nodeEnv).toBe('development');
    expect(configModule.config.port).toBe(3000);
    expect(configModule.config.plcUrl).toBe('https://plc.directory');
  });

  it('should reject insecure cookie secret in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'default';
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    await expect(async () => {
      // Clear the module cache
      delete require.cache[require.resolve('../src/config')];
      require('../src/config');
    }).rejects.toThrow('must be set to a secure value in production');
  });

  it('should require DATABASE_URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'a-very-secure-production-secret-32-chars!';
    delete process.env.DATABASE_URL;

    await expect(async () => {
      delete require.cache[require.resolve('../src/config')];
      require('../src/config');
    }).rejects.toThrow('DATABASE_URL must be set in production');
  });

  it('should parse port as integer', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '8080';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    delete require.cache[require.resolve('../src/config')];
    const { config } = require('../src/config');
    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe('number');
  });

  it('should add clientUrl from CLIENT_URL env var', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://app.collectivesocial.app';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    delete require.cache[require.resolve('../src/config')];
    const { config } = require('../src/config');
    expect(config.clientUrl).toBe('https://app.collectivesocial.app');
  });
});
