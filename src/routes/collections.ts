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
          visibility: record.visibility,
          purpose: record.purpose,
          isDefault: record.isDefault || false,
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
                    totalReviews: mediaItem.totalReviews,
                    totalSaves: mediaItem.totalSaves,
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
              await ctx.db
                .insertInto('reviews')
                .values({
                  authorDid: agent.did!,
                  mediaItemId: mediaItemId,
                  mediaType: mediaType,
                  rating: Number(rating),
                  review: review.trim(),
                  listItemUri: existingItem.uri,
                  reviewUri: null, // Will be updated when AT Protocol review record is created
                  createdAt: now,
                  updatedAt: now,
                } as any)
                .onConflict((oc) =>
                  oc
                    .columns(['authorDid', 'mediaItemId', 'mediaType'])
                    .doUpdateSet({
                      rating: Number(rating),
                      review: review.trim(),
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

                  await ctx.db
                    .updateTable('media_items')
                    .set({
                      totalRatings: newTotalRatings,
                      totalReviews: newTotalReviews,
                      averageRating: parseFloat(newAverage.toFixed(2)),
                      updatedAt: new Date(),
                    })
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
                    // Rating changed - recalculate average
                    const newAverage =
                      (currentAvg * currentItem.totalRatings -
                        Number(oldRating) +
                        Number(rating)) /
                      currentItem.totalRatings;

                    await ctx.db
                      .updateTable('media_items')
                      .set({
                        totalReviews:
                          currentItem.totalReviews + reviewCountChange,
                        averageRating: parseFloat(newAverage.toFixed(2)),
                        updatedAt: new Date(),
                      })
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
        const now = new Date();
        const listItemRecord: AppCollectiveSocialFeedListitem.Record = {
          $type: 'app.collectivesocial.feed.listitem',
          list: listUri,
          title,
          creator: creator || undefined,
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
              reviewUri: null, // Will be updated when AT Protocol review record is created
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
                  updatedAt: now,
                })
            )
            .execute();

          // Update aggregated stats
          const currentItem = await ctx.db
            .selectFrom('media_items')
            .select(['totalReviews', 'averageRating'])
            .where('id', '=', mediaItemId)
            .executeTakeFirst();

          if (currentItem) {
            const currentAvg = currentItem.averageRating
              ? parseFloat(currentItem.averageRating.toString())
              : 0;

            if (isNewReview) {
              // Adding a new review
              const newTotalReviews = currentItem.totalReviews + 1;
              const newAverage =
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

      const { rating, review, notes } = req.body;

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

        // Update the record (rating, review, notes are now handled separately)
        const updatedRecord: AppCollectiveSocialFeedListitem.Record = {
          ...currentData,
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
                reviewUri: null, // Will be updated when AT Protocol review record is created
                createdAt: now,
                updatedAt: now,
              } as any)
              .onConflict((oc) =>
                oc
                  .columns(['authorDid', 'mediaItemId', 'mediaType'])
                  .doUpdateSet({
                    rating: Number(rating),
                    review: review.trim(),
                    updatedAt: now,
                  })
              )
              .execute();

            // Update aggregated stats
            const currentItem = await ctx.db
              .selectFrom('media_items')
              .select(['totalReviews', 'averageRating'])
              .where('id', '=', mediaItemId)
              .executeTakeFirst();

            if (currentItem) {
              const currentAvg = currentItem.averageRating
                ? parseFloat(currentItem.averageRating.toString())
                : 0;

              if (isNewReview) {
                // Adding a new review
                const newTotalReviews = currentItem.totalReviews + 1;
                const newAverage =
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

  return router;
};
