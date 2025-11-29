import express, { Request, Response } from 'express';
import { getUserByHandle } from '../models/user';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /users/me - Get current authenticated user profile
  router.get(
    '/me',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const profile = await agent.getProfile({ actor: agent.did! });
        res.json({
          did: profile.data.did,
          handle: profile.data.handle,
          displayName: profile.data.displayName,
          avatar: profile.data.avatar,
          description: profile.data.description,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch profile');
        res.status(500).json({ error: 'Failed to fetch profile' });
      }
    })
  );

  // GET /users/:handle - Get a user by handle
  router.get('/:handle', async (req: Request, res: Response) => {
    try {
      const user = await getUserByHandle(req.params.handle);
      if (user) {
        res.json(user);
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
};
