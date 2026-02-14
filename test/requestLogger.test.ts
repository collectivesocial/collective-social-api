import { describe, it, expect, vi } from 'vitest';
import { createRequestLogger } from '../src/middleware/requestLogger';

describe('requestLogger', () => {
  const createMockCtx = () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  it('should set x-request-id header on response', () => {
    const ctx = createMockCtx() as any;
    const middleware = createRequestLogger(ctx);

    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/test',
    } as any;

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      on: vi.fn(),
      statusCode: 200,
    } as any;

    middleware(req, res, vi.fn());

    expect(headers['x-request-id']).toBeDefined();
    expect(typeof headers['x-request-id']).toBe('string');
  });

  it('should use provided x-request-id from request headers', () => {
    const ctx = createMockCtx() as any;
    const middleware = createRequestLogger(ctx);

    const req = {
      headers: { 'x-request-id': 'custom-id-123' },
      method: 'GET',
      originalUrl: '/test',
    } as any;

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      on: vi.fn(),
      statusCode: 200,
    } as any;

    middleware(req, res, vi.fn());

    expect(headers['x-request-id']).toBe('custom-id-123');
    expect((req as any).requestId).toBe('custom-id-123');
  });

  it('should call next to continue middleware chain', () => {
    const ctx = createMockCtx() as any;
    const middleware = createRequestLogger(ctx);

    const req = { headers: {}, method: 'GET', originalUrl: '/' } as any;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      statusCode: 200,
    } as any;

    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
