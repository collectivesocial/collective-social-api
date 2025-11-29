import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import {
  AppCollectiveSocialList,
  AppCollectiveSocialListitem,
} from '../types/lexicon';

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

  // GET /collections - Get all collections for the authenticated user
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // List records of type app.collectivesocial.list from the user's repo
        const response = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
        });

        res.json({
          collections: response.data.records.map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            name: record.value.name,
            description: record.value.description || null,
            visibility: record.value.visibility || 'public',
            isDefault: record.value.isDefault || false,
            purpose: record.value.purpose,
            avatar: record.value.avatar || null,
            createdAt: record.value.createdAt,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch collections');
        res.status(500).json({ error: 'Failed to fetch collections' });
      }
    })
  );

  // POST /collections - Create a new collection
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { name, description, purpose, visibility } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      try {
        const record: AppCollectiveSocialList.Record = {
          $type: 'app.collectivesocial.list',
          name,
          description: description || undefined,
          visibility: visibility || 'public',
          purpose: purpose || 'app.collectivesocial.defs#curatelist',
          createdAt: new Date().toISOString(),
        };

        // Create a record in the user's repo using the custom lexicon
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
          record: record as any,
        });

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          name,
          description: description || null,
          visibility: record.visibility,
          purpose: record.purpose,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create collection');
        res.status(500).json({ error: 'Failed to create collection' });
      }
    })
  );

  // PUT /collections/:listUri - Update a collection
  router.put(
    '/:listUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { name, description, visibility } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Extract DID from listUri to verify ownership
        const listDidMatch = listUri.match(/^at:\/\/([^\/]+)/);
        if (!listDidMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const listOwnerDid = listDidMatch[1];

        // Check if the authenticated user owns this list
        if (agent.did !== listOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to update this list' });
        }

        // Get current list record
        const listsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
        });

        const listRecord = listsResponse.data.records.find(
          (record: any) => record.uri === listUri
        );

        if (!listRecord) {
          return res.status(404).json({ error: 'List not found' });
        }

        const currentData = listRecord.value as any;

        // Extract rkey from listUri
        const rkeyMatch = listUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const rkey = rkeyMatch[1];

        // Update the record
        const updatedRecord: AppCollectiveSocialList.Record = {
          ...currentData,
          name,
          description: description || undefined,
          visibility: visibility || currentData.visibility,
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
          rkey: rkey,
          record: updatedRecord as any,
        });

        res.json({
          success: true,
          name: updatedRecord.name,
          description: updatedRecord.description,
          visibility: updatedRecord.visibility,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update collection');
        res.status(500).json({ error: 'Failed to update collection' });
      }
    })
  );

  // DELETE /collections/:listUri - Delete a collection
  router.delete(
    '/:listUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Extract DID from listUri to verify ownership
        const listDidMatch = listUri.match(/^at:\/\/([^\/]+)/);
        if (!listDidMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const listOwnerDid = listDidMatch[1];

        // Check if the authenticated user owns this list
        if (agent.did !== listOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to delete this list' });
        }

        // Get the list record to check if it's the default list
        const listsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
        });

        const listRecord = listsResponse.data.records.find(
          (record: any) => record.uri === listUri
        );

        if (!listRecord) {
          return res.status(404).json({ error: 'List not found' });
        }

        const listData = listRecord.value as any;

        // Prevent deletion of default list
        if (listData.isDefault) {
          return res
            .status(403)
            .json({ error: 'Cannot delete the default Inbox list' });
        }

        // Extract rkey from listUri
        const rkeyMatch = listUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const rkey = rkeyMatch[1];

        // Delete the record from the user's repo
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
          rkey: rkey,
        });

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete collection');
        res.status(500).json({ error: 'Failed to delete collection' });
      }
    })
  );

  // GET /collections/:uri/items - Get all items in a collection
  router.get(
    '/:listUri/items',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Decode URI from route param
        const listUri = decodeURIComponent(req.params.listUri);

        // List all listitem records from the user's repo
        const response = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
        });

        // Filter items that belong to this list
        const items = await Promise.all(
          response.data.records
            .filter((record: any) => record.value.list === listUri)
            .map(async (record: any) => {
              const item: any = {
                uri: record.uri,
                cid: record.cid,
                title: record.value.title,
                creator: record.value.creator || null,
                mediaType: record.value.mediaType || null,
                mediaItemId: record.value.mediaItemId || null,
                status: record.value.status || null,
                rating:
                  record.value.rating !== undefined
                    ? record.value.rating
                    : null,
                review: record.value.review || null,
                recommendations: record.value.recommendations || [],
                createdAt: record.value.createdAt,
              };

              // If there's a mediaItemId, enrich with media_items data
              if (record.value.mediaItemId) {
                const mediaItem = await ctx.db
                  .selectFrom('media_items')
                  .selectAll()
                  .where('id', '=', record.value.mediaItemId)
                  .executeTakeFirst();

                if (mediaItem) {
                  item.mediaItem = {
                    id: mediaItem.id,
                    isbn: mediaItem.isbn,
                    externalId: mediaItem.externalId,
                    coverImage: mediaItem.coverImage,
                    description: mediaItem.description,
                    publishedYear: mediaItem.publishedYear,
                    totalReviews: mediaItem.totalReviews,
                    averageRating: mediaItem.averageRating,
                  };
                }
              }

              return item;
            })
        );

        res.json({ items });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch collection items');
        res.status(500).json({ error: 'Failed to fetch collection items' });
      }
    })
  );

  // POST /collections/:listUri/items - Add an item to a collection
  router.post(
    '/:listUri/items',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const {
        title,
        rating,
        status,
        review,
        mediaType,
        creator,
        mediaItemId,
        recommendedBy,
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Build recommendations array
        const recommendations = [];
        if (recommendedBy) {
          // recommendedBy can be a single DID/handle or array of DIDs/handles
          const recommenders = Array.isArray(recommendedBy)
            ? recommendedBy
            : [recommendedBy];
          const suggestedAt = new Date().toISOString();

          for (const recommender of recommenders) {
            let did = recommender;

            // If it's a handle (not starting with did:), resolve it to a DID
            if (!recommender.startsWith('did:')) {
              try {
                const resolved = await agent.resolveHandle({
                  handle: recommender,
                });
                did = resolved.data.did;
              } catch (err) {
                ctx.logger.warn(
                  { handle: recommender },
                  'Failed to resolve handle, using as-is'
                );
                // Keep the original value if resolution fails
              }
            }

            recommendations.push({
              did: did,
              suggestedAt: suggestedAt,
            });
          }
        }

        // Create a listitem record with the review data
        const listItemRecord: AppCollectiveSocialListitem.Record = {
          $type: 'app.collectivesocial.listitem',
          list: listUri,
          title,
          creator: creator || undefined,
          mediaItemId: mediaItemId || undefined,
          mediaType: mediaType || undefined,
          status: status || undefined,
          rating: rating !== undefined ? Number(rating) : undefined,
          review: review || undefined,
          recommendations:
            recommendations.length > 0 ? recommendations : undefined,
          createdAt: new Date().toISOString(),
        };

        // Create the record in the user's repo
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
          record: listItemRecord as any,
        });

        // If we have a mediaItemId and a rating, update the aggregated stats
        if (mediaItemId && rating !== undefined) {
          // Get current stats
          const currentItem = await ctx.db
            .selectFrom('media_items')
            .select(['totalReviews', 'averageRating'])
            .where('id', '=', mediaItemId)
            .executeTakeFirst();

          if (currentItem) {
            const newTotalReviews = currentItem.totalReviews + 1;
            const currentAvg = currentItem.averageRating
              ? parseFloat(currentItem.averageRating.toString())
              : 0;
            const newAverage =
              (currentAvg * currentItem.totalReviews + Number(rating)) /
              newTotalReviews;

            // Update media item with new stats
            await ctx.db
              .updateTable('media_items')
              .set({
                totalReviews: newTotalReviews,
                averageRating: parseFloat(newAverage.toFixed(2)),
                updatedAt: new Date(),
              })
              .where('id', '=', mediaItemId)
              .execute();
          }
        }

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          title,
          rating,
          status,
          mediaType,
          creator,
          mediaItemId,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to add item to collection');
        res.status(500).json({ error: 'Failed to add item to collection' });
      }
    })
  );

  // PUT /collections/:listUri/items/:itemUri - Update an item in a collection
  router.put(
    '/:listUri/items/:itemUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { rating, review } = req.body;

      try {
        const listUri = decodeURIComponent(req.params.listUri);
        const itemUri = decodeURIComponent(req.params.itemUri);

        // Extract DID from itemUri to verify ownership
        const itemDidMatch = itemUri.match(/^at:\/\/([^\/]+)/);
        if (!itemDidMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const itemOwnerDid = itemDidMatch[1];

        // Check if the authenticated user owns this item
        if (agent.did !== itemOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to update this item' });
        }

        // Get the current item record
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
        });

        const itemRecord = itemsResponse.data.records.find(
          (record: any) => record.uri === itemUri
        );

        if (!itemRecord) {
          return res.status(404).json({ error: 'Item not found' });
        }

        const currentData = itemRecord.value as any;
        const oldRating = currentData.rating;
        const mediaItemId = currentData.mediaItemId;

        // Extract rkey from itemUri
        const rkeyMatch = itemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const rkey = rkeyMatch[1];

        // Update the record with new rating and/or review
        const updatedRecord: AppCollectiveSocialListitem.Record = {
          ...currentData,
          rating: rating !== undefined ? Number(rating) : currentData.rating,
          review: review !== undefined ? review : currentData.review,
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
          rkey: rkey,
          record: updatedRecord as any,
        });

        // Update aggregated stats if rating changed and we have a mediaItemId
        if (
          mediaItemId &&
          rating !== undefined &&
          oldRating !== Number(rating)
        ) {
          const currentItem = await ctx.db
            .selectFrom('media_items')
            .select(['totalReviews', 'averageRating'])
            .where('id', '=', mediaItemId)
            .executeTakeFirst();

          if (currentItem && currentItem.totalReviews > 0) {
            const currentAvg = currentItem.averageRating
              ? parseFloat(currentItem.averageRating.toString())
              : 0;

            let newAverage: number;
            if (oldRating === undefined || oldRating === null) {
              // Adding a new rating
              const newTotalReviews = currentItem.totalReviews + 1;
              newAverage =
                (currentAvg * currentItem.totalReviews + Number(rating)) /
                newTotalReviews;

              await ctx.db
                .updateTable('media_items')
                .set({
                  totalReviews: newTotalReviews,
                  averageRating: parseFloat(newAverage.toFixed(2)),
                  updatedAt: new Date(),
                })
                .where('id', '=', mediaItemId)
                .execute();
            } else {
              // Updating existing rating
              newAverage =
                (currentAvg * currentItem.totalReviews -
                  Number(oldRating) +
                  Number(rating)) /
                currentItem.totalReviews;

              await ctx.db
                .updateTable('media_items')
                .set({
                  averageRating: parseFloat(newAverage.toFixed(2)),
                  updatedAt: new Date(),
                })
                .where('id', '=', mediaItemId)
                .execute();
            }
          }
        }

        res.json({
          success: true,
          rating: updatedRecord.rating,
          review: updatedRecord.review,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update item');
        res.status(500).json({ error: 'Failed to update item' });
      }
    })
  );

  // DELETE /collections/:listUri/items/:itemUri - Delete an item from a collection
  router.delete(
    '/:listUri/items/:itemUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);
        const itemUri = decodeURIComponent(req.params.itemUri);

        // Extract DID from listUri (format: at://did:plc:xxx/app.collectivesocial.list/xxx)
        const listDidMatch = listUri.match(/^at:\/\/([^\/]+)/);
        if (!listDidMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const listOwnerDid = listDidMatch[1];

        // Check if the authenticated user owns this list
        if (agent.did !== listOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to delete items from this list' });
        }

        // Get the item first to retrieve its data before deletion (for rating adjustment)
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
        });

        const itemRecord = itemsResponse.data.records.find(
          (record: any) => record.uri === itemUri
        );

        if (!itemRecord) {
          return res.status(404).json({ error: 'Item not found' });
        }

        // Extract rkey from itemUri (format: at://did:plc:xxx/app.collectivesocial.listitem/rkey)
        const rkeyMatch = itemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const rkey = rkeyMatch[1];

        // Delete the record from the user's repo
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
          rkey: rkey,
        });

        // If the item had a mediaItemId and rating, update the aggregated stats
        const itemData = itemRecord.value as any;
        if (itemData.mediaItemId && itemData.rating !== undefined) {
          const currentItem = await ctx.db
            .selectFrom('media_items')
            .select(['totalReviews', 'averageRating'])
            .where('id', '=', itemData.mediaItemId)
            .executeTakeFirst();

          if (currentItem && currentItem.totalReviews > 0) {
            const newTotalReviews = currentItem.totalReviews - 1;

            if (newTotalReviews === 0) {
              // Reset to 0 if no more reviews
              await ctx.db
                .updateTable('media_items')
                .set({
                  totalReviews: 0,
                  averageRating: 0,
                  updatedAt: new Date(),
                })
                .where('id', '=', itemData.mediaItemId)
                .execute();
            } else {
              // Recalculate average without this rating
              const currentAvg = currentItem.averageRating
                ? parseFloat(currentItem.averageRating.toString())
                : 0;
              const newAverage =
                (currentAvg * currentItem.totalReviews -
                  Number(itemData.rating)) /
                newTotalReviews;

              await ctx.db
                .updateTable('media_items')
                .set({
                  totalReviews: newTotalReviews,
                  averageRating: parseFloat(newAverage.toFixed(2)),
                  updatedAt: new Date(),
                })
                .where('id', '=', itemData.mediaItemId)
                .execute();
            }
          }
        }

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete item from collection');
        res
          .status(500)
          .json({ error: 'Failed to delete item from collection' });
      }
    })
  );

  // GET /collections/public/:did - Get public collections for a user (for profile display)
  router.get(
    '/public/:did',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'public, max-age=60');

      const { did } = req.params;

      // Try to get authenticated agent, otherwise create unauthenticated one
      let queryAgent = await getSessionAgent(req, res, ctx);
      if (!queryAgent) {
        // Create an unauthenticated agent for public queries
        queryAgent = new Agent({ service: 'https://bsky.social' });
      }

      try {
        // List records of type app.collectivesocial.list from the specified user's repo
        const response = await queryAgent.api.com.atproto.repo.listRecords({
          repo: did,
          collection: 'app.collectivesocial.list',
        });

        // Filter to only public collections
        const publicCollections = response.data.records
          .filter((record: any) => {
            const visibility = record.value.visibility || 'public';
            return visibility === 'public';
          })
          .map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            name: record.value.name,
            description: record.value.description || null,
            visibility: record.value.visibility || 'public',
            isDefault: record.value.isDefault || false,
            purpose: record.value.purpose,
            avatar: record.value.avatar || null,
            createdAt: record.value.createdAt,
          }));

        res.json({
          collections: publicCollections,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch public collections');
        res.status(500).json({ error: 'Failed to fetch public collections' });
      }
    })
  );

  return router;
};
