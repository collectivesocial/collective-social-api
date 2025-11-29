import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /feed/events - Get recent feed events
  router.get(
    '/events',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'public, max-age=30');

      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const events = await ctx.db
          .selectFrom('feed_events')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .offset(offset)
          .execute();

        res.json({
          events,
          limit,
          offset,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch feed events');
        res.status(500).json({ error: 'Failed to fetch feed events' });
      }
    })
  );

  return router;
};
