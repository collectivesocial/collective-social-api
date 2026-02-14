import { describe, it, expect } from 'vitest';
import { handler } from '../src/lib/http';

describe('handler', () => {
  it('should call the handler function and not call next on success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const middleware = handler(fn);

    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(fn).toHaveBeenCalledWith(req, res);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next with error when handler throws', async () => {
    const error = new Error('test error');
    const fn = vi.fn().mockRejectedValue(error);
    const middleware = handler(fn);

    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('should call next with error when handler throws synchronously', async () => {
    const error = new Error('sync error');
    const fn = vi.fn().mockImplementation(() => {
      throw error;
    });
    const middleware = handler(fn);

    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
