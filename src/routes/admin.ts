import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';

type Session = { did?: string };

// Helper function to get the authenticated user's session
async function getSessionAgent(
  req: express.Request,
  res: express.Response,
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

  return session.did || null;
}

// Middleware to check if user is admin
async function requireAdmin(
  req: express.Request,
  res: express.Response,
  ctx: AppContext
): Promise<boolean> {
  const did = await getSessionAgent(req, res, ctx);

  if (!did) {
    res.status(401).json({ error: 'Not authenticated' });
    return false;
  }

  const user = await ctx.db
    .selectFrom('users')
    .select(['isAdmin'])
    .where('did', '=', did)
    .executeTakeFirst();

  if (!user?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }

  return true;
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /admin/users - Get users list and count
  router.get(
    '/users',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      if (!(await requireAdmin(req, res, ctx))) {
        return;
      }

      try {
        // Get total count
        const countResult = await ctx.db
          .selectFrom('users')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();

        const totalUsers = Number(countResult?.count || 0);

        // Get first 10 users
        const users = await ctx.db
          .selectFrom('users')
          .select([
            'did',
            'firstLoginAt',
            'lastActivityAt',
            'isAdmin',
            'createdAt',
          ])
          .orderBy('firstLoginAt', 'desc')
          .limit(10)
          .execute();

        res.json({
          totalUsers,
          users: users.map((user) => ({
            did: user.did,
            firstLoginAt: user.firstLoginAt,
            lastActivityAt: user.lastActivityAt,
            isAdmin: user.isAdmin,
            createdAt: user.createdAt,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch admin users data');
        res.status(500).json({ error: 'Failed to fetch users data' });
      }
    })
  );

  // GET /admin/media - Get media items list and count
  router.get(
    '/media',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      if (!(await requireAdmin(req, res, ctx))) {
        return;
      }

      try {
        // Get total count
        const countResult = await ctx.db
          .selectFrom('media_items')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();

        const totalMediaItems = Number(countResult?.count || 0);

        // Get first 10 media items
        const mediaItems = await ctx.db
          .selectFrom('media_items')
          .select([
            'id',
            'mediaType',
            'title',
            'creator',
            'isbn',
            'totalReviews',
            'averageRating',
            'createdAt',
          ])
          .orderBy('createdAt', 'desc')
          .limit(10)
          .execute();

        res.json({
          totalMediaItems,
          mediaItems: mediaItems.map((item) => ({
            id: item.id,
            mediaType: item.mediaType,
            title: item.title,
            creator: item.creator,
            isbn: item.isbn,
            totalReviews: item.totalReviews,
            averageRating: item.averageRating
              ? parseFloat(item.averageRating.toString())
              : null,
            createdAt: item.createdAt,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch admin media data');
        res.status(500).json({ error: 'Failed to fetch media data' });
      }
    })
  );

  // GET /admin/check - Check if current user is admin
  router.get(
    '/check',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const did = await getSessionAgent(req, res, ctx);

      if (!did) {
        return res.json({ isAdmin: false });
      }

      const user = await ctx.db
        .selectFrom('users')
        .select(['isAdmin'])
        .where('did', '=', did)
        .executeTakeFirst();

      res.json({ isAdmin: user?.isAdmin || false });
    })
  );

  return router;
};
