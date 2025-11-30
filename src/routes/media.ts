import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import {
  searchBooks,
  getBookByISBN,
  extractISBN,
  getCoverUrl,
  extractDescription,
} from '../services/openlibrary';

type Session = { did?: string };

// Helper function to get the Atproto Agent for the active session
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
  if (!session.did) return null;

  res.setHeader('cache-control', 'private, no-store');

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    await session.destroy();
    return null;
  }
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // POST /media/search - Search for media items (books, etc.)
  router.post(
    '/search',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { query, mediaType } = req.body;

      if (!query || !mediaType) {
        return res
          .status(400)
          .json({ error: 'Query and mediaType are required' });
      }

      if (mediaType !== 'book') {
        return res
          .status(400)
          .json({ error: 'Only books are currently supported' });
      }

      try {
        // Search OpenLibrary
        const results = await searchBooks(query);

        // For each result, check if it exists in our database
        const enrichedResults = (
          await Promise.all(
            results.map(async (result) => {
              const isbn = extractISBN(result);
              if (!isbn) return null;
              let dbItem = null;

              // Check database if we have an ISBN
              if (isbn) {
                dbItem = await ctx.db
                  .selectFrom('media_items')
                  .selectAll()
                  .where('isbn', '=', isbn)
                  .where('mediaType', '=', 'book')
                  .executeTakeFirst();
              }

              return {
                title: result.title,
                author: result.author_name?.[0] || null,
                publishYear: result.first_publish_year || null,
                isbn: isbn || null,
                coverImage: result.cover_i
                  ? getCoverUrl(result.cover_i, 'M')
                  : null,
                // Include database info if exists
                inDatabase: !!dbItem,
                totalReviews: dbItem?.totalReviews || 0,
                averageRating: dbItem?.averageRating
                  ? parseFloat(dbItem.averageRating.toString())
                  : null,
                mediaItemId: dbItem?.id || null,
              };
            })
          )
        ).filter((item): item is NonNullable<typeof item> => item !== null);

        res.json({
          results: enrichedResults,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to search media');
        res.status(500).json({ error: 'Failed to search media' });
      }
    })
  );

  // POST /media/add - Add a media item to database (called when adding to collection)
  router.post(
    '/add',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { title, creator, mediaType, isbn, coverImage, publishYear } =
        req.body;

      if (!title || !mediaType) {
        return res
          .status(400)
          .json({ error: 'Title and mediaType are required' });
      }

      try {
        // Check if item already exists (by ISBN for books)
        let existingItem = null;
        if (isbn && mediaType === 'book') {
          existingItem = await ctx.db
            .selectFrom('media_items')
            .selectAll()
            .where('isbn', '=', isbn)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();
        }

        if (existingItem) {
          return res.json({
            mediaItemId: existingItem.id,
            existed: true,
          });
        }

        // Fetch additional details from OpenLibrary if we have ISBN
        let description = null;
        if (isbn && mediaType === 'book') {
          const bookDetails = await getBookByISBN(isbn);
          if (bookDetails) {
            description = extractDescription(bookDetails);
          }
        }

        // Insert new media item
        const result = await ctx.db
          .insertInto('media_items')
          .values({
            mediaType,
            title,
            creator: creator || undefined,
            isbn: isbn || undefined,
            coverImage: coverImage || undefined,
            description: description || undefined,
            publishedYear: publishYear || undefined,
            totalReviews: 0,
            averageRating: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();

        res.json({
          mediaItemId: result.id,
          existed: false,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to add media item');
        res.status(500).json({ error: 'Failed to add media item' });
      }
    })
  );

  // GET /media/:id - Get media item details
  router.get(
    '/:id',
    handler(async (req: Request, res: Response) => {
      const { id } = req.params;

      try {
        const item = await ctx.db
          .selectFrom('media_items')
          .selectAll()
          .where('id', '=', parseInt(id))
          .executeTakeFirst();

        if (!item) {
          return res.status(404).json({ error: 'Media item not found' });
        }

        res.json({
          id: item.id,
          mediaType: item.mediaType,
          title: item.title,
          creator: item.creator,
          isbn: item.isbn,
          coverImage: item.coverImage,
          description: item.description,
          publishedYear: item.publishedYear,
          totalRatings: item.totalRatings,
          totalReviews: item.totalReviews,
          totalSaves: item.totalSaves,
          averageRating: item.averageRating
            ? parseFloat(item.averageRating.toString())
            : null,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch media item');
        res.status(500).json({ error: 'Failed to fetch media item' });
      }
    })
  );

  // GET /media/:id/reviews - Get reviews for a media item
  router.get(
    '/:id/reviews',
    handler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      try {
        // Get reviews from database
        const reviews = await ctx.db
          .selectFrom('reviews')
          .selectAll()
          .where('mediaItemId', '=', parseInt(id))
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .offset(offset)
          .execute();

        // Fetch user profiles for each review author
        const reviewsWithProfiles = await Promise.all(
          reviews.map(async (review) => {
            try {
              const response = await fetch(
                `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${review.authorDid}`
              );
              const profile = (await response.json()) as any;

              return {
                id: review.id,
                authorDid: review.authorDid,
                authorHandle: profile.handle,
                authorDisplayName: profile.displayName || profile.handle,
                authorAvatar: profile.avatar || null,
                rating: parseFloat(review.rating.toString()),
                review: review.review,
                reviewUri: review.reviewUri,
                listItemUri: review.listItemUri,
                createdAt: review.createdAt,
                updatedAt: review.updatedAt,
              };
            } catch (err) {
              ctx.logger.error(
                { err, did: review.authorDid },
                'Failed to fetch profile for review author'
              );
              return {
                id: review.id,
                authorDid: review.authorDid,
                authorHandle: review.authorDid,
                authorDisplayName: review.authorDid,
                authorAvatar: null,
                rating: parseFloat(review.rating.toString()),
                review: review.review,
                reviewUri: review.reviewUri,
                listItemUri: review.listItemUri,
                createdAt: review.createdAt,
                updatedAt: review.updatedAt,
              };
            }
          })
        );

        res.json({
          reviews: reviewsWithProfiles,
          hasMore: reviews.length === limit,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch reviews');
        res.status(500).json({ error: 'Failed to fetch reviews' });
      }
    })
  );

  return router;
};
