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

        // Fetch handles for each user
        const usersWithHandles = await Promise.all(
          users.map(async (user) => {
            try {
              const response = await fetch(
                `https://public.api.bsky.app/xrpc/com.atproto.repo.describeRepo?repo=${user.did}`
              );
              if (response.ok) {
                const data = (await response.json()) as any;
                return {
                  did: user.did,
                  handle: data.handle || null,
                  firstLoginAt: user.firstLoginAt,
                  lastActivityAt: user.lastActivityAt,
                  isAdmin: user.isAdmin,
                  createdAt: user.createdAt,
                };
              }
            } catch (err) {
              ctx.logger.error(
                { err, did: user.did },
                'Failed to fetch handle for user'
              );
            }
            return {
              did: user.did,
              handle: null,
              firstLoginAt: user.firstLoginAt,
              lastActivityAt: user.lastActivityAt,
              isAdmin: user.isAdmin,
              createdAt: user.createdAt,
            };
          })
        );

        res.json({
          totalUsers,
          users: usersWithHandles,
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
            'totalRatings',
            'totalReviews',
            'totalSaves',
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
            totalRatings: item.totalRatings,
            totalReviews: item.totalReviews,
            totalSaves: item.totalSaves,
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

  // GET /admin/share-links - Get share links list with pagination and sorting
  router.get(
    '/share-links',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      if (!(await requireAdmin(req, res, ctx))) {
        return;
      }

      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const sortBy = (req.query.sortBy as string) || 'timesClicked'; // 'timesClicked' or 'createdAt'
        const order = (req.query.order as string) || 'desc'; // 'asc' or 'desc'
        const offset = (page - 1) * limit;

        // Get total count
        const countResult = await ctx.db
          .selectFrom('share_links')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();

        const totalLinks = Number(countResult?.count || 0);

        // Build query with sorting
        let query = ctx.db
          .selectFrom('share_links')
          .leftJoin('media_items', 'share_links.mediaItemId', 'media_items.id')
          .select([
            'share_links.id',
            'share_links.shortCode',
            'share_links.userDid',
            'share_links.mediaItemId',
            'share_links.mediaType',
            'share_links.timesClicked',
            'share_links.createdAt',
            'share_links.updatedAt',
            'media_items.title',
            'media_items.creator',
            'media_items.coverImage',
          ]);

        // Apply sorting
        if (sortBy === 'timesClicked') {
          query = query.orderBy(
            'share_links.timesClicked',
            order === 'asc' ? 'asc' : 'desc'
          );
        } else {
          query = query.orderBy(
            'share_links.createdAt',
            order === 'asc' ? 'asc' : 'desc'
          );
        }

        // Apply pagination
        const shareLinks = await query.limit(limit).offset(offset).execute();

        // Get origin for building full URLs
        const origin = req.get('origin') || 'http://127.0.0.1:5173';

        res.json({
          totalLinks,
          page,
          limit,
          totalPages: Math.ceil(totalLinks / limit),
          sortBy,
          order,
          links: shareLinks.map((link) => ({
            id: link.id,
            shortCode: link.shortCode,
            userDid: link.userDid,
            mediaItemId: link.mediaItemId,
            mediaType: link.mediaType,
            timesClicked: link.timesClicked,
            createdAt: link.createdAt,
            updatedAt: link.updatedAt,
            title: link.title,
            creator: link.creator,
            coverImage: link.coverImage,
            url: `${origin}/share/${link.shortCode}`,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch admin share links data');
        res.status(500).json({ error: 'Failed to fetch share links data' });
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
