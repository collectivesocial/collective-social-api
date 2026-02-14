"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorHandler = createErrorHandler;
/**
 * Global error handler middleware.
 * Catches all errors forwarded by route handlers and returns a consistent JSON response.
 * Stack traces are only included in development mode.
 */
function createErrorHandler(ctx) {
    return (err, req, res, _next) => {
        const status = err.status || err.statusCode || 500;
        ctx.logger.error({
            err,
            method: req.method,
            url: req.originalUrl,
            status,
        }, 'Unhandled error');
        res.status(status).json({
            error: status >= 500 ? 'Internal server error' : err.message,
            ...(ctx.logger.level === 'debug' || process.env.NODE_ENV !== 'production'
                ? { stack: err.stack }
                : {}),
        });
    };
}
