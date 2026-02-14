import express, { Request, Response } from 'express';
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import {
  AppCollectiveSocialFeedList,
  AppCollectiveSocialFeedListitem,
  AppCollectiveSocialFeedReview,
  AppCollectiveSocialFeedUseritem,
} from '../types/lexicon';
import { getSessionAgent } from '../auth/agent';
import { sql } from 'kysely';

// Helper function to get the rating column name for a given rating value
const getRatingColumnName = (rating: number): string => {
  const ratingStr = rating.toString().replace('.', '_');
  return `rating${ratingStr}` as any;
};

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
        // List records of type app.collectivesocial.feed.list from the user's repo
        const response = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
        });

        // Get all list items to count items per collection
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        // Count items per collection
        const itemCounts: Record<string, number> = {};
        itemsResponse.data.records.forEach((record: any) => {
          const listUri = record.value.list;
          itemCounts[listUri] = (itemCounts[listUri] || 0) + 1;
        });

        // Count how many times each collection has been copied (children count)
        const copyCounts: Record<string, number> = {};
        response.data.records.forEach((record: any) => {
          const parentUri = record.value.parentListUri;
          if (parentUri) {
            copyCounts[parentUri] = (copyCounts[parentUri] || 0) + 1;
          }
        });

        res.json({
          collections: response.data.records.map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            name: record.value.name,
            description: record.value.description || null,
            parentListUri: record.value.parentListUri || null,
            visibility: record.value.visibility || 'public',
            isDefault: record.value.isDefault || false,
            purpose: record.value.purpose,
            avatar: record.value.avatar || null,
            createdAt: record.value.createdAt,
            itemCount: itemCounts[record.uri] || 0,
            copyCount: copyCounts[record.uri] || 0,
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

      const { name, description, purpose, visibility, parentListUri } =
        req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      try {
        // Check if user already has a default list
        const existingLists = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
        });

        const hasDefaultList = existingLists.data.records.some(
          (record: any) => record.value.isDefault === true
        );

        // Mark as default if this is the user's first list or they have no default
        const isDefault = !hasDefaultList;

        const record: AppCollectiveSocialFeedList.Record = {
          $type: 'app.collectivesocial.feed.list',
          name,
          description: description || undefined,
          parentListUri: parentListUri || undefined,
          visibility: visibility || 'public',
          purpose: purpose || 'app.collectivesocial.defs#curatelist',
          isDefault: isDefault || undefined,
          createdAt: new Date().toISOString(),
        };

        // Create a record in the user's repo using the custom lexicon
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
          record: record as any,
        });

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          name,
          description: description || null,
          parentListUri: parentListUri || null,
          visibility: record.visibility,
          purpose: record.purpose,
          isDefault: record.isDefault || false,
          itemCount: 0,
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
          collection: 'app.collectivesocial.feed.list',
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
        const updatedRecord: AppCollectiveSocialFeedList.Record = {
          ...currentData,
          name,
          description: description || undefined,
          visibility: visibility || currentData.visibility,
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
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
          collection: 'app.collectivesocial.feed.list',
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
          collection: 'app.collectivesocial.feed.list',
          rkey: rkey,
        });

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete collection');
        res.status(500).json({ error: 'Failed to delete collection' });
      }
    })
  );

  // POST /collections/:listUri/clone - Clone a collection
  router.post(
    '/:listUri/clone',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const sourceListUri = decodeURIComponent(req.params.listUri);

        // Get the source list to clone
        const listsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
        });

        const sourceList = listsResponse.data.records.find(
          (record: any) => record.uri === sourceListUri
        );

        if (!sourceList) {
          return res.status(404).json({ error: 'Source list not found' });
        }

        const sourceListData = sourceList.value as any;

        // If source list already has a parent, use that as the parent for the clone
        // This ensures all clones reference the original source list
        const parentListUri = sourceListData.parentListUri || sourceListUri;

        // Create new list with parentListUri set to original source
        const newListRecord: AppCollectiveSocialFeedList.Record = {
          $type: 'app.collectivesocial.feed.list',
          name: `${sourceListData.name} (Copy)`,
          description: sourceListData.description || undefined,
          parentListUri: parentListUri,
          visibility: sourceListData.visibility || 'public',
          purpose:
            sourceListData.purpose || 'app.collectivesocial.defs#curatelist',
          isDefault: false,
          createdAt: new Date().toISOString(),
        };

        const newListResponse = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
          record: newListRecord as any,
        });

        const newListUri = newListResponse.data.uri;

        // Get all items from the source list
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        const sourceItems = itemsResponse.data.records.filter(
          (record: any) => record.value.list === sourceListUri
        );

        // Clone each item to the new list
        for (const sourceItem of sourceItems) {
          const sourceItemData = sourceItem.value as any;
          const mediaItemId = sourceItemData.mediaItemId;

          const newItemRecord: AppCollectiveSocialFeedListitem.Record = {
            $type: 'app.collectivesocial.feed.listitem',
            list: newListUri,
            title: sourceItemData.title,
            creator: sourceItemData.creator || undefined,
            mediaType: sourceItemData.mediaType || 'book',
            mediaItemId: mediaItemId || undefined,
            order:
              sourceItemData.order !== undefined
                ? sourceItemData.order
                : undefined,
            createdAt: new Date().toISOString(),
          };

          await agent.api.com.atproto.repo.createRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.listitem',
            record: newItemRecord as any,
          });
        }

        ctx.logger.info(
          { sourceListUri, newListUri, itemCount: sourceItems.length },
          'Collection cloned successfully'
        );

        res.json({
          success: true,
          uri: newListUri,
          cid: newListResponse.data.cid,
          name: newListRecord.name,
          description: newListRecord.description,
          parentListUri: sourceListUri,
          itemCount: sourceItems.length,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to clone collection');
        res.status(500).json({ error: 'Failed to clone collection' });
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
          collection: 'app.collectivesocial.feed.listitem',
        });

        // Also fetch all useritem records to enrich list items with status/rating/notes
        const useritemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.useritem',
        });

        // Build a lookup map: mediaItemId → useritem data
        const useritemsByMediaId: Record<number, any> = {};
        for (const record of useritemsResponse.data.records) {
          const val = record.value as any;
          if (val.mediaItemId) {
            useritemsByMediaId[val.mediaItemId] = {
              uri: record.uri,
              cid: record.cid,
              status: val.status || 'want',
              rating: val.rating ?? null,
              notes: val.notes || null,
              review: val.review || null,
              completedAt: val.completedAt || null,
              recommendations: val.recommendations || [],
            };
          }
        }

        // Filter items that belong to this list
        const filteredRecords = response.data.records.filter(
          (record: any) => record.value.list === listUri
        );

        // Batch fetch all media items to avoid N+1 queries
        const mediaItemIds = filteredRecords
          .filter((record: any) => record.value.mediaItemId)
          .map((record: any) => record.value.mediaItemId);

        const mediaItems =
          mediaItemIds.length > 0
            ? await ctx.db
                .selectFrom('media_items')
                .selectAll()
                .where('id', 'in', mediaItemIds)
                .execute()
            : [];

        const mediaItemMap = new Map(mediaItems.map((item) => [item.id, item]));

        // Map items with enriched data
        const items = filteredRecords.map((record: any) => {
          const useritemData = record.value.mediaItemId
            ? useritemsByMediaId[record.value.mediaItemId] || {}
            : {};

          const item: any = {
            uri: record.uri,
            cid: record.cid,
            title: record.value.title,
            creator: record.value.creator || null,
            order: record.value.order !== undefined ? record.value.order : 0,
            mediaType: record.value.mediaType || null,
            mediaItemId: record.value.mediaItemId || null,
            userItemUri: record.value.userItem || useritemData.uri || null,
            // Enriched from useritem
            status: useritemData.status || null,
            rating: useritemData.rating ?? null,
            notes: useritemData.notes || null,
            review: useritemData.review || null,
            completedAt: useritemData.completedAt || null,
            recommendations: useritemData.recommendations || [],
            createdAt: record.value.createdAt,
          };

          // If there's a mediaItemId, enrich with media_items data
          if (record.value.mediaItemId) {
            const mediaItem = mediaItemMap.get(record.value.mediaItemId);
            if (mediaItem) {
              item.mediaItem = {
                id: mediaItem.id,
                isbn: mediaItem.isbn,
                externalId: mediaItem.externalId,
                coverImage: mediaItem.coverImage,
                description: mediaItem.description,
                publishedYear: mediaItem.publishedYear,
                length: mediaItem.length,
                totalReviews: mediaItem.totalReviews,
                totalSaves: mediaItem.totalSaves,
                averageRating: mediaItem.averageRating,
                url: mediaItem.url,
              };
            }
          }

          return item;
        });

        // Sort by order (descending - higher numbers first)
        items.sort((a, b) => (b.order || 0) - (a.order || 0));

        res.json({ items });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch collection items');
        res.status(500).json({ error: 'Failed to fetch collection items' });
      }
    })
  );

  // POST /collections/quick-add — add an item to the user's default list
  // If no default list exists, creates one. If item is already tracked, returns existing.
  // Used by group context to sync items to personal library.
  router.post(
    '/quick-add',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { mediaItemId, mediaType, title, creator, status } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      try {
        // Find the user's default list
        const listsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
        });

        let defaultListUri: string | null = null;

        for (const record of listsResponse.data.records) {
          if ((record.value as any).isDefault === true) {
            defaultListUri = record.uri;
            break;
          }
        }

        // Create a default list if none exists
        if (!defaultListUri) {
          const listRecord: AppCollectiveSocialFeedList.Record = {
            $type: 'app.collectivesocial.feed.list',
            name: 'My Library',
            visibility: 'public',
            purpose: 'app.collectivesocial.defs#curatelist',
            isDefault: true,
            createdAt: new Date().toISOString(),
          };

          const createRes = await agent.api.com.atproto.repo.createRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.list',
            record: listRecord as any,
          });
          defaultListUri = createRes.data.uri;
        }

        // Check for existing item in the default list
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        const existingItem = itemsResponse.data.records.find((record: any) => {
          const val = record.value as any;
          if (val.list !== defaultListUri) return false;
          if (mediaItemId) return val.mediaItemId === mediaItemId;
          return val.title === title;
        });

        if (existingItem) {
          // Already tracked — optionally upgrade status
          const useritemsResponse = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.useritem',
          });
          const useritem = mediaItemId
            ? useritemsResponse.data.records.find(
                (r: any) => r.value.mediaItemId === mediaItemId
              )
            : null;

          // If caller wants 'in-progress' and current is 'want', upgrade
          if (
            status === 'in-progress' &&
            useritem &&
            (useritem.value as any).status === 'want'
          ) {
            const existingVal = useritem.value as any;
            await agent.api.com.atproto.repo.putRecord({
              repo: agent.did!,
              collection: 'app.collectivesocial.feed.useritem',
              rkey: useritem.uri.split('/').pop()!,
              record: {
                ...existingVal,
                status: 'in-progress',
                updatedAt: new Date().toISOString(),
              },
            });
          }

          return res.json({
            uri: existingItem.uri,
            alreadyExists: true,
            listUri: defaultListUri,
            userItemUri: (existingItem.value as any).userItem || null,
          });
        }

        // Ensure a useritem record exists
        let userItemUri: string | null = null;
        const useritemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.useritem',
        });

        const existingUseritem = mediaItemId
          ? useritemsResponse.data.records.find(
              (r: any) => r.value.mediaItemId === mediaItemId
            )
          : null;

        if (existingUseritem) {
          userItemUri = existingUseritem.uri;

          // Upgrade status if needed
          if (
            status === 'in-progress' &&
            (existingUseritem.value as any).status === 'want'
          ) {
            const existingVal = existingUseritem.value as any;
            await agent.api.com.atproto.repo.putRecord({
              repo: agent.did!,
              collection: 'app.collectivesocial.feed.useritem',
              rkey: existingUseritem.uri.split('/').pop()!,
              record: {
                ...existingVal,
                status: 'in-progress',
                updatedAt: new Date().toISOString(),
              },
            });
          }
        } else {
          const now = new Date().toISOString();
          const useritemRecord: AppCollectiveSocialFeedUseritem.Record = {
            $type: 'app.collectivesocial.feed.useritem',
            title,
            creator: creator || undefined,
            mediaItemId: mediaItemId || undefined,
            mediaType: mediaType || undefined,
            status: status || 'want',
            createdAt: now,
            updatedAt: now,
          };

          const useritemRes = await agent.api.com.atproto.repo.createRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.useritem',
            record: useritemRecord as any,
          });
          userItemUri = useritemRes.data.uri;

          if (mediaItemId) {
            await ctx.db
              .updateTable('media_items')
              .set((eb) => ({
                totalSaves: eb('totalSaves', '+', 1),
                updatedAt: new Date(),
              }))
              .where('id', '=', mediaItemId)
              .execute();
          }
        }

        // Create the listitem
        const existingInList = itemsResponse.data.records
          .filter((r: any) => r.value.list === defaultListUri)
          .map((r: any) => r.value.order || 0);
        const maxOrder = existingInList.length > 0 ? Math.max(...existingInList) : 0;

        const now = new Date();
        const listItemRecord: AppCollectiveSocialFeedListitem.Record = {
          $type: 'app.collectivesocial.feed.listitem',
          list: defaultListUri!,
          title,
          creator: creator || undefined,
          order: maxOrder + 1,
          mediaItemId: mediaItemId || undefined,
          mediaType: mediaType || undefined,
          userItem: userItemUri || undefined,
          createdAt: now.toISOString(),
        };

        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          record: listItemRecord as any,
        });

        return res.json({
          uri: response.data.uri,
          created: true,
          listUri: defaultListUri,
          userItemUri,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to quick-add item');
        return res.status(500).json({ error: 'Failed to quick-add item' });
      }
    })
  );

  // POST /collections/:listUri/items - Add an item to a collection
  // Creates a lightweight listitem (list membership) and ensures a useritem exists
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
        status,
        rating,
        review,
        notes,
        mediaType,
        creator,
        mediaItemId,
        recommendedBy,
        completedAt,
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Check if item already exists in this list
        const existingItemsResponse =
          await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.listitem',
          });

        const existingItem = existingItemsResponse.data.records.find(
          (record: any) => {
            const itemData = record.value as any;
            if (itemData.list !== listUri) return false;
            if (mediaItemId) {
              return itemData.mediaItemId === mediaItemId;
            } else {
              return itemData.title === title;
            }
          }
        );

        if (existingItem) {
          // Item already in this list — return it without duplicating
          return res.json({
            uri: existingItem.uri,
            cid: existingItem.cid,
            updated: false,
            alreadyExists: true,
            title,
            mediaType,
            creator,
            mediaItemId,
          });
        }

        // --- Ensure a useritem record exists for this media item ---
        let userItemUri: string | null = null;

        // Check for existing useritem by listing all and matching mediaItemId
        const useritemsResponse =
          await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.useritem',
          });

        const existingUseritem = mediaItemId
          ? useritemsResponse.data.records.find(
              (record: any) => record.value.mediaItemId === mediaItemId
            )
          : null;

        if (existingUseritem) {
          userItemUri = existingUseritem.uri;
        } else {
          // Build recommendations array
          const newRecommendations = [];
          if (recommendedBy) {
            const recommenders = Array.isArray(recommendedBy)
              ? recommendedBy
              : [recommendedBy];
            const suggestedAt = new Date().toISOString();
            for (const recommender of recommenders) {
              let did = recommender;
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
                }
              }
              newRecommendations.push({ did, suggestedAt });
            }
          }

          const now = new Date();
          const useritemRecord: AppCollectiveSocialFeedUseritem.Record = {
            $type: 'app.collectivesocial.feed.useritem',
            title,
            creator: creator || undefined,
            mediaItemId: mediaItemId || undefined,
            mediaType: mediaType || undefined,
            status: status || 'want',
            rating: rating !== undefined ? Number(rating) : undefined,
            notes: notes || undefined,
            completedAt:
              status === 'completed'
                ? completedAt || now.toISOString()
                : undefined,
            recommendations:
              newRecommendations.length > 0 ? newRecommendations : undefined,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };

          const useritemResponse =
            await agent.api.com.atproto.repo.createRecord({
              repo: agent.did!,
              collection: 'app.collectivesocial.feed.useritem',
              record: useritemRecord as any,
            });

          userItemUri = useritemResponse.data.uri;

          // Increment totalSaves for this media item (first time user is saving it)
          if (mediaItemId) {
            await ctx.db
              .updateTable('media_items')
              .set((eb) => ({
                totalSaves: eb('totalSaves', '+', 1),
                updatedAt: new Date(),
              }))
              .where('id', '=', mediaItemId)
              .execute();
          }

          // Handle initial review if provided
          if (
            review &&
            review.trim() &&
            rating !== undefined &&
            mediaItemId &&
            mediaType
          ) {
            const reviewNow = new Date();
            let reviewUri: string | null = null;
            try {
              const reviewRecord: AppCollectiveSocialFeedReview.Record = {
                $type: 'app.collectivesocial.feed.review',
                text: review.trim(),
                rating: Number(rating),
                mediaItemId: mediaItemId,
                mediaType: mediaType as any,
                listItem: userItemUri!,
                createdAt: reviewNow.toISOString(),
                updatedAt: reviewNow.toISOString(),
              };

              const reviewResponse =
                await agent.api.com.atproto.repo.createRecord({
                  repo: agent.did!,
                  collection: 'app.collectivesocial.feed.review',
                  record: reviewRecord as any,
                });

              reviewUri = reviewResponse.data.uri;
            } catch (err) {
              ctx.logger.error(
                { err },
                'Failed to create AT Protocol review record'
              );
            }

            await ctx.db
              .insertInto('reviews')
              .values({
                authorDid: agent.did!,
                mediaItemId,
                mediaType,
                rating: Number(rating),
                review: review.trim(),
                listItemUri: userItemUri,
                reviewUri,
                createdAt: reviewNow,
                updatedAt: reviewNow,
              } as any)
              .onConflict((oc) =>
                oc
                  .columns(['authorDid', 'mediaItemId', 'mediaType'])
                  .doUpdateSet({
                    rating: Number(rating),
                    review: review.trim(),
                    reviewUri,
                    updatedAt: reviewNow,
                  })
              )
              .execute();

            // Update aggregated stats
            const currentItem = await ctx.db
              .selectFrom('media_items')
              .select(['totalRatings', 'totalReviews', 'averageRating'])
              .where('id', '=', mediaItemId)
              .executeTakeFirst();

            if (currentItem) {
              const currentAvg = currentItem.averageRating
                ? parseFloat(currentItem.averageRating.toString())
                : 0;
              const newTotalRatings = currentItem.totalRatings + 1;
              const newTotalReviews = currentItem.totalReviews + 1;
              const newAverage =
                (currentAvg * currentItem.totalRatings + Number(rating)) /
                newTotalRatings;
              const ratingColumn = getRatingColumnName(Number(rating));

              await ctx.db
                .updateTable('media_items')
                .set({
                  totalRatings: newTotalRatings,
                  totalReviews: newTotalReviews,
                  averageRating: parseFloat(newAverage.toFixed(2)),
                  [ratingColumn]: sql`"${sql.raw(ratingColumn)}" + 1`,
                  updatedAt: new Date(),
                } as any)
                .where('id', '=', mediaItemId)
                .execute();
            }
          }

          // Create feed event for new item
          if (mediaType === 'book') {
            try {
              const profile = await agent.getProfile({ actor: agent.did! });
              const userHandle = profile.data.handle;
              const itemStatus = status || 'want';
              let eventName = '';

              if (itemStatus === 'want') {
                eventName = `${userHandle} wants to read "${title}"`;
              } else if (itemStatus === 'in-progress') {
                eventName = `${userHandle} started reading "${title}"`;
              } else if (itemStatus === 'completed') {
                eventName = `${userHandle} finished reading "${title}"`;
              }

              if (eventName) {
                await ctx.db
                  .insertInto('feed_events')
                  .values({
                    eventName,
                    mediaLink: mediaItemId ? `/items/${mediaItemId}` : null,
                    userDid: agent.did!,
                    createdAt: new Date(),
                  } as any)
                  .execute();
              }
            } catch (err) {
              ctx.logger.error({ err }, 'Failed to create feed event');
            }
          }
        }

        // --- Create the lightweight listitem record ---
        const existingItemsInList = existingItemsResponse.data.records
          .filter((record: any) => record.value.list === listUri)
          .map((record: any) => record.value.order || 0);
        const maxOrder =
          existingItemsInList.length > 0
            ? Math.max(...existingItemsInList)
            : 0;
        const newOrder = maxOrder + 1;

        const now = new Date();
        const listItemRecord: AppCollectiveSocialFeedListitem.Record = {
          $type: 'app.collectivesocial.feed.listitem',
          list: listUri,
          title,
          creator: creator || undefined,
          order: newOrder,
          mediaItemId: mediaItemId || undefined,
          mediaType: mediaType || undefined,
          userItem: userItemUri || undefined,
          createdAt: now.toISOString(),
        };

        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          record: listItemRecord as any,
        });

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          created: true,
          title,
          status: status || 'want',
          mediaType,
          creator,
          mediaItemId,
          userItemUri,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to add item to collection');
        res.status(500).json({ error: 'Failed to add item to collection' });
      }
    })
  );

  // PUT /collections/:listUri/items/:itemUri - Update an item in a collection
  // Now only handles order updates. Status/rating/review/notes go through PUT /useritems/:uri
  router.put(
    '/:listUri/items/:itemUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { order } = req.body;

      try {
        const itemUri = decodeURIComponent(req.params.itemUri);

        // Extract DID from itemUri to verify ownership
        const itemDidMatch = itemUri.match(/^at:\/\/([^\/]+)/);
        if (!itemDidMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const itemOwnerDid = itemDidMatch[1];

        if (agent.did !== itemOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to update this item' });
        }

        // Get the current item record
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        const itemRecord = itemsResponse.data.records.find(
          (record: any) => record.uri === itemUri
        );

        if (!itemRecord) {
          return res.status(404).json({ error: 'Item not found' });
        }

        const currentData = itemRecord.value as any;

        // Extract rkey from itemUri
        const rkeyMatch = itemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const rkey = rkeyMatch[1];

        // Update the record with new order (lightweight - only listitem fields)
        const updatedRecord: AppCollectiveSocialFeedListitem.Record = {
          ...currentData,
          ...(order !== undefined && { order }),
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          rkey: rkey,
          record: updatedRecord as any,
        });

        res.json({
          success: true,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update item');
        res.status(500).json({ error: 'Failed to update item' });
      }
    })
  );

  // PUT /collections/:listUri/reorder - Update order of multiple items
  router.put(
    '/:listUri/reorder',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { items } = req.body; // Array of { uri, order }

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items must be an array' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Verify ownership
        const listDidMatch = listUri.match(/^at:\/\/([^\/]+)/);
        if (!listDidMatch || listDidMatch[1] !== agent.did) {
          return res
            .status(403)
            .json({ error: 'Not authorized to reorder this list' });
        }

        // Get all items to update
        const itemsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        // Update each item's order
        for (const itemUpdate of items) {
          const itemRecord = itemsResponse.data.records.find(
            (record: any) => record.uri === itemUpdate.uri
          );

          if (!itemRecord) continue;

          // Extract rkey
          const rkeyMatch = itemUpdate.uri.match(/\/([^\/]+)$/);
          if (!rkeyMatch) continue;
          const rkey = rkeyMatch[1];

          const updatedRecord: AppCollectiveSocialFeedListitem.Record = {
            ...(itemRecord.value as any),
            order: itemUpdate.order,
          };

          await agent.api.com.atproto.repo.putRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.listitem',
            rkey: rkey,
            record: updatedRecord as any,
          });
        }

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to reorder items');
        res.status(500).json({ error: 'Failed to reorder items' });
      }
    })
  );

  // DELETE /collections/:listUri/items/:itemUri - Remove an item from a collection
  // Only removes list membership. The useritem record (status/rating/notes) is preserved.
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

        // Extract DID from listUri to verify ownership
        const listDidMatch = listUri.match(/^at:\/\/([^\/]+)/);
        if (!listDidMatch) {
          return res.status(400).json({ error: 'Invalid list URI' });
        }
        const listOwnerDid = listDidMatch[1];

        if (agent.did !== listOwnerDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to delete items from this list' });
        }

        // Extract rkey from itemUri
        const rkeyMatch = itemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const rkey = rkeyMatch[1];

        // Delete only the listitem record (list membership)
        // The useritem record is NOT deleted — the user still "has" this media item
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          rkey: rkey,
        });

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
          collection: 'app.collectivesocial.feed.list',
        });

        // Get all list items to count items per collection
        const itemsResponse = await queryAgent.api.com.atproto.repo.listRecords(
          {
            repo: did,
            collection: 'app.collectivesocial.feed.listitem',
          }
        );

        // Count items per collection
        const itemCounts: Record<string, number> = {};
        itemsResponse.data.records.forEach((record: any) => {
          const listUri = record.value.list;
          itemCounts[listUri] = (itemCounts[listUri] || 0) + 1;
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
            parentListUri: record.value.parentListUri || null,
            visibility: record.value.visibility || 'public',
            isDefault: record.value.isDefault || false,
            purpose: record.value.purpose,
            avatar: record.value.avatar || null,
            createdAt: record.value.createdAt,
            itemCount: itemCounts[record.uri] || 0,
          }));

        // Get total public collection count
        const totalCollectionCount = publicCollections.length;

        // Get review count for this user
        const reviewCount = await ctx.db
          .selectFrom('reviews')
          .select(({ fn }) => [fn.countAll().as('count')])
          .where('authorDid', '=', did)
          .executeTakeFirst();

        res.json({
          collections: publicCollections,
          collectionCount: totalCollectionCount,
          reviewCount: Number(reviewCount?.count || 0),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch public collections');
        res.status(500).json({ error: 'Failed to fetch public collections' });
      }
    })
  );

  // GET /collections/public/:did/in-progress - Get in-progress items from public collections
  // Now uses useritem records for status instead of listitem status
  router.get(
    '/public/:did/in-progress',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'public, max-age=60');

      const { did } = req.params;

      // Try to get authenticated agent, otherwise create unauthenticated one
      let queryAgent = await getSessionAgent(req, res, ctx);
      if (!queryAgent) {
        queryAgent = new Agent({ service: 'https://bsky.social' });
      }

      try {
        // Get all public collections for this user
        const collectionsResponse =
          await queryAgent.api.com.atproto.repo.listRecords({
            repo: did,
            collection: 'app.collectivesocial.feed.list',
          });

        const publicCollectionUris = collectionsResponse.data.records
          .filter((record: any) => {
            const visibility = record.value.visibility || 'public';
            return visibility === 'public';
          })
          .map((record: any) => record.uri);

        // Get all list items for this user
        const itemsResponse = await queryAgent.api.com.atproto.repo.listRecords(
          {
            repo: did,
            collection: 'app.collectivesocial.feed.listitem',
          }
        );

        // Get all useritem records for this user (status lives here now)
        const useritemsResponse =
          await queryAgent.api.com.atproto.repo.listRecords({
            repo: did,
            collection: 'app.collectivesocial.feed.useritem',
          });

        // Build a lookup map: mediaItemId → useritem data
        const useritemsByMediaId: Record<number, any> = {};
        for (const record of useritemsResponse.data.records) {
          const val = record.value as any;
          if (val.mediaItemId) {
            useritemsByMediaId[val.mediaItemId] = {
              uri: record.uri,
              status: val.status || 'want',
              rating: val.rating ?? null,
              completedAt: val.completedAt || null,
            };
          }
        }

        // Filter to items from public collections whose useritem has in-progress status
        const inProgressItems = itemsResponse.data.records
          .filter((record: any) => {
            const listUri = record.value.list;
            if (!publicCollectionUris.includes(listUri)) return false;
            const useritem = record.value.mediaItemId
              ? useritemsByMediaId[record.value.mediaItemId]
              : null;
            return useritem && useritem.status === 'in-progress';
          })
          .map((record: any) => {
            const useritem = useritemsByMediaId[record.value.mediaItemId] || {};
            return {
              uri: record.uri,
              cid: record.cid,
              title: record.value.title,
              creator: record.value.creator || null,
              mediaType: record.value.mediaType,
              mediaItemId: record.value.mediaItemId || null,
              status: useritem.status || null,
              rating: useritem.rating ?? null,
              completedAt: useritem.completedAt || null,
              createdAt: record.value.createdAt,
              listUri: record.value.list,
            };
          });

        // Deduplicate by mediaItemId (same item could be in multiple public lists)
        const seen = new Set<number>();
        const uniqueInProgressItems = inProgressItems.filter((item) => {
          if (!item.mediaItemId || seen.has(item.mediaItemId)) return false;
          seen.add(item.mediaItemId);
          return true;
        });

        // Fetch media items data
        const mediaItemIds = uniqueInProgressItems
          .filter((item) => item.mediaItemId)
          .map((item) => item.mediaItemId);

        const mediaItems =
          mediaItemIds.length > 0
            ? await ctx.db
                .selectFrom('media_items')
                .selectAll()
                .where('id', 'in', mediaItemIds)
                .execute()
            : [];

        const mediaItemMap = new Map(mediaItems.map((item) => [item.id, item]));

        const itemsWithMediaData = uniqueInProgressItems.map((item) => ({
          ...item,
          mediaItem: item.mediaItemId
            ? mediaItemMap.get(item.mediaItemId)
            : undefined,
        }));

        res.json({
          items: itemsWithMediaData,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch in-progress items');
        res.status(500).json({ error: 'Failed to fetch in-progress items' });
      }
    })
  );

  return router;
};
