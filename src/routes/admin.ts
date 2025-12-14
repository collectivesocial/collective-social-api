import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import { Agent } from '@atproto/api';
import { fetchUserHandles } from '../lib/users';

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

        // Get admin agent for fetching user handles
        const sessionDid = await getSessionAgent(req, res, ctx);
        let userHandles = new Map<string, string>();

        if (sessionDid) {
          try {
            const oauthSession = await ctx.oauthClient.restore(sessionDid);
            if (oauthSession) {
              const adminAgent = new Agent(oauthSession);

              // Fetch user handles
              const userDids = users.map((user) => user.did);
              userHandles = await fetchUserHandles(
                adminAgent,
                userDids,
                ctx.logger
              );
            }
          } catch (err) {
            ctx.logger.error(
              { err },
              'Failed to create admin agent for handle lookup'
            );
          }
        }

        // Map handles to users
        const usersWithHandles = users.map((user) => ({
          did: user.did,
          handle: userHandles.get(user.did) || null,
          firstLoginAt: user.firstLoginAt,
          lastActivityAt: user.lastActivityAt,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
        }));

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

      const page = parseInt((req.query.page as string) || '1');
      const limit = parseInt((req.query.limit as string) || '20');
      const offset = (page - 1) * limit;

      try {
        // Get total count
        const countResult = await ctx.db
          .selectFrom('media_items')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();

        const totalMediaItems = Number(countResult?.count || 0);

        // Get paginated media items
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
          .limit(limit)
          .offset(offset)
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
            'share_links.collectionUri',
            'share_links.reviewId',
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

        // Get admin agent for fetching user handles and collection names
        const sessionDid = await getSessionAgent(req, res, ctx);
        let userHandles = new Map<string, string>();
        let adminAgentForCollections: Agent | null = null;

        if (sessionDid) {
          try {
            const oauthSession = await ctx.oauthClient.restore(sessionDid);
            if (oauthSession) {
              const adminAgent = new Agent(oauthSession);
              adminAgentForCollections = adminAgent;

              // Fetch user handles
              const uniqueUserDids = [
                ...new Set(shareLinks.map((link) => link.userDid)),
              ];
              userHandles = await fetchUserHandles(
                adminAgent,
                uniqueUserDids,
                ctx.logger
              );
            }
          } catch (err) {
            ctx.logger.error(
              { err },
              'Failed to create admin agent for handle lookup'
            );
          }
        }

        // For review shares, fetch the media item titles
        const reviewIds = shareLinks
          .filter((link) => link.reviewId)
          .map((link) => link.reviewId!);

        const reviewTitles = new Map<number, string>();
        if (reviewIds.length > 0) {
          const reviews = await ctx.db
            .selectFrom('reviews')
            .innerJoin('media_items', 'reviews.mediaItemId', 'media_items.id')
            .select(['reviews.id', 'media_items.title'])
            .where('reviews.id', 'in', reviewIds)
            .execute();

          reviews.forEach((review) => {
            if (review.title) {
              reviewTitles.set(review.id, review.title);
            }
          });
        }

        // For each link with collectionUri, we need to fetch collection names from users' ATProto repos
        // Group links by userDid to minimize API calls
        const linksByUser = shareLinks.reduce(
          (acc, link) => {
            if (link.collectionUri) {
              const userDid = link.userDid;
              if (!acc[userDid]) acc[userDid] = [];
              acc[userDid].push(link);
            }
            return acc;
          },
          {} as Record<string, typeof shareLinks>
        );

        // Fetch collection names for each user
        const collectionNames: Record<string, string> = {};

        // Use the admin agent we created earlier to fetch collection names
        if (adminAgentForCollections) {
          for (const [userDid, userLinks] of Object.entries(linksByUser)) {
            try {
              // Use the admin's agent to query other users' public collection data
              const listsResponse =
                await adminAgentForCollections.api.com.atproto.repo.listRecords(
                  {
                    repo: userDid,
                    collection: 'app.collectivesocial.feed.list',
                  }
                );

              for (const link of userLinks) {
                const collection = listsResponse.data.records.find(
                  (record: any) => record.uri === link.collectionUri
                );
                if (collection && collection.value?.name) {
                  collectionNames[link.collectionUri!] =
                    String(collection.value.name) || 'Untitled Collection';
                }
              }
            } catch (err) {
              ctx.logger.error(
                { err, userDid },
                'Failed to fetch collection names for admin view'
              );
            }
          }
        }

        res.json({
          totalLinks,
          page,
          limit,
          totalPages: Math.ceil(totalLinks / limit),
          sortBy,
          order,
          links: shareLinks.map((link) => {
            // Format title with "Review: " prefix for review shares
            let title = link.title;
            if (link.reviewId && title) {
              title = `Review: ${title}`;
            } else if (link.reviewId) {
              const reviewTitle = reviewTitles.get(link.reviewId);
              if (reviewTitle) {
                title = `Review: ${reviewTitle}`;
              }
            }

            const userHandle = userHandles.get(link.userDid) || null;

            return {
              id: link.id,
              shortCode: link.shortCode,
              userDid: link.userDid,
              userHandle: userHandle,
              mediaItemId: link.mediaItemId,
              mediaType: link.mediaType,
              collectionUri: link.collectionUri,
              collectionName: link.collectionUri
                ? collectionNames[link.collectionUri] || null
                : null,
              reviewId: link.reviewId,
              timesClicked: link.timesClicked,
              createdAt: link.createdAt,
              updatedAt: link.updatedAt,
              title: title,
              creator: link.creator,
              coverImage: link.coverImage,
              url: `${origin}/share/${link.shortCode}`,
            };
          }),
        });
      } catch (err) {
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
