import { Agent } from '@atproto/api';
import { OAuthResolverError } from '@atproto/oauth-client-node';
import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';
import path from 'node:path';

import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import { ifString } from '../lib/stringUtil';

// Max age, in seconds, for static routes and assets
const MAX_AGE = config.nodeEnv === 'production' ? 60 : 300;

type Session = { did?: string };

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext
) {
  res.setHeader('Vary', 'Cookie');

  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: config.cookieSecret,
    cookieOptions: {
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      httpOnly: true,
      path: '/',
    },
  });
  if (!session.did) return null;

  // This page is dynamic and should not be cached publicly
  res.setHeader('cache-control', `max-age=${MAX_AGE}, private`);

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed');
    await session.destroy();
    return null;
  }
}

export const createRouter = (ctx: AppContext): RequestListener => {
  const router = express();

  // Static assets
  router.use(
    '/public',
    express.static(path.join(__dirname, 'pages', 'public'), {
      maxAge: MAX_AGE * 1000,
    })
  );

  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((req: Request, res: Response) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);
      res.json(ctx.oauthClient.clientMetadata);
    })
  );

  // Public keys
  router.get(
    '/.well-known/jwks.json',
    handler((req: Request, res: Response) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);
      res.json(ctx.oauthClient.jwks);
    })
  );

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      console.log('OAuth callback invoked');

      const params = new URLSearchParams(req.originalUrl.split('?')[1]);
      try {
        // Load the session cookie
        const session = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: config.cookieSecret,
          cookieOptions: {
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            httpOnly: true,
            path: '/',
          },
        });
        console.log({ session });

        // If the user is already signed in, destroy the old credentials
        if (session.did) {
          try {
            const oauthSession = await ctx.oauthClient.restore(session.did);
            if (oauthSession) oauthSession.signOut();
          } catch (err) {
            ctx.logger.warn({ err }, 'oauth restore failed');
          }
        }

        // Complete the OAuth flow
        const oauth = await ctx.oauthClient.callback(params);

        // Update the session cookie
        session.did = oauth.session.did;

        await session.save();
      } catch (err) {
        ctx.logger.error({ err }, 'oauth callback failed');
      }

      // Redirect back to the React app
      const redirectUrl =
        config.nodeEnv === 'production'
          ? config.serviceUrl || 'http://127.0.0.1:5173'
          : 'http://127.0.0.1:5173';
      return res.redirect(redirectUrl);
    })
  );

  // Login handler
  router.post(
    '/login',
    express.urlencoded(),
    handler(async (req: Request, res: Response) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store');

      // Initiate the OAuth flow
      try {
        // Validate input: can be a handle, a DID or a service URL (PDS).
        const input = ifString(req.body.input);
        if (!input) {
          throw new Error('Invalid input');
        }

        // Initiate the OAuth flow
        const url = await ctx.oauthClient.authorize(input, {
          scope: 'atproto transition:generic',
        });

        res.redirect(url.toString());
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed');

        const error = err instanceof Error ? err.message : 'unexpected error';

        return res.type('json').send({ error });
      }
    })
  );

  // Signup
  router.get(
    '/signup',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);

      try {
        const service = config.pdsUrl;
        const url = await ctx.oauthClient.authorize(service, {
          scope: 'atproto transition:generic',
        });
        res.redirect(url.toString());
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed');
        res.type('json').send({
          error:
            err instanceof OAuthResolverError
              ? err.message
              : "couldn't initiate login",
        });
      }
    })
  );

  // Logout handler
  router.post(
    '/logout',
    handler(async (req: Request, res: Response) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store');

      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: config.cookieSecret,
        cookieOptions: {
          secure: config.nodeEnv === 'production',
          sameSite: 'lax',
          httpOnly: true,
          path: '/',
        },
      });

      // Revoke credentials on the server
      if (session.did) {
        try {
          const oauthSession = await ctx.oauthClient.restore(session.did);
          if (oauthSession) await oauthSession.signOut();
        } catch (err) {
          ctx.logger.warn({ err }, 'Failed to revoke credentials');
        }
      }

      session.destroy();

      return res.redirect('/');
    })
  );

  return router;
};
