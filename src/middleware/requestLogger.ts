import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';

/**
 * Request logging middleware with correlation IDs.
 * Attaches a unique requestId to each request and logs request/response timing.
 */
export function createRequestLogger(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    const start = Date.now();

    // Attach requestId for downstream use
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    // Log on response finish
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level =
        res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info';

      ctx.logger[level](
        {
          requestId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          duration,
          userAgent: req.headers['user-agent'],
        },
        `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
      );
    });

    next();
  };
}
