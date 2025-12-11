import express, { Request, Response } from 'express';
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import {
  AppCollectiveSocialFeedList,
  AppCollectiveSocialFeedListitem,
  AppCollectiveSocialFeedReview,
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

        // Get all user's reviews to check which items they've already reviewed
        const userReviews = await ctx.db
          .selectFrom('reviews')
          .select(['mediaItemId', 'rating'])
          .where('authorDid', '=', agent.did!)
          .execute();

        const reviewedMediaItems = new Map(
          userReviews.map((r) => [r.mediaItemId, r.rating])
        );

        // Get all user's in-progress items across all lists
        const allUserItems = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
        });

        const inProgressMediaItems = new Set(
          allUserItems.data.records
            .filter(
              (record: any) =>
                record.value.status === 'in-progress' &&
                record.value.mediaItemId
            )
            .map((record: any) => record.value.mediaItemId)
        );

        // Clone each item to the new list
        for (const sourceItem of sourceItems) {
          const sourceItemData = sourceItem.value as any;
          const mediaItemId = sourceItemData.mediaItemId;

          // Determine status:
          // 1. If user has reviewed this item, mark as completed
          // 2. If user has this item in-progress somewhere, keep it in-progress
          // 3. Otherwise, preserve the original status
          let status = sourceItemData.status || 'want';
          if (mediaItemId && reviewedMediaItems.has(mediaItemId)) {
            status = 'completed';
          } else if (mediaItemId && inProgressMediaItems.has(mediaItemId)) {
            status = 'in-progress';
          }

          const newItemRecord: AppCollectiveSocialFeedListitem.Record = {
            $type: 'app.collectivesocial.feed.listitem',
            list: newListUri,
            title: sourceItemData.title,
            creator: sourceItemData.creator || undefined,
            description: sourceItemData.description || undefined,
            mediaType: sourceItemData.mediaType || 'book',
            mediaItemId: mediaItemId || undefined,
            status: status as any,
            order:
              sourceItemData.order !== undefined
                ? sourceItemData.order
                : undefined,
            // Don't copy review reference - that's personal to the original list
            review: undefined,
            // Copy recommendations
            recommendations: sourceItemData.recommendations || undefined,
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
                description: record.value.description || null,
                order:
                  record.value.order !== undefined ? record.value.order : 0,
                mediaType: record.value.mediaType || null,
                mediaItemId: record.value.mediaItemId || null,
                status: record.value.status || null,
                rating:
                  record.value.rating !== undefined
                    ? record.value.rating
                    : null,
                review: record.value.review || null,
                notes: record.value.notes || null,
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
                    length: mediaItem.length,
                    totalReviews: mediaItem.totalReviews,
                    totalSaves: mediaItem.totalSaves,
                    averageRating: mediaItem.averageRating,
                  };
                }
              }

              return item;
            })
        );

        // Sort by order (descending - higher numbers first)
        items.sort((a, b) => (b.order || 0) - (a.order || 0));

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
        notes,
        description,
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

        // Check if item already exists in the list
        const existingItemsResponse =
          await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.listitem',
          });

        const existingItem = existingItemsResponse.data.records.find(
          (record: any) => {
            const itemData = record.value as any;
            if (itemData.list !== listUri) return false;

            // Match by mediaItemId if provided, otherwise by title
            if (mediaItemId) {
              return itemData.mediaItemId === mediaItemId;
            } else {
              return itemData.title === title;
            }
          }
        );

        // Build recommendations array
        const newRecommendations = [];
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

            newRecommendations.push({
              did: did,
              suggestedAt: suggestedAt,
            });
          }
        }

        // If item exists, update it by merging information
        if (existingItem) {
          const existingData = existingItem.value as any;
          const existingRecommendations = existingData.recommendations || [];
          const oldStatus = existingData.status;

          // Merge recommendations, avoiding duplicates by DID
          const mergedRecommendations = [...existingRecommendations];
          for (const newRec of newRecommendations) {
            const alreadyExists = mergedRecommendations.some(
              (existing: any) => existing.did === newRec.did
            );
            if (!alreadyExists) {
              mergedRecommendations.push(newRec);
            }
          }

          // Extract rkey from existing item URI
          const rkeyMatch = existingItem.uri.match(/\/([^\/]+)$/);
          if (!rkeyMatch) {
            return res.status(400).json({ error: 'Invalid existing item URI' });
          }
          const rkey = rkeyMatch[1];

          // Determine completedAt timestamp
          let completedAtValue = existingData.completedAt;
          if (status === 'completed' && completedAt) {
            completedAtValue = completedAt;
          } else if (status === 'completed' && !existingData.completedAt) {
            completedAtValue = new Date().toISOString();
          }

          // Update the record, keeping existing data but adding new information
          const updatedRecord: AppCollectiveSocialFeedListitem.Record = {
            ...existingData,
            // Update fields if new values provided, otherwise keep existing
            status: status || existingData.status,
            creator: creator || existingData.creator,
            description:
              description !== undefined
                ? description || undefined
                : existingData.description,
            completedAt: completedAtValue,
            recommendations:
              mergedRecommendations.length > 0
                ? mergedRecommendations
                : undefined,
          };

          await agent.api.com.atproto.repo.putRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.listitem',
            rkey: rkey,
            record: updatedRecord as any,
          });

          // Handle review database update
          if (
            review !== undefined &&
            rating !== undefined &&
            mediaItemId &&
            mediaType
          ) {
            // Check if review already exists
            const existingReview = await ctx.db
              .selectFrom('reviews')
              .select(['id', 'rating', 'review'])
              .where('authorDid', '=', agent.did!)
              .where('mediaItemId', '=', mediaItemId)
              .where('mediaType', '=', mediaType)
              .executeTakeFirst();

            const isNewReview = !existingReview;
            const oldRating = existingReview?.rating;

            if (review && review.trim()) {
              const now = new Date();

              // Create AT Protocol review record
              let reviewUri: string | null = null;
              try {
                const reviewRecord: AppCollectiveSocialFeedReview.Record = {
                  $type: 'app.collectivesocial.feed.review',
                  text: review.trim(),
                  rating: Number(rating),
                  mediaItemId: mediaItemId,
                  mediaType: mediaType as any,
                  listItem: existingItem.uri,
                  createdAt: now.toISOString(),
                  updatedAt: now.toISOString(),
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
                // Continue anyway - we'll store the review in the database without the URI
              }

              await ctx.db
                .insertInto('reviews')
                .values({
                  authorDid: agent.did!,
                  mediaItemId: mediaItemId,
                  mediaType: mediaType,
                  rating: Number(rating),
                  review: review.trim(),
                  listItemUri: existingItem.uri,
                  reviewUri: reviewUri,
                  createdAt: now,
                  updatedAt: now,
                } as any)
                .onConflict((oc) =>
                  oc
                    .columns(['authorDid', 'mediaItemId', 'mediaType'])
                    .doUpdateSet({
                      rating: Number(rating),
                      review: review.trim(),
                      reviewUri: reviewUri,
                      updatedAt: now,
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

                if (isNewReview) {
                  // Adding a new review - increment both ratings and reviews if text provided
                  const newTotalRatings = currentItem.totalRatings + 1;
                  const hasTextReview = review && review.trim().length > 0;
                  const newTotalReviews = hasTextReview
                    ? currentItem.totalReviews + 1
                    : currentItem.totalReviews;
                  const newAverage =
                    (currentAvg * currentItem.totalRatings + Number(rating)) /
                    newTotalRatings;

                  // Increment the specific rating count
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

                  // Create feed event for new review
                  try {
                    const profile = await agent.getProfile({
                      actor: agent.did!,
                    });
                    const userHandle = profile.data.handle;
                    const eventName = `${userHandle} reviewed "${title}"`;

                    await ctx.db
                      .insertInto('feed_events')
                      .values({
                        eventName,
                        mediaLink: `/items/${mediaItemId}`,
                        userDid: agent.did!,
                        createdAt: new Date(),
                      } as any)
                      .execute();
                  } catch (err) {
                    ctx.logger.error(
                      { err },
                      'Failed to create review feed event'
                    );
                  }
                } else {
                  // Updating existing review
                  const hadTextReview =
                    existingReview?.review &&
                    existingReview.review.trim().length > 0;
                  const hasTextReview = review && review.trim().length > 0;
                  const reviewCountChange =
                    !hadTextReview && hasTextReview
                      ? 1
                      : hadTextReview && !hasTextReview
                        ? -1
                        : 0;

                  if (oldRating !== Number(rating)) {
                    // Rating changed - recalculate average and update rating distribution
                    const newAverage =
                      (currentAvg * currentItem.totalRatings -
                        Number(oldRating) +
                        Number(rating)) /
                      currentItem.totalRatings;

                    const oldRatingColumn = getRatingColumnName(
                      Number(oldRating)
                    );
                    const newRatingColumn = getRatingColumnName(Number(rating));

                    await ctx.db
                      .updateTable('media_items')
                      .set({
                        totalReviews:
                          currentItem.totalReviews + reviewCountChange,
                        averageRating: parseFloat(newAverage.toFixed(2)),
                        [oldRatingColumn]: sql`"${sql.raw(oldRatingColumn)}" - 1`,
                        [newRatingColumn]: sql`"${sql.raw(newRatingColumn)}" + 1`,
                        updatedAt: new Date(),
                      } as any)
                      .where('id', '=', mediaItemId)
                      .execute();
                  } else if (reviewCountChange !== 0) {
                    // Only text review status changed
                    await ctx.db
                      .updateTable('media_items')
                      .set({
                        totalReviews:
                          currentItem.totalReviews + reviewCountChange,
                        updatedAt: new Date(),
                      })
                      .where('id', '=', mediaItemId)
                      .execute();
                  }
                }
              }
            } else if (review === '' || review === null) {
              // Delete review and update stats
              await ctx.db
                .deleteFrom('reviews')
                .where('authorDid', '=', agent.did!)
                .where('mediaItemId', '=', mediaItemId)
                .where('mediaType', '=', mediaType)
                .execute();

              if (existingReview && oldRating !== undefined) {
                // Decrement totalRatings, totalReviews, rating distribution, and recalculate average
                const currentItem = await ctx.db
                  .selectFrom('media_items')
                  .select(['totalRatings', 'totalReviews', 'averageRating'])
                  .where('id', '=', mediaItemId)
                  .executeTakeFirst();

                if (currentItem && currentItem.totalRatings > 0) {
                  const newTotalRatings = currentItem.totalRatings - 1;
                  const hadTextReview =
                    existingReview.review &&
                    existingReview.review.trim().length > 0;
                  const newTotalReviews = hadTextReview
                    ? currentItem.totalReviews - 1
                    : currentItem.totalReviews;
                  const ratingColumn = getRatingColumnName(Number(oldRating));

                  if (newTotalRatings === 0) {
                    await ctx.db
                      .updateTable('media_items')
                      .set({
                        totalRatings: 0,
                        totalReviews: 0,
                        averageRating: 0,
                        [ratingColumn]: sql`"${sql.raw(ratingColumn)}" - 1`,
                        updatedAt: new Date(),
                      } as any)
                      .where('id', '=', mediaItemId)
                      .execute();
                  } else {
                    const currentAvg = currentItem.averageRating
                      ? parseFloat(currentItem.averageRating.toString())
                      : 0;
                    const newAverage =
                      (currentAvg * currentItem.totalRatings -
                        Number(oldRating)) /
                      newTotalRatings;

                    await ctx.db
                      .updateTable('media_items')
                      .set({
                        totalRatings: newTotalRatings,
                        totalReviews: newTotalReviews,
                        averageRating: parseFloat(newAverage.toFixed(2)),
                        [ratingColumn]: sql`"${sql.raw(ratingColumn)}" - 1`,
                        updatedAt: new Date(),
                      } as any)
                      .where('id', '=', mediaItemId)
                      .execute();
                  }
                }
              }
            }
          } // Create feed event for status changes
          if (status && status !== oldStatus && mediaType === 'book') {
            try {
              const profile = await agent.getProfile({ actor: agent.did! });
              const userHandle = profile.data.handle;
              const now = new Date();
              let eventName = '';

              if (status === 'want' && !oldStatus) {
                // Only create "wants to read" event for new items
                eventName = `${userHandle} wants to read "${title}"`;
              } else if (
                status === 'in-progress' &&
                oldStatus !== 'in-progress'
              ) {
                eventName = `${userHandle} started reading "${title}"`;
              } else if (status === 'completed' && oldStatus !== 'completed') {
                eventName = `${userHandle} finished reading "${title}"`;
              }

              if (eventName) {
                await ctx.db
                  .insertInto('feed_events')
                  .values({
                    eventName,
                    mediaLink: mediaItemId ? `/items/${mediaItemId}` : null,
                    userDid: agent.did!,
                    createdAt: now,
                  } as any)
                  .execute();
              }
            } catch (err) {
              ctx.logger.error({ err }, 'Failed to create feed event');
            }
          }

          return res.json({
            uri: existingItem.uri,
            cid: existingItem.cid,
            updated: true,
            title: updatedRecord.title,
            status: updatedRecord.status,
            mediaType: updatedRecord.mediaType,
            creator: updatedRecord.creator,
            mediaItemId,
            recommendations: mergedRecommendations,
          });
        }

        // Item doesn't exist, create new one
        // Calculate the highest order in the current list and add 1
        const existingItems = existingItemsResponse.data.records
          .filter((record: any) => record.value.list === listUri)
          .map((record: any) => record.value.order || 0);
        const maxOrder =
          existingItems.length > 0 ? Math.max(...existingItems) : 0;
        const newOrder = maxOrder + 1;

        const now = new Date();
        const listItemRecord: AppCollectiveSocialFeedListitem.Record = {
          $type: 'app.collectivesocial.feed.listitem',
          list: listUri,
          title,
          creator: creator || undefined,
          description: description || undefined,
          order: newOrder,
          mediaItemId: mediaItemId || undefined,
          mediaType: mediaType || undefined,
          status: status || undefined,
          completedAt:
            status === 'completed'
              ? completedAt || now.toISOString()
              : undefined,
          recommendations:
            newRecommendations.length > 0 ? newRecommendations : undefined,
          createdAt: now.toISOString(),
        };

        // Create the record in the user's repo
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          record: listItemRecord as any,
        });

        // Increment totalSaves for this media item
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

        // If a public review is provided with rating and mediaItemId, save to database
        if (
          review &&
          review.trim() &&
          rating !== undefined &&
          mediaItemId &&
          mediaType
        ) {
          // Check if review already exists
          const existingReview = await ctx.db
            .selectFrom('reviews')
            .select(['id', 'rating'])
            .where('authorDid', '=', agent.did!)
            .where('mediaItemId', '=', mediaItemId)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();

          const isNewReview = !existingReview;
          const oldRating = existingReview?.rating;
          const now = new Date();

          // Create AT Protocol review record
          let reviewUri: string | null = null;
          try {
            const reviewRecord: AppCollectiveSocialFeedReview.Record = {
              $type: 'app.collectivesocial.feed.review',
              text: review.trim(),
              rating: Number(rating),
              mediaItemId: mediaItemId,
              mediaType: mediaType as any,
              listItem: response.data.uri,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
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
            // Continue anyway - we'll store the review in the database without the URI
          }

          // Upsert review - one review per user per media item
          await ctx.db
            .insertInto('reviews')
            .values({
              authorDid: agent.did!,
              mediaItemId: mediaItemId,
              mediaType: mediaType,
              rating: Number(rating),
              review: review.trim(),
              listItemUri: response.data.uri,
              reviewUri: reviewUri,
              createdAt: now,
              updatedAt: now,
            } as any)
            .onConflict((oc) =>
              oc
                .columns(['authorDid', 'mediaItemId', 'mediaType'])
                .doUpdateSet({
                  rating: Number(rating),
                  review: review.trim(),
                  listItemUri: response.data.uri,
                  reviewUri: reviewUri,
                  updatedAt: now,
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

            if (isNewReview) {
              // Adding a new review - increment both ratings and reviews
              const newTotalRatings = currentItem.totalRatings + 1;
              const newTotalReviews = currentItem.totalReviews + 1;
              const newAverage =
                (currentAvg * currentItem.totalRatings + Number(rating)) /
                newTotalRatings;

              // Increment the specific rating count
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

              // Create feed event for new review
              try {
                const profile = await agent.getProfile({ actor: agent.did! });
                const userHandle = profile.data.handle;
                const eventName = `${userHandle} reviewed "${title}"`;

                await ctx.db
                  .insertInto('feed_events')
                  .values({
                    eventName,
                    mediaLink: `/items/${mediaItemId}`,
                    userDid: agent.did!,
                    createdAt: new Date(),
                  } as any)
                  .execute();
              } catch (err) {
                ctx.logger.error({ err }, 'Failed to create review feed event');
              }
            } else if (oldRating !== Number(rating)) {
              // Updating existing review rating
              const newAverage =
                (currentAvg * currentItem.totalRatings -
                  Number(oldRating) +
                  Number(rating)) /
                currentItem.totalRatings;

              const oldRatingColumn = getRatingColumnName(Number(oldRating));
              const newRatingColumn = getRatingColumnName(Number(rating));

              await ctx.db
                .updateTable('media_items')
                .set({
                  averageRating: parseFloat(newAverage.toFixed(2)),
                  [oldRatingColumn]: sql`"${sql.raw(oldRatingColumn)}" - 1`,
                  [newRatingColumn]: sql`"${sql.raw(newRatingColumn)}" + 1`,
                  updatedAt: new Date(),
                } as any)
                .where('id', '=', mediaItemId)
                .execute();
            }
          }
        }

        // Create feed event for new items with status (books only)
        if (status && mediaType === 'book') {
          try {
            const profile = await agent.getProfile({ actor: agent.did! });
            const userHandle = profile.data.handle;
            let eventName = '';

            if (status === 'want') {
              eventName = `${userHandle} wants to read "${title}"`;
            } else if (status === 'in-progress') {
              eventName = `${userHandle} started reading "${title}"`;
            } else if (status === 'completed') {
              eventName = `${userHandle} finished reading "${title}"`;
            }

            if (eventName) {
              await ctx.db
                .insertInto('feed_events')
                .values({
                  eventName,
                  mediaLink: mediaItemId ? `/items/${mediaItemId}` : null,
                  userDid: agent.did!,
                  createdAt: now,
                } as any)
                .execute();
            }
          } catch (err) {
            ctx.logger.error({ err }, 'Failed to create feed event');
          }
        }

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          created: true,
          title,
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

      const { status, rating, review, notes } = req.body;

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
          collection: 'app.collectivesocial.feed.listitem',
        });

        const itemRecord = itemsResponse.data.records.find(
          (record: any) => record.uri === itemUri
        );

        if (!itemRecord) {
          return res.status(404).json({ error: 'Item not found' });
        }

        const currentData = itemRecord.value as any;
        const mediaItemId = currentData.mediaItemId;
        const mediaType = currentData.mediaType;

        // Get old rating from database reviews table
        const existingReview = await ctx.db
          .selectFrom('reviews')
          .select(['id', 'rating'])
          .where('authorDid', '=', agent.did!)
          .where('mediaItemId', '=', mediaItemId || '')
          .where('mediaType', '=', mediaType || '')
          .executeTakeFirst();
        const oldRating = existingReview?.rating;
        const isNewReview = !existingReview;

        // Extract rkey from itemUri
        const rkeyMatch = itemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
          return res.status(400).json({ error: 'Invalid item URI' });
        }
        const rkey = rkeyMatch[1];

        // Update the record (status can be updated, rating/review/notes handled separately)
        const updatedRecord: AppCollectiveSocialFeedListitem.Record = {
          ...currentData,
          ...(status !== undefined && { status }),
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.listitem',
          rkey: rkey,
          record: updatedRecord as any,
        });

        // If public review is provided/updated with rating and mediaItemId, upsert to database
        if (review !== undefined && rating !== undefined && mediaItemId) {
          const mediaType = currentData.mediaType;

          if (review && review.trim() && mediaType) {
            const now = new Date();

            // Create AT Protocol review record
            let reviewUri: string | null = null;
            try {
              const reviewRecord: AppCollectiveSocialFeedReview.Record = {
                $type: 'app.collectivesocial.feed.review',
                text: review.trim(),
                rating: Number(rating),
                mediaItemId: mediaItemId,
                mediaType: mediaType as any,
                listItem: itemUri,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
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
              // Continue anyway - we'll store the review in the database without the URI
            }

            // Upsert review
            await ctx.db
              .insertInto('reviews')
              .values({
                authorDid: agent.did!,
                mediaItemId: mediaItemId,
                mediaType: mediaType,
                rating: Number(rating),
                review: review.trim(),
                listItemUri: itemUri,
                reviewUri: reviewUri,
                createdAt: now,
                updatedAt: now,
              } as any)
              .onConflict((oc) =>
                oc
                  .columns(['authorDid', 'mediaItemId', 'mediaType'])
                  .doUpdateSet({
                    rating: Number(rating),
                    review: review.trim(),
                    reviewUri: reviewUri,
                    updatedAt: now,
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

              if (isNewReview) {
                // Adding a new review - increment both ratings and reviews
                const newTotalRatings = currentItem.totalRatings + 1;
                const newTotalReviews = currentItem.totalReviews + 1;
                const newAverage =
                  (currentAvg * currentItem.totalRatings + Number(rating)) /
                  newTotalRatings;

                // Increment the specific rating count
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

                // Create feed event for new review
                try {
                  const profile = await agent.getProfile({ actor: agent.did! });
                  const userHandle = profile.data.handle;
                  const title = currentData.title;
                  const eventName = `${userHandle} reviewed "${title}"`;

                  await ctx.db
                    .insertInto('feed_events')
                    .values({
                      eventName,
                      mediaLink: `/items/${mediaItemId}`,
                      userDid: agent.did!,
                      createdAt: new Date(),
                    } as any)
                    .execute();
                } catch (err) {
                  ctx.logger.error(
                    { err },
                    'Failed to create review feed event'
                  );
                }
              } else if (oldRating !== Number(rating)) {
                // Updating existing review rating
                const newAverage =
                  (currentAvg * currentItem.totalRatings -
                    Number(oldRating) +
                    Number(rating)) /
                  currentItem.totalRatings;

                const oldRatingColumn = getRatingColumnName(Number(oldRating));
                const newRatingColumn = getRatingColumnName(Number(rating));

                await ctx.db
                  .updateTable('media_items')
                  .set({
                    averageRating: parseFloat(newAverage.toFixed(2)),
                    [oldRatingColumn]: sql`"${sql.raw(oldRatingColumn)}" - 1`,
                    [newRatingColumn]: sql`"${sql.raw(newRatingColumn)}" + 1`,
                    updatedAt: new Date(),
                  })
                  .where('id', '=', mediaItemId)
                  .execute();
              }
            }
          } else if (review === '' || review === null) {
            // Delete review and update stats if explicitly cleared
            await ctx.db
              .deleteFrom('reviews')
              .where('authorDid', '=', agent.did!)
              .where('mediaItemId', '=', mediaItemId)
              .where('mediaType', '=', mediaType)
              .execute();

            if (existingReview && oldRating !== undefined) {
              // Decrement totalReviews and recalculate average
              const currentItem = await ctx.db
                .selectFrom('media_items')
                .select(['totalReviews', 'averageRating'])
                .where('id', '=', mediaItemId)
                .executeTakeFirst();

              if (currentItem && currentItem.totalReviews > 0) {
                const newTotalReviews = currentItem.totalReviews - 1;
                if (newTotalReviews === 0) {
                  await ctx.db
                    .updateTable('media_items')
                    .set({
                      totalReviews: 0,
                      averageRating: 0,
                      updatedAt: new Date(),
                    })
                    .where('id', '=', mediaItemId)
                    .execute();
                } else {
                  const currentAvg = currentItem.averageRating
                    ? parseFloat(currentItem.averageRating.toString())
                    : 0;
                  const newAverage =
                    (currentAvg * currentItem.totalReviews -
                      Number(oldRating)) /
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
                }
              }
            }
          }
        }

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
          collection: 'app.collectivesocial.feed.listitem',
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
          collection: 'app.collectivesocial.feed.listitem',
          rkey: rkey,
        });

        const itemData = itemRecord.value as any;

        // Decrement totalSaves for this media item
        if (itemData.mediaItemId) {
          await ctx.db
            .updateTable('media_items')
            .set((eb) => ({
              totalSaves: eb('totalSaves', '-', 1),
              updatedAt: new Date(),
            }))
            .where('id', '=', itemData.mediaItemId)
            .execute();
        }

        // If the item had a rating, update the aggregated review stats
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
  router.get(
    '/public/:did/in-progress',
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
        // Get all public collections for this user
        const collectionsResponse =
          await queryAgent.api.com.atproto.repo.listRecords({
            repo: did,
            collection: 'app.collectivesocial.feed.list',
          });

        // Filter to only public collections
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

        // Filter to in-progress items from public collections
        const inProgressItems = itemsResponse.data.records
          .filter((record: any) => {
            const listUri = record.value.list;
            const status = record.value.status;
            return (
              publicCollectionUris.includes(listUri) && status === 'in-progress'
            );
          })
          .map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            title: record.value.title,
            creator: record.value.creator || null,
            mediaType: record.value.mediaType,
            mediaItemId: record.value.mediaItemId || null,
            status: record.value.status,
            rating: record.value.rating || null,
            review: record.value.review || null,
            notes: record.value.notes || null,
            completedAt: record.value.completedAt || null,
            createdAt: record.value.createdAt,
            listUri: record.value.list,
          }));

        // Fetch media items data for items that have mediaItemId
        const mediaItemIds = inProgressItems
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

        // Create a map for quick lookup
        const mediaItemMap = new Map(mediaItems.map((item) => [item.id, item]));

        // Attach media item data to list items
        const itemsWithMediaData = inProgressItems.map((item) => ({
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
