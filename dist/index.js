"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const user_1 = require("./routes/user");
const auth_1 = require("./routes/auth");
const collections_1 = require("./routes/collections");
const media_1 = require("./routes/media");
const admin_1 = require("./routes/admin");
const feedback_1 = require("./routes/feedback");
const feed_1 = require("./routes/feed");
const share_1 = require("./routes/share");
const reviewSegments_1 = require("./routes/reviewSegments");
const tags_1 = require("./routes/tags");
const comments_1 = require("./routes/comments");
const reactions_1 = require("./routes/reactions");
const groups_1 = require("./routes/groups");
const groupContent_1 = require("./routes/groupContent");
const notifications_1 = require("./routes/notifications");
const useritems_1 = require("./routes/useritems");
const completions_1 = require("./routes/completions");
const config_1 = require("./config");
const context_1 = require("./context");
const trackUserActivity_1 = require("./middleware/trackUserActivity");
const errorHandler_1 = require("./middleware/errorHandler");
const requestLogger_1 = require("./middleware/requestLogger");
const app = (0, express_1.default)();
// Security headers
app.use((0, helmet_1.default)());
// CORS — use CLIENT_URL in production, localhost in dev
app.use((0, cors_1.default)({
    origin: config_1.config.clientUrl || 'http://127.0.0.1:5173',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '1mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Health check — available before context initialization
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// Initialize app context and routes
(0, context_1.createAppContext)().then((ctx) => {
    // Request logging with correlation IDs
    app.use((0, requestLogger_1.createRequestLogger)(ctx));
    // User activity tracking
    app.use((0, trackUserActivity_1.createUserActivityTracker)(ctx));
    // Mount routes
    app.use((0, auth_1.createRouter)(ctx));
    app.use('/users', (0, user_1.createRouter)(ctx));
    app.use('/collections', (0, collections_1.createRouter)(ctx));
    app.use('/media', (0, media_1.createRouter)(ctx));
    app.use('/admin', (0, admin_1.createRouter)(ctx));
    app.use('/feedback', (0, feedback_1.createRouter)(ctx));
    app.use('/feed', (0, feed_1.createRouter)(ctx));
    app.use('/share', (0, share_1.createRouter)(ctx));
    app.use('/reviewsegments', (0, reviewSegments_1.createRouter)(ctx));
    (0, tags_1.createRouter)(ctx, app);
    app.use('/comments', (0, comments_1.createRouter)(ctx));
    app.use('/reactions', (0, reactions_1.createRouter)(ctx));
    app.use('/groups', (0, groups_1.createRouter)(ctx));
    app.use('/groups/:communityDid', (0, groupContent_1.createRouter)(ctx));
    app.use('/notifications', (0, notifications_1.createRouter)(ctx));
    app.use('/useritems', (0, useritems_1.createRouter)(ctx));
    app.use('/completions', (0, completions_1.createRouter)(ctx));
    // Root route
    app.get('/', (_req, res) => {
        res.redirect(config_1.config.clientUrl || 'http://127.0.0.1:5173');
    });
    // Global error handler (must be last middleware)
    app.use((0, errorHandler_1.createErrorHandler)(ctx));
    const server = app.listen(config_1.config.port, () => {
        ctx.logger.info({ port: config_1.config.port }, `Server running on port ${config_1.config.port}`);
    });
    // Graceful shutdown
    const shutdown = async (signal) => {
        ctx.logger.info({ signal }, 'Shutdown signal received');
        server.close(async () => {
            ctx.logger.info('HTTP server closed');
            await ctx.destroy();
            ctx.logger.info('Database connections closed');
            process.exit(0);
        });
        // Force exit after 10s
        setTimeout(() => {
            ctx.logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
});
