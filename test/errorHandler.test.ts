import { describe, it, expect, vi } from 'vitest';
import { createErrorHandler } from '../src/middleware/errorHandler';

describe('errorHandler', () => {
  const mockLogger = {
    error: vi.fn(),
    level: 'info',
  };

  const ctx = {
    logger: mockLogger,
  } as any;

  const createMockRes = () => {
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  };

  it('should return 500 for errors without status', () => {
    const handler = createErrorHandler(ctx);
    const req = { method: 'GET', originalUrl: '/test' } as any;
    const res = createMockRes();
    const next = vi.fn();

    handler(new Error('Something broke'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Internal server error' })
    );
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should use error status code when present', () => {
    const handler = createErrorHandler(ctx);
    const req = { method: 'POST', originalUrl: '/api/test' } as any;
    const res = createMockRes();
    const next = vi.fn();

    const error = new Error('Not found') as any;
    error.status = 404;

    handler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Not found' })
    );
  });

  it('should hide internal error details for 5xx in production', () => {
    const prodCtx = {
      logger: { ...mockLogger, level: 'info' },
    } as any;

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const handler = createErrorHandler(prodCtx);
    const req = { method: 'GET', originalUrl: '/api/data' } as any;
    const res = createMockRes();
    const next = vi.fn();

    handler(new Error('Database connection failed'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.error).toBe('Internal server error');
    expect(jsonArg.stack).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });
});
