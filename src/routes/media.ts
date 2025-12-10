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
import {
  normalizeUrl,
  fetchUrlMetadata,
  detectMediaTypeFromUrl,
} from '../services/urlMetadata';
import { searchOMDB, extractRuntime } from '../services/omdb';

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

  // GET /media/recent - Get recently added media items
  router.get(
    '/recent',
    handler(async (req: Request, res: Response) => {
      const { limit = 6 } = req.query;

      try {
        const items = await ctx.db
          .selectFrom('media_items')
          .select([
            'id',
            'mediaType',
            'title',
            'creator',
            'coverImage',
            'publishedYear',
            'averageRating',
            'totalReviews',
            'totalRatings',
            'createdAt',
          ])
          .orderBy('createdAt', 'desc')
          .limit(parseInt(limit as string))
          .execute();

        res.json({
          items: items.map((item) => ({
            id: item.id,
            mediaType: item.mediaType,
            title: item.title,
            creator: item.creator,
            coverImage: item.coverImage,
            publishedYear: item.publishedYear,
            averageRating: item.averageRating
              ? parseFloat(item.averageRating.toString())
              : null,
            totalReviews: item.totalReviews,
            totalRatings: item.totalRatings,
            createdAt: item.createdAt,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch recent media items');
        res.status(500).json({ error: 'Failed to fetch recent media items' });
      }
    })
  );

  // POST /media/search - Search for media items (books, etc.)
  router.post(
    '/search',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { query, mediaType, limit = 10, offset = 0 } = req.body;

      if (!query || !mediaType) {
        return res
          .status(400)
          .json({ error: 'Query and mediaType are required' });
      }

      try {
        let enrichedResults: any[] = [];
        let total = 0;

        // Handle different media types
        if (mediaType === 'book') {
          // Search OpenLibrary with pagination
          const searchResponse = await searchBooks(query, limit, offset);

          // For each result, check if it exists in our database
          enrichedResults = (
            await Promise.all(
              searchResponse.results.map(async (result) => {
                const isbn = extractISBN(result);
                const author = result.author_name?.[0] || null;
                let dbItem = null;

                // Check database - first by ISBN if available
                if (isbn) {
                  dbItem = await ctx.db
                    .selectFrom('media_items')
                    .selectAll()
                    .where('isbn', '=', isbn)
                    .where('mediaType', '=', 'book')
                    .executeTakeFirst();
                }

                // If no ISBN or no match found, try matching by title and creator
                if (!dbItem && result.title && author) {
                  dbItem = await ctx.db
                    .selectFrom('media_items')
                    .selectAll()
                    .where('title', '=', result.title)
                    .where('creator', '=', author)
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
                  pages: result.number_of_pages || null,
                  // Include database info if exists
                  inDatabase: !!dbItem,
                  totalReviews: dbItem?.totalReviews || 0,
                  totalRatings: dbItem?.totalRatings || 0,
                  averageRating: dbItem?.averageRating
                    ? parseFloat(dbItem.averageRating.toString())
                    : null,
                  mediaItemId: dbItem?.id || null,
                };
              })
            )
          ).filter((item): item is NonNullable<typeof item> => item !== null);

          total = searchResponse.total;
        } else if (mediaType === 'movie' || mediaType === 'tv') {
          // Search OMDB
          const omdbType = mediaType === 'movie' ? 'movie' : 'series';
          const searchResponse = await searchOMDB(query, omdbType, limit);

          // For each result, check if it exists in our database
          enrichedResults = await Promise.all(
            searchResponse.results.map(async (result) => {
              let dbItem = null;

              // Check database by externalId (IMDB ID)
              if (result.imdbId) {
                dbItem = await ctx.db
                  .selectFrom('media_items')
                  .selectAll()
                  .where('externalId', '=', result.imdbId)
                  .where('mediaType', '=', mediaType)
                  .executeTakeFirst();
              }

              // If no match found, try matching by title and year
              if (!dbItem && result.title && result.year) {
                dbItem = await ctx.db
                  .selectFrom('media_items')
                  .selectAll()
                  .where('title', '=', result.title)
                  .where('publishedYear', '=', result.year)
                  .where('mediaType', '=', mediaType)
                  .executeTakeFirst();
              }

              return {
                title: result.title,
                author: result.director,
                publishYear: result.year,
                isbn: null,
                coverImage: result.coverImage,
                pages: null,
                imdbId: result.imdbId,
                // Include database info if exists
                inDatabase: !!dbItem,
                totalReviews: dbItem?.totalReviews || 0,
                totalRatings: dbItem?.totalRatings || 0,
                averageRating: dbItem?.averageRating
                  ? parseFloat(dbItem.averageRating.toString())
                  : null,
                mediaItemId: dbItem?.id || null,
              };
            })
          );

          total = searchResponse.total;
        } else {
          return res
            .status(400)
            .json({ error: 'Unsupported media type for search' });
        }

        res.json({
          results: enrichedResults,
          total: total,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to search media');
        res.status(500).json({ error: 'Failed to search media' });
      }
    })
  );

  // POST /media/link - Fetch metadata from URL and add/find media item
  router.post(
    '/link',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { url, mediaType } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      if (
        mediaType &&
        mediaType !== 'article' &&
        mediaType !== 'video' &&
        mediaType !== 'course'
      ) {
        return res
          .status(400)
          .json({ error: 'Media type must be article, video, or course' });
      }

      // Normalize URL (remove query params)
      const normalizedUrl = normalizeUrl(url);

      // Check if item already exists by URL
      let existingItem = await ctx.db
        .selectFrom('media_items')
        .selectAll()
        .where('url', '=', normalizedUrl)
        .executeTakeFirst();

      if (existingItem) {
        return res.json({
          title: existingItem.title,
          author: existingItem.creator,
          publishYear: existingItem.publishedYear,
          isbn: null,
          coverImage: existingItem.coverImage,
          inDatabase: true,
          totalRatings: existingItem.totalRatings,
          totalReviews: existingItem.totalReviews,
          averageRating: existingItem.averageRating
            ? parseFloat(existingItem.averageRating.toString())
            : null,
          mediaItemId: existingItem.id,
          url: existingItem.url,
        });
      }

      // Fetch metadata from URL
      const metadata = await fetchUrlMetadata(url);

      if (!metadata.title) {
        return res
          .status(400)
          .json({ error: 'Could not extract title from URL' });
      }

      // Detect media type if not provided
      const detectedType = mediaType || detectMediaTypeFromUrl(url);

      // Return metadata for frontend to display
      res.json({
        title: metadata.title,
        author: metadata.author || metadata.siteName,
        publishYear: null,
        isbn: null,
        coverImage: metadata.image,
        inDatabase: false,
        totalRatings: 0,
        totalReviews: 0,
        averageRating: null,
        mediaItemId: null,
        url: normalizedUrl,
        mediaType: detectedType,
      });
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

      const {
        title,
        creator,
        mediaType,
        isbn,
        coverImage,
        publishYear,
        url,
        length,
        imdbId,
      } = req.body;

      if (!title || !mediaType) {
        return res
          .status(400)
          .json({ error: 'Title and mediaType are required' });
      }

      try {
        // Check if item already exists
        let existingItem = null;

        // First try by URL if available (for articles, videos, and courses)
        if (
          url &&
          (mediaType === 'article' ||
            mediaType === 'video' ||
            mediaType === 'course')
        ) {
          existingItem = await ctx.db
            .selectFrom('media_items')
            .selectAll()
            .where('url', '=', url)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();
        }

        // Try by ISBN if available (for books)
        if (!existingItem && isbn && mediaType === 'book') {
          existingItem = await ctx.db
            .selectFrom('media_items')
            .selectAll()
            .where('isbn', '=', isbn)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();
        }

        // Try by IMDB ID if available (for movies and TV shows)
        if (
          !existingItem &&
          imdbId &&
          (mediaType === 'movie' || mediaType === 'tv')
        ) {
          existingItem = await ctx.db
            .selectFrom('media_items')
            .selectAll()
            .where('externalId', '=', imdbId)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();
        }

        // If no ISBN/URL or no match, try by title and creator (requires both)
        if (!existingItem && title && creator) {
          existingItem = await ctx.db
            .selectFrom('media_items')
            .selectAll()
            .where('title', '=', title)
            .where('creator', '=', creator)
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
        let pageCount = length;
        let runtime = length;
        let finalCreator = creator;
        let finalCoverImage = coverImage;
        let finalPublishYear = publishYear;

        if (isbn && mediaType === 'book') {
          const bookDetails = await getBookByISBN(isbn);
          if (bookDetails) {
            description = extractDescription(bookDetails);
            // Use book details page count if not provided
            if (!pageCount && bookDetails.number_of_pages) {
              pageCount = bookDetails.number_of_pages;
            }
          }
        }

        // Fetch additional details from OMDB if we have IMDB ID
        if (imdbId && (mediaType === 'movie' || mediaType === 'tv')) {
          const { getOMDBDetails, getTotalEpisodes } =
            await import('../services/omdb');
          const details = await getOMDBDetails(imdbId);
          if (details) {
            description = details.Plot !== 'N/A' ? details.Plot : null;
            finalCreator =
              details.Director !== 'N/A' ? details.Director : creator;
            finalCoverImage =
              details.Poster !== 'N/A' ? details.Poster : coverImage;
            finalPublishYear = details.Year
              ? parseInt(details.Year)
              : publishYear;
            // Extract runtime in minutes for movies
            if (mediaType === 'movie' && !runtime && details.Runtime) {
              runtime = extractRuntime(details.Runtime);
            }
            // Get total episodes for TV series
            if (mediaType === 'tv' && !runtime) {
              runtime = await getTotalEpisodes(imdbId);
            }
          }
        }

        // Insert new media item
        const result = await ctx.db
          .insertInto('media_items')
          .values({
            mediaType,
            title,
            creator: finalCreator || undefined,
            isbn: isbn || undefined,
            externalId: imdbId || undefined,
            url: url || undefined,
            coverImage: finalCoverImage || undefined,
            description: description || undefined,
            publishedYear: finalPublishYear || undefined,
            length: (mediaType === 'book' ? pageCount : runtime) || undefined,
            totalReviews: 0,
            averageRating: undefined,
            createdBy: agent.did || undefined,
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
          length: item.length,
          totalRatings: item.totalRatings,
          totalReviews: item.totalReviews,
          totalSaves: item.totalSaves,
          averageRating: item.averageRating
            ? parseFloat(item.averageRating.toString())
            : null,
          createdBy: item.createdBy || null,
          ratingDistribution: {
            rating0: item.rating0,
            rating0_5: item.rating0_5,
            rating1: item.rating1,
            rating1_5: item.rating1_5,
            rating2: item.rating2,
            rating2_5: item.rating2_5,
            rating3: item.rating3,
            rating3_5: item.rating3_5,
            rating4: item.rating4,
            rating4_5: item.rating4_5,
            rating5: item.rating5,
          },
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

  // PUT /media/:id - Update media item details (admin or creator only)
  router.put(
    '/:id',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = req.params;

      // Check if media item exists and get its creator
      const mediaItem = await ctx.db
        .selectFrom('media_items')
        .select(['id', 'createdBy'])
        .where('id', '=', parseInt(id))
        .executeTakeFirst();

      if (!mediaItem) {
        return res.status(404).json({ error: 'Media item not found' });
      }

      // Check if user is admin or creator
      const user = await ctx.db
        .selectFrom('users')
        .selectAll()
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      const isAdmin = user?.isAdmin || false;
      const isCreator = mediaItem.createdBy === agent.did;

      if (!isAdmin && !isCreator) {
        return res
          .status(403)
          .json({ error: 'You do not have permission to edit this item' });
      }
      const { title, creator, coverImage, description, publishedYear, length } =
        req.body;

      try {
        // Build update object with only provided fields
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (title !== undefined) updateData.title = title;
        if (creator !== undefined) updateData.creator = creator || null;
        if (coverImage !== undefined)
          updateData.coverImage = coverImage || null;
        if (description !== undefined)
          updateData.description = description || null;
        if (publishedYear !== undefined)
          updateData.publishedYear = publishedYear || null;
        if (length !== undefined) updateData.length = length || null;

        // Update the media item
        const updatedItem = await ctx.db
          .updateTable('media_items')
          .set(updateData)
          .where('id', '=', parseInt(id))
          .returningAll()
          .executeTakeFirst();

        if (!updatedItem) {
          return res.status(404).json({ error: 'Media item not found' });
        }

        res.json({
          success: true,
          mediaItem: {
            id: updatedItem.id,
            mediaType: updatedItem.mediaType,
            title: updatedItem.title,
            creator: updatedItem.creator,
            isbn: updatedItem.isbn,
            coverImage: updatedItem.coverImage,
            description: updatedItem.description,
            publishedYear: updatedItem.publishedYear,
            length: updatedItem.length,
            updatedAt: updatedItem.updatedAt,
          },
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update media item');
        res.status(500).json({ error: 'Failed to update media item' });
      }
    })
  );

  // DELETE /media/:id - Delete media item (admin only)
  router.delete(
    '/:id',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      const user = await ctx.db
        .selectFrom('users')
        .selectAll()
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { id } = req.params;

      try {
        // Delete the media item
        const deletedItem = await ctx.db
          .deleteFrom('media_items')
          .where('id', '=', parseInt(id))
          .returningAll()
          .executeTakeFirst();

        if (!deletedItem) {
          return res.status(404).json({ error: 'Media item not found' });
        }

        res.json({
          success: true,
          message: 'Media item deleted successfully',
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete media item');
        res.status(500).json({ error: 'Failed to delete media item' });
      }
    })
  );

  return router;
};
