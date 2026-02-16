import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createRouter as createUserRouter } from './routes/user';
import { createRouter as createAuthRouter } from './routes/auth';
import { createRouter as createCollectionsRouter } from './routes/collections';
import { createRouter as createMediaRouter } from './routes/media';
import { createRouter as createAdminRouter } from './routes/admin';
import { createRouter as createFeedbackRouter } from './routes/feedback';
import { createRouter as createFeedRouter } from './routes/feed';
import { createRouter as createShareRouter } from './routes/share';
import { createRouter as createReviewSegmentsRouter } from './routes/reviewSegments';
import { createRouter as createTagsRouter } from './routes/tags';
import { createRouter as createCommentsRouter } from './routes/comments';
import { createRouter as createReactionsRouter } from './routes/reactions';
import { createRouter as createGroupsRouter } from './routes/groups';
import { createRouter as createGroupContentRouter } from './routes/groupContent';
import { createRouter as createNotificationsRouter } from './routes/notifications';
import { createRouter as createUseritemsRouter } from './routes/useritems';
import { createRouter as createCompletionsRouter } from './routes/completions';
import { config } from './config';
import { createAppContext } from './context';
import { createUserActivityTracker } from './middleware/trackUserActivity';
import { createErrorHandler } from './middleware/errorHandler';
import { createRequestLogger } from './middleware/requestLogger';

const app = express();

// Security headers
app.use(helmet());

// CORS — use CORS_ORIGIN in production, localhost in dev
app.use(
  cors({
    origin:
      config.nodeEnv === 'production'
        ? (config.corsOrigin ? [config.corsOrigin] : [])
        : ['http://127.0.0.1:5173', 'http://localhost:5173'],
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Re-encode AT URIs that were decoded by the reverse proxy (e.g. Azure/Envoy).
// Proxies often decode %2F→/ in paths before forwarding, which breaks Express
// route params like /:listUri that expect the AT URI as a single path segment.
app.use((req, _res, next) => {
  const atUriPattern = /\/at:\/\//;
  if (atUriPattern.test(req.url)) {
    // Find the prefix (e.g. "/collections/") before the AT URI
    const atIndex = req.url.indexOf('/at://');
    const prefix = req.url.substring(0, atIndex + 1); // includes trailing /
    const rest = req.url.substring(atIndex + 1);      // "at://did:plc:.../collection/rkey..."

    // The rest may have a sub-path after the AT URI (e.g. "/items/at://...")
    // AT URIs have the form: at://did/collection/rkey
    // So we need to find where the AT URI ends
    const atParts = rest.split('/');
    // at: '' did collection rkey = indices 0,1,2,3,4
    // Reconstruct: "at://did/collection/rkey"
    const atUri = atParts.slice(0, 5).join('/');
    const suffix = atParts.length > 5 ? '/' + atParts.slice(5).join('/') : '';

    // Check if the suffix also contains an AT URI (e.g. /items/at://...)
    let encodedSuffix = suffix;
    if (atUriPattern.test(suffix)) {
      const innerAtIndex = suffix.indexOf('/at://');
      const suffixPrefix = suffix.substring(0, innerAtIndex + 1);
      const innerRest = suffix.substring(innerAtIndex + 1);
      const innerParts = innerRest.split('/');
      const innerAtUri = innerParts.slice(0, 5).join('/');
      const innerSuffix = innerParts.length > 5 ? '/' + innerParts.slice(5).join('/') : '';
      encodedSuffix = suffixPrefix + encodeURIComponent(innerAtUri) + innerSuffix;
    }

    req.url = prefix + encodeURIComponent(atUri) + encodedSuffix;
  }
  next();
});

// Health check — available before context initialization
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Initialize app context and routes
createAppContext().then((ctx) => {
  // Request logging with correlation IDs
  app.use(createRequestLogger(ctx));

  // User activity tracking
  app.use(createUserActivityTracker(ctx));

  // Mount routes
  app.use(createAuthRouter(ctx));
  app.use('/users', createUserRouter(ctx));
  app.use('/collections', createCollectionsRouter(ctx));
  app.use('/media', createMediaRouter(ctx));
  app.use('/admin', createAdminRouter(ctx));
  app.use('/feedback', createFeedbackRouter(ctx));
  app.use('/feed', createFeedRouter(ctx));
  app.use('/share', createShareRouter(ctx));
  app.use('/reviewsegments', createReviewSegmentsRouter(ctx));
  createTagsRouter(ctx, app);
  app.use('/comments', createCommentsRouter(ctx));
  app.use('/reactions', createReactionsRouter(ctx));
  app.use('/groups', createGroupsRouter(ctx));
  app.use('/groups/:communityDid', createGroupContentRouter(ctx));
  app.use('/notifications', createNotificationsRouter(ctx));
  app.use('/useritems', createUseritemsRouter(ctx));
  app.use('/completions', createCompletionsRouter(ctx));

  // Root route
  app.get('/', (_req, res) => {
    res.redirect(config.clientUrl || 'http://127.0.0.1:5173');
  });

  // Global error handler (must be last middleware)
  app.use(createErrorHandler(ctx));

  const server = app.listen(config.port, () => {
    ctx.logger.info(
      { port: config.port },
      `Server running on port ${config.port}`
    );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
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
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
