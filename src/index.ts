import express from 'express';
import cors from 'cors';
import { createRouter as createUserRouter } from './routes/user';
import { createRouter as createAuthRouter } from './routes/auth';
import { config } from './config';
import { createAppContext } from './context';

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
  // Mount auth routes
  app.use(createAuthRouter(ctx));

  // Mount user routes
  app.use('/users', createUserRouter(ctx));

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
