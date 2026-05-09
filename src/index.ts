import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createRouter as createUserRouter } from './routes/user';
import { createRouter as createAuthRouter } from './routes/auth';
import { createRouter as createCollectionsRouter } from './routes/collections';
import { createRouter as createMediaRouter } from './routes/media';
import { createRouter as createAdminRouter } from './routes/admin';
import { createRouter as createAnalyticsRouter } from './routes/analytics';
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
import { createRouter as createGoalsRouter } from './routes/goals';
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
        ? config.corsOrigin
          ? [config.corsOrigin]
          : []
        : ['http://127.0.0.1:5173', 'http://localhost:5173'],
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Re-encode AT URIs that were decoded by the reverse proxy (e.g. Azure/Envoy).
// Proxies often decode %2F→/ in paths before forwarding, which breaks Express
// route params like /:listUri that expect the AT URI as a single path segment.
// The AT URI may appear as:
//   /at://did/collection/rkey   — proxy decoded %2F to /
//   /at:/did/collection/rkey    — proxy decoded %2F and path-normalised // to /
//   /at%3A//did/collection/rkey — proxy left %3A but decoded %2F
//   /at%3A/did/collection/rkey  — proxy decoded %2F and path-normalised //
app.use((req, _res, next) => {
  // Match "at://" or "at:/" or "at%3A//" or "at%3A/" followed by a DID-like segment
  const atUriRe = /\/at(?:%3A|:)\/\//i;
  const atUriSingleSlashRe = /\/at(?:%3A|:)\/(?!\/)/i;

  if (atUriRe.test(req.url) || atUriSingleSlashRe.test(req.url)) {
    // Normalise: find the AT URI start and rebuild it properly
    const match = req.url.match(/\/at(?:%3A|:)\/{1,2}/i);
    if (match && match.index !== undefined) {
      const prefix = req.url.substring(0, match.index + 1); // e.g. "/collections/"
      const afterAt = req.url.substring(match.index + match[0].length); // "did:plc:.../collection/rkey/items..."

      // AT URIs have the form: at://did/collection/rkey  (3 segments after "at://")
      const segments = afterAt.split('/');
      // segments[0] = did (may be percent-encoded, e.g. did%3Aplc%3Axxx)
      // segments[1] = collection
      // segments[2] = rkey
      // segments[3+] = rest of URL path (e.g. "items", "items/at%3A...")
      if (segments.length >= 3) {
        const did = decodeURIComponent(segments[0]);
        const collection = decodeURIComponent(segments[1]);
        const rkey = decodeURIComponent(segments[2]);
        const atUri = `at://${did}/${collection}/${rkey}`;
        const suffix =
          segments.length > 3 ? '/' + segments.slice(3).join('/') : '';

        // Recursively handle a second AT URI in the suffix (e.g. /items/:itemUri)
        let processedSuffix = suffix;
        const innerMatch = suffix.match(/\/at(?:%3A|:)\/{1,2}/i);
        if (innerMatch && innerMatch.index !== undefined) {
          const sPre = suffix.substring(0, innerMatch.index + 1);
          const sAfterAt = suffix.substring(
            innerMatch.index + innerMatch[0].length
          );
          const innerSegs = sAfterAt.split('/');
          if (innerSegs.length >= 3) {
            const iDid = decodeURIComponent(innerSegs[0]);
            const iCol = decodeURIComponent(innerSegs[1]);
            const iRkey = decodeURIComponent(innerSegs[2]);
            const innerAtUri = `at://${iDid}/${iCol}/${iRkey}`;
            const iSuffix =
              innerSegs.length > 3 ? '/' + innerSegs.slice(3).join('/') : '';
            processedSuffix = sPre + encodeURIComponent(innerAtUri) + iSuffix;
          }
        }

        req.url = prefix + encodeURIComponent(atUri) + processedSuffix;
      }
    }
  }
  next();
});

// Health check — available before context initialization
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// CIMD document — serves the public key for HTTP Message Signatures verification
app.get('/.well-known/client-metadata.json', async (_req, res) => {
  try {
    if (!config.openSocialSigningKey) {
      return res.status(404).json({ error: 'CIMD not configured' });
    }
    const { publicKeyToJwk } = await import('./lib/httpSigning');
    const jwk = publicKeyToJwk(
      config.openSocialSigningKey,
      (config.openSocialKeyAlgorithm || 'ed25519') as any
    );
    res.json({
      client_id: config.serviceUrl || `http://localhost:${config.port}`,
      client_name: 'Collective Social',
      jwks: { keys: [jwk] },
    });
  } catch {
    res.status(500).json({ error: 'Failed to generate CIMD document' });
  }
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
  app.use('/analytics', createAnalyticsRouter(ctx));
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
  app.use('/goals', createGoalsRouter(ctx));

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
