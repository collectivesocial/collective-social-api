import express from 'express';
import cors from 'cors';
import { createRouter as createUserRouter } from './routes/user';
import { createRouter as createAuthRouter } from './routes/auth';
import { createRouter as createCollectionsRouter } from './routes/collections';
import { createRouter as createMediaRouter } from './routes/media';
import { createRouter as createAdminRouter } from './routes/admin';
import { createRouter as createFeedbackRouter } from './routes/feedback';
import { createRouter as createFeedRouter } from './routes/feed';
import { config } from './config';
import { createAppContext } from './context';
import { createUserActivityTracker } from './middleware/trackUserActivity';

const app = express();

// Enable CORS for your React app
app.use(
  cors({
    origin: 'http://127.0.0.1:5173', // Vite default port
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize app context and routes
createAppContext().then((ctx) => {
  // Add user activity tracking middleware
  app.use(createUserActivityTracker(ctx));

  // Mount auth routes
  app.use(createAuthRouter(ctx));

  // Mount user routes
  app.use('/users', createUserRouter(ctx));

  // Mount collections routes
  app.use('/collections', createCollectionsRouter(ctx));

  // Mount media routes
  app.use('/media', createMediaRouter(ctx));

  // Mount admin routes
  app.use('/admin', createAdminRouter(ctx));

  // Mount feedback routes
  app.use('/feedback', createFeedbackRouter(ctx));

  // Mount feed routes
  app.use('/feed', createFeedRouter(ctx));

  // Root route - redirect to React app
  app.get('/', (req, res) => {
    const reactAppUrl =
      config.nodeEnv === 'production'
        ? config.serviceUrl || 'http://127.0.0.1:5173'
        : 'http://127.0.0.1:5173';
    res.redirect(reactAppUrl);
  });

  const PORT = config.port;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
