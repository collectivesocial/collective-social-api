import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the config module.
 * Validates that environment variable handling works correctly, especially
 * the security-critical parts like cookie secret validation.
 */

describe('config', () => {
  // Save and restore env vars around each test
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset vitest module cache so dynamic import() re-evaluates config
    vi.resetModules();
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
      const configModule = await import('../src/config');
      return configModule.config;
    }).rejects.toThrow('must be set to a secure value in production');
  });

  it('should require DATABASE_URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'a-very-secure-production-secret-32-chars!';
    delete process.env.DATABASE_URL;

    // Mock dotenv so .env file doesn't re-inject DATABASE_URL
    vi.doMock('dotenv', () => ({ default: { config: () => {} }, config: () => {} }));

    await expect(async () => {
      const configModule = await import('../src/config');
      return configModule.config;
    }).rejects.toThrow('DATABASE_URL must be set in production');
  });

  it('should parse port as integer', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '8080';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    const configModule = await import('../src/config');
    expect(configModule.config.port).toBe(8080);
    expect(typeof configModule.config.port).toBe('number');
  });

  it('should add clientUrl from CLIENT_URL env var', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://app.collectivesocial.app';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    const configModule = await import('../src/config');
    expect(configModule.config.clientUrl).toBe('https://app.collectivesocial.app');
  });

  it('should add corsOrigin from CORS_ORIGIN env var', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = 'https://app.collectivesocial.app';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';

    const configModule = await import('../src/config');
    expect(configModule.config.corsOrigin).toBe('https://app.collectivesocial.app');
  });

  it('should set corsOrigin to undefined when CORS_ORIGIN is not set', async () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';
    delete process.env.CORS_ORIGIN;

    const configModule = await import('../src/config');
    expect(configModule.config.corsOrigin).toBeUndefined();
  });
});
