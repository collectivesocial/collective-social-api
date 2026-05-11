import { Request, Response, NextFunction } from 'express';
import type { AppContext } from '../context';

/**
 * Global error handler middleware.
 * Catches all errors forwarded by route handlers and returns a consistent JSON response.
 * Returns a structured { error, code } shape so the frontend can display actionable messages.
 * Stack traces are only included in development mode.
 */
export function createErrorHandler(ctx: AppContext) {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as any).status || (err as any).statusCode || 500;

    ctx.logger.error(
      {
        err,
        method: req.method,
        url: req.originalUrl,
        status,
      },
      'Unhandled error'
    );

    const code =
      status === 400
        ? 'BAD_REQUEST'
        : status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 429
                ? 'RATE_LIMITED'
                : 'SERVER_ERROR';

    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message,
      code,
      ...(ctx.logger.level === 'debug' || process.env.NODE_ENV !== 'production'
        ? { stack: err.stack }
        : {}),
    });
  };
}
