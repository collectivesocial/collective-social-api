"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestLogger = createRequestLogger;
const node_crypto_1 = require("node:crypto");
/**
 * Request logging middleware with correlation IDs.
 * Attaches a unique requestId to each request and logs request/response timing.
 */
function createRequestLogger(ctx) {
    return (req, res, next) => {
        const requestId = req.headers['x-request-id'] || (0, node_crypto_1.randomUUID)();
        const start = Date.now();
        // Attach requestId for downstream use
        req.requestId = requestId;
        res.setHeader('x-request-id', requestId);
        // Log on response finish
        res.on('finish', () => {
            const duration = Date.now() - start;
            const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
            ctx.logger[level]({
                requestId,
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration,
                userAgent: req.headers['user-agent'],
            }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
        });
        next();
    };
}
