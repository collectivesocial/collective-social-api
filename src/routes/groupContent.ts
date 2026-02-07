/**
 * Group content routes — lists, items, segments, posts, reactions
 * for community book clubs and shared reading lists.
 *
 * All routes are mounted at /groups/:communityDid/...
 * and require authenticated membership via the groupAuth middleware.
 */

import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import {
  requireGroupMember,
  requireGroupAdmin,
  GroupAuthRequest,
} from '../middleware/groupAuth';
import * as opensocial from '../services/opensocial';
import {
  createNotification,
  notifyAllMembers,
  notifyUsers,
} from '../services/notifications';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router({ mergeParams: true });

  const memberOnly = requireGroupMember(ctx);
  const adminOnly = [requireGroupMember(ctx), requireGroupAdmin(ctx)];

  // ═══════════════════════════════════════════════════════════════
  // LISTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/lists
   * List all shared lists for a community.
   */
  router.get(
    '/lists',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;

      const lists = await ctx.db
        .selectFrom('group_lists')
        .selectAll()
        .where('communityDid', '=', communityDid)
        .orderBy('createdAt', 'desc')
        .execute();

      return res.json({ lists });
    })
  );

  /**
   * GET /groups/:communityDid/lists/:listId
   * Get a single list with its items.
   */
  router.get(
    '/lists/:listId',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const listId = Number(req.params.listId);

      const list = await ctx.db
        .selectFrom('group_lists')
        .selectAll()
        .where('id', '=', listId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      const items = await ctx.db
        .selectFrom('group_list_items')
        .selectAll()
        .where('listId', '=', listId)
        .orderBy('order', 'asc')
        .execute();

      return res.json({ list, items });
    })
  );

  /**
   * POST /groups/:communityDid/lists
   * Create a new shared list. Any member can create.
   *
   * Body: { name, description?, purpose?, segmentType? }
   */
  router.post(
    '/lists',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { name, description, purpose, segmentType } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }

      const now = new Date().toISOString();

      // Write to community PDS
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.list',
        { name, description, purpose, segmentType, createdBy: userDid, createdAt: now }
      );

      const rkey = pdsRecord.uri.split('/').pop()!;

      // Index in Postgres
      const inserted = await ctx.db
        .insertInto('group_lists')
        .values({
          uri: pdsRecord.uri,
          rkey,
          communityDid,
          name,
          description: description || null,
          purpose: purpose || null,
          segmentType: segmentType || null,
          createdBy: userDid,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Notify members
      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_list', {
        subjectUri: pdsRecord.uri,
        subjectType: 'list',
        message: `created a new list: ${name}`,
      });

      return res.json({ list: inserted });
    })
  );

  /**
   * PUT /groups/:communityDid/lists/:listId
   * Update a list. Admin only.
   *
   * Body: { name?, description?, purpose?, segmentType? }
   */
  router.put(
    '/lists/:listId',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const listId = Number(req.params.listId);
      const { name, description, purpose, segmentType } = req.body;

      const list = await ctx.db
        .selectFrom('group_lists')
        .selectAll()
        .where('id', '=', listId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      // Update in PDS
      await opensocial.updateCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.list',
        list.rkey,
        {
          name: name ?? list.name,
          description: description ?? list.description,
          purpose: purpose ?? list.purpose,
          segmentType: segmentType ?? list.segmentType,
          createdBy: list.createdBy,
          createdAt: list.createdAt.toISOString(),
        }
      );

      // Update in Postgres
      const updated = await ctx.db
        .updateTable('group_lists')
        .set({
          name: name ?? list.name,
          description: description !== undefined ? description : list.description,
          purpose: purpose !== undefined ? purpose : list.purpose,
          segmentType: segmentType !== undefined ? segmentType : list.segmentType,
          updatedAt: new Date(),
        })
        .where('id', '=', listId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return res.json({ list: updated });
    })
  );

  /**
   * DELETE /groups/:communityDid/lists/:listId
   * Delete a list and all its items/segments. Admin only.
   */
  router.delete(
    '/lists/:listId',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const listId = Number(req.params.listId);

      const list = await ctx.db
        .selectFrom('group_lists')
        .selectAll()
        .where('id', '=', listId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      // Delete from PDS
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.list',
        list.rkey
      );

      // Cascading delete handles items, segments, posts via FK constraints
      await ctx.db
        .deleteFrom('group_lists')
        .where('id', '=', listId)
        .execute();

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // LIST ITEMS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/lists/:listId/items
   * Get all items in a list.
   */
  router.get(
    '/lists/:listId/items',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const listId = Number(req.params.listId);

      const items = await ctx.db
        .selectFrom('group_list_items')
        .selectAll()
        .where('listId', '=', listId)
        .where('communityDid', '=', communityDid)
        .orderBy('order', 'asc')
        .execute();

      return res.json({ items });
    })
  );

  /**
   * POST /groups/:communityDid/lists/:listId/items
   * Add an item to a list. Any member can add.
   *
   * Body: { title, creator?, mediaItemId?, mediaType, order? }
   */
  router.post(
    '/lists/:listId/items',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const listId = Number(req.params.listId);
      const { title, creator, mediaItemId, mediaType, order } = req.body;

      if (!title || !mediaType) {
        return res.status(400).json({ error: 'title and mediaType are required' });
      }

      const list = await ctx.db
        .selectFrom('group_lists')
        .selectAll()
        .where('id', '=', listId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      // Determine order
      const lastItem = await ctx.db
        .selectFrom('group_list_items')
        .select('order')
        .where('listId', '=', listId)
        .orderBy('order', 'desc')
        .executeTakeFirst();
      const itemOrder = order ?? (lastItem ? lastItem.order + 1 : 0);

      const now = new Date().toISOString();

      // Write to PDS
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.listitem',
        {
          listUri: list.uri,
          title,
          creator,
          mediaItemId,
          mediaType,
          order: itemOrder,
          addedBy: userDid,
          createdAt: now,
        }
      );

      const rkey = pdsRecord.uri.split('/').pop()!;

      const inserted = await ctx.db
        .insertInto('group_list_items')
        .values({
          uri: pdsRecord.uri,
          rkey,
          communityDid,
          listId,
          listUri: list.uri,
          title,
          creator: creator || null,
          mediaItemId: mediaItemId || null,
          mediaType,
          order: itemOrder,
          status: 'not-started',
          statusUri: null,
          addedBy: userDid,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Notify members
      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_item', {
        subjectUri: pdsRecord.uri,
        subjectType: 'listitem',
        message: `added "${title}" to ${list.name}`,
      });

      return res.json({ item: inserted });
    })
  );

  /**
   * PUT /groups/:communityDid/items/:itemId/status
   * Set the group status of a list item. Admin only.
   *
   * Body: { status: 'not-started' | 'in-progress' | 'completed' }
   */
  router.put(
    '/items/:itemId/status',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const itemId = Number(req.params.itemId);
      const { status } = req.body;

      const validStatuses = ['not-started', 'in-progress', 'completed'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      }

      const item = await ctx.db
        .selectFrom('group_list_items')
        .selectAll()
        .where('id', '=', itemId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const now = new Date().toISOString();

      // Create or update the status record in PDS
      let statusUri = item.statusUri;
      if (statusUri) {
        const statusRkey = statusUri.split('/').pop()!;
        const result = await opensocial.updateCommunityRecord(
          communityDid,
          userDid,
          'app.collectivesocial.group.listitem.status',
          statusRkey,
          { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now }
        );
        statusUri = result.uri;
      } else {
        const result = await opensocial.createCommunityRecord(
          communityDid,
          userDid,
          'app.collectivesocial.group.listitem.status',
          { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now }
        );
        statusUri = result.uri;
      }

      const updated = await ctx.db
        .updateTable('group_list_items')
        .set({ status, statusUri, updatedAt: new Date() })
        .where('id', '=', itemId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Notify all members about status change
      await notifyAllMembers(ctx.db, communityDid, userDid, 'status_change', {
        subjectUri: item.uri,
        subjectType: 'listitem',
        message: `marked "${item.title}" as ${status}`,
      });

      return res.json({ item: updated });
    })
  );

  /**
   * DELETE /groups/:communityDid/items/:itemId
   * Remove an item from a list. Admin only.
   */
  router.delete(
    '/items/:itemId',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const itemId = Number(req.params.itemId);

      const item = await ctx.db
        .selectFrom('group_list_items')
        .selectAll()
        .where('id', '=', itemId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Delete from PDS
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.listitem',
        item.rkey
      );

      // Cascading delete handles segments, posts via FK constraints
      await ctx.db
        .deleteFrom('group_list_items')
        .where('id', '=', itemId)
        .execute();

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // SEGMENTS (reading assignments)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/items/:itemId/segments
   * List all segments for a list item.
   */
  router.get(
    '/items/:itemId/segments',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const itemId = Number(req.params.itemId);

      const segments = await ctx.db
        .selectFrom('group_segments')
        .selectAll()
        .where('listItemId', '=', itemId)
        .where('communityDid', '=', communityDid)
        .orderBy('order', 'asc')
        .execute();

      return res.json({ segments });
    })
  );

  /**
   * POST /groups/:communityDid/items/:itemId/segments
   * Create a reading assignment segment. Admin only.
   *
   * Body: {
   *   label, segmentType?,
   *   startPage?, endPage?, startPercent?, endPercent?,
   *   startChapter?, endChapter?,
   *   assignedDate?, order?
   * }
   *
   * When segmentType is "chapters" and the media item has a chapterMap,
   * page and percent ranges are auto-derived.
   */
  router.post(
    '/items/:itemId/segments',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const itemId = Number(req.params.itemId);

      const item = await ctx.db
        .selectFrom('group_list_items')
        .selectAll()
        .where('id', '=', itemId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      let {
        label, segmentType,
        startPage, endPage, startPercent, endPercent,
        startChapter, endChapter,
        assignedDate, order,
      } = req.body;

      if (!label) {
        return res.status(400).json({ error: 'label is required' });
      }

      // Auto-derive page/percent from chapter map if available
      if (segmentType === 'chapters' && startChapter != null && item.mediaItemId) {
        const mediaItem = await ctx.db
          .selectFrom('media_items')
          .select(['chapterMap', 'length'])
          .where('id', '=', item.mediaItemId)
          .executeTakeFirst();

        if (mediaItem?.chapterMap) {
          const map = typeof mediaItem.chapterMap === 'string'
            ? JSON.parse(mediaItem.chapterMap)
            : mediaItem.chapterMap;

          const startCh = map.chapters?.find((c: any) => c.chapter === startChapter);
          const endCh = endChapter != null
            ? map.chapters?.find((c: any) => c.chapter === endChapter)
            : startCh;

          if (startCh) {
            startPage = startCh.startPage;
            endPage = endCh?.endPage ?? startCh.endPage;

            // Derive percent if total pages known
            const totalPages = mediaItem.length;
            if (totalPages && totalPages > 0) {
              startPercent = Math.round((startPage / totalPages) * 100);
              endPercent = Math.round((endPage / totalPages) * 100);
            }
          }
        }
      }

      // Determine order
      const lastSegment = await ctx.db
        .selectFrom('group_segments')
        .select('order')
        .where('listItemId', '=', itemId)
        .orderBy('order', 'desc')
        .executeTakeFirst();
      const segOrder = order ?? (lastSegment ? lastSegment.order + 1 : 0);

      const now = new Date().toISOString();

      // Write to PDS
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.segment',
        {
          listItemUri: item.uri,
          label,
          segmentType,
          startPage,
          endPage,
          startPercent,
          endPercent,
          startChapter,
          endChapter,
          assignedDate,
          order: segOrder,
          createdBy: userDid,
          createdAt: now,
        }
      );

      const rkey = pdsRecord.uri.split('/').pop()!;

      const inserted = await ctx.db
        .insertInto('group_segments')
        .values({
          uri: pdsRecord.uri,
          rkey,
          communityDid,
          listItemId: itemId,
          listItemUri: item.uri,
          label,
          segmentType: segmentType || null,
          startPage: startPage ?? null,
          endPage: endPage ?? null,
          startPercent: startPercent ?? null,
          endPercent: endPercent ?? null,
          startChapter: startChapter ?? null,
          endChapter: endChapter ?? null,
          assignedDate: assignedDate ? new Date(assignedDate) : null,
          order: segOrder,
          createdBy: userDid,
          createdAt: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Notify all members about new assignment
      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_segment', {
        subjectUri: pdsRecord.uri,
        subjectType: 'segment',
        message: `assigned new reading: ${label} for "${item.title}"${assignedDate ? ` due ${new Date(assignedDate).toLocaleDateString()}` : ''}`,
      });

      return res.json({ segment: inserted });
    })
  );

  /**
   * PUT /groups/:communityDid/segments/:segmentId
   * Update a segment. Admin only.
   */
  router.put(
    '/segments/:segmentId',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentId = Number(req.params.segmentId);

      const segment = await ctx.db
        .selectFrom('group_segments')
        .selectAll()
        .where('id', '=', segmentId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!segment) {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const {
        label, segmentType,
        startPage, endPage, startPercent, endPercent,
        startChapter, endChapter,
        assignedDate, order,
      } = req.body;

      // Update in PDS
      await opensocial.updateCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.segment',
        segment.rkey,
        {
          listItemUri: segment.listItemUri,
          label: label ?? segment.label,
          segmentType: segmentType ?? segment.segmentType,
          startPage: startPage ?? segment.startPage,
          endPage: endPage ?? segment.endPage,
          startPercent: startPercent ?? segment.startPercent,
          endPercent: endPercent ?? segment.endPercent,
          startChapter: startChapter ?? segment.startChapter,
          endChapter: endChapter ?? segment.endChapter,
          assignedDate: assignedDate ?? segment.assignedDate?.toISOString(),
          order: order ?? segment.order,
          createdBy: segment.createdBy,
          createdAt: segment.createdAt.toISOString(),
        }
      );

      const updated = await ctx.db
        .updateTable('group_segments')
        .set({
          label: label ?? segment.label,
          segmentType: segmentType !== undefined ? segmentType : segment.segmentType,
          startPage: startPage !== undefined ? startPage : segment.startPage,
          endPage: endPage !== undefined ? endPage : segment.endPage,
          startPercent: startPercent !== undefined ? startPercent : segment.startPercent,
          endPercent: endPercent !== undefined ? endPercent : segment.endPercent,
          startChapter: startChapter !== undefined ? startChapter : segment.startChapter,
          endChapter: endChapter !== undefined ? endChapter : segment.endChapter,
          assignedDate: assignedDate !== undefined ? (assignedDate ? new Date(assignedDate) : null) : segment.assignedDate,
          order: order ?? segment.order,
        })
        .where('id', '=', segmentId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return res.json({ segment: updated });
    })
  );

  /**
   * DELETE /groups/:communityDid/segments/:segmentId
   * Delete a segment. Admin only.
   */
  router.delete(
    '/segments/:segmentId',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentId = Number(req.params.segmentId);

      const segment = await ctx.db
        .selectFrom('group_segments')
        .selectAll()
        .where('id', '=', segmentId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!segment) {
        return res.status(404).json({ error: 'Segment not found' });
      }

      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.segment',
        segment.rkey
      );

      await ctx.db.deleteFrom('group_segments').where('id', '=', segmentId).execute();

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // POSTS (discussions)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/segments/:segmentId/posts
   * List all top-level posts for a segment, with nested replies.
   */
  router.get(
    '/segments/:segmentId/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentId = Number(req.params.segmentId);

      const allPosts = await ctx.db
        .selectFrom('group_posts')
        .selectAll()
        .where('segmentId', '=', segmentId)
        .where('communityDid', '=', communityDid)
        .orderBy('createdAt', 'asc')
        .execute();

      // Build threaded structure
      const topLevel = allPosts.filter((p) => !p.parentPostId);
      const replies = allPosts.filter((p) => p.parentPostId);

      const buildThread = (post: any): any => ({
        ...post,
        replies: replies
          .filter((r) => r.parentPostId === post.id)
          .map(buildThread),
      });

      const threads = topLevel.map(buildThread);

      return res.json({ posts: threads });
    })
  );

  /**
   * GET /groups/:communityDid/items/:itemId/posts
   * List all top-level posts for a list item (not tied to a specific segment).
   */
  router.get(
    '/items/:itemId/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const itemId = Number(req.params.itemId);

      const allPosts = await ctx.db
        .selectFrom('group_posts')
        .selectAll()
        .where('listItemId', '=', itemId)
        .where('communityDid', '=', communityDid)
        .orderBy('createdAt', 'asc')
        .execute();

      const topLevel = allPosts.filter((p) => !p.parentPostId);
      const replies = allPosts.filter((p) => p.parentPostId);

      const buildThread = (post: any): any => ({
        ...post,
        replies: replies
          .filter((r) => r.parentPostId === post.id)
          .map(buildThread),
      });

      const threads = topLevel.map(buildThread);

      return res.json({ posts: threads });
    })
  );

  /**
   * POST /groups/:communityDid/posts
   * Create a discussion post. Any member can post.
   *
   * Body: { text, segmentId?, listItemId?, parentPostId?, mentionedDids? }
   */
  router.post(
    '/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { text, segmentId, listItemId, parentPostId, mentionedDids } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'text is required' });
      }

      // Resolve URIs for the PDS record
      let segmentUri: string | null = null;
      let listItemUri: string | null = null;
      let parentPostUri: string | null = null;
      let resolvedListItemId: number | null = listItemId ?? null;

      if (segmentId) {
        const segment = await ctx.db
          .selectFrom('group_segments')
          .select(['uri', 'listItemId', 'listItemUri'])
          .where('id', '=', segmentId)
          .where('communityDid', '=', communityDid)
          .executeTakeFirst();
        if (!segment) {
          return res.status(404).json({ error: 'Segment not found' });
        }
        segmentUri = segment.uri;
        resolvedListItemId = segment.listItemId;
        listItemUri = segment.listItemUri;
      } else if (listItemId) {
        const item = await ctx.db
          .selectFrom('group_list_items')
          .select(['uri'])
          .where('id', '=', listItemId)
          .where('communityDid', '=', communityDid)
          .executeTakeFirst();
        if (!item) {
          return res.status(404).json({ error: 'List item not found' });
        }
        listItemUri = item.uri;
      }

      if (parentPostId) {
        const parent = await ctx.db
          .selectFrom('group_posts')
          .select(['uri'])
          .where('id', '=', parentPostId)
          .where('communityDid', '=', communityDid)
          .executeTakeFirst();
        if (!parent) {
          return res.status(404).json({ error: 'Parent post not found' });
        }
        parentPostUri = parent.uri;
      }

      const now = new Date().toISOString();

      // Write to PDS
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.post',
        {
          text,
          segmentUri,
          listItemUri,
          parentPostUri,
          authorDid: userDid,
          mentionedDids: mentionedDids || [],
          createdAt: now,
        }
      );

      const rkey = pdsRecord.uri.split('/').pop()!;

      const inserted = await ctx.db
        .insertInto('group_posts')
        .values({
          uri: pdsRecord.uri,
          rkey,
          communityDid,
          text,
          segmentUri,
          segmentId: segmentId || null,
          listItemUri,
          listItemId: resolvedListItemId,
          parentPostUri,
          parentPostId: parentPostId || null,
          authorDid: userDid,
          createdAt: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Notifications
      if (parentPostId) {
        // Notify the parent post author about the reply
        const parentPost = await ctx.db
          .selectFrom('group_posts')
          .select(['authorDid'])
          .where('id', '=', parentPostId)
          .executeTakeFirst();
        if (parentPost) {
          await createNotification(ctx.db, {
            communityDid,
            recipientDid: parentPost.authorDid,
            actorDid: userDid,
            type: 'reply',
            subjectUri: pdsRecord.uri,
            subjectType: 'post',
            message: `replied to your post`,
          });
        }
      } else {
        // Top-level post — notify all members
        await notifyAllMembers(ctx.db, communityDid, userDid, 'new_post', {
          subjectUri: pdsRecord.uri,
          subjectType: 'post',
          message: `posted in the discussion`,
        });
      }

      // Mention notifications
      if (mentionedDids?.length) {
        await notifyUsers(ctx.db, communityDid, userDid, mentionedDids, 'mention', {
          subjectUri: pdsRecord.uri,
          subjectType: 'post',
          message: `mentioned you in a post`,
        });
      }

      return res.json({ post: inserted });
    })
  );

  /**
   * DELETE /groups/:communityDid/posts/:postId
   * Delete a post. Author or admin can delete.
   */
  router.delete(
    '/posts/:postId',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid, isAdmin } = req.groupAuth!;
      const postId = Number(req.params.postId);

      const post = await ctx.db
        .selectFrom('group_posts')
        .selectAll()
        .where('id', '=', postId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Only the author or an admin can delete
      if (post.authorDid !== userDid && !isAdmin) {
        return res.status(403).json({ error: 'Only the author or an admin can delete this post' });
      }

      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.post',
        post.rkey
      );

      await ctx.db.deleteFrom('group_posts').where('id', '=', postId).execute();

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // REACTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/posts/:postId/reactions
   * Get all reactions on a post.
   */
  router.get(
    '/posts/:postId/reactions',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const postId = Number(req.params.postId);

      const reactions = await ctx.db
        .selectFrom('group_reactions')
        .selectAll()
        .where('postId', '=', postId)
        .where('communityDid', '=', communityDid)
        .execute();

      // Group by emoji
      const grouped: Record<string, { count: number; users: string[] }> = {};
      for (const r of reactions) {
        if (!grouped[r.emoji]) {
          grouped[r.emoji] = { count: 0, users: [] };
        }
        grouped[r.emoji].count++;
        grouped[r.emoji].users.push(r.authorDid);
      }

      return res.json({ reactions: grouped, raw: reactions });
    })
  );

  /**
   * POST /groups/:communityDid/posts/:postId/reactions
   * Toggle a reaction on a post. Any member can react.
   * Posting the same emoji again removes it.
   *
   * Body: { emoji }
   */
  router.post(
    '/posts/:postId/reactions',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const postId = Number(req.params.postId);
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ error: 'emoji is required' });
      }

      const post = await ctx.db
        .selectFrom('group_posts')
        .selectAll()
        .where('id', '=', postId)
        .where('communityDid', '=', communityDid)
        .executeTakeFirst();

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Check if reaction already exists (toggle off)
      const existing = await ctx.db
        .selectFrom('group_reactions')
        .selectAll()
        .where('postId', '=', postId)
        .where('authorDid', '=', userDid)
        .where('emoji', '=', emoji)
        .executeTakeFirst();

      if (existing) {
        // Remove reaction from PDS and DB
        await opensocial.deleteCommunityRecord(
          communityDid,
          userDid,
          'app.collectivesocial.group.reaction',
          existing.rkey
        );

        await ctx.db
          .deleteFrom('group_reactions')
          .where('id', '=', existing.id)
          .execute();

        return res.json({ action: 'removed', emoji });
      }

      // Create new reaction
      const now = new Date().toISOString();
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        'app.collectivesocial.group.reaction',
        { postUri: post.uri, emoji, authorDid: userDid, createdAt: now }
      );

      const rkey = pdsRecord.uri.split('/').pop()!;

      await ctx.db
        .insertInto('group_reactions')
        .values({
          uri: pdsRecord.uri,
          rkey,
          communityDid,
          postId,
          postUri: post.uri,
          emoji,
          authorDid: userDid,
          createdAt: new Date(),
        })
        .execute();

      // Notify post author about the reaction
      await createNotification(ctx.db, {
        communityDid,
        recipientDid: post.authorDid,
        actorDid: userDid,
        type: 'reaction',
        subjectUri: post.uri,
        subjectType: 'post',
        message: `reacted ${emoji} to your post`,
      });

      return res.json({ action: 'added', emoji, uri: pdsRecord.uri });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // MEMBERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/members
   * List all members of the community.
   */
  router.get(
    '/members',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const search = req.query.search as string | undefined;

      const result = await opensocial.listMembers(communityDid, search);
      return res.json(result);
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // CHAPTER MAP (media item enrichment)
  // ═══════════════════════════════════════════════════════════════

  /**
   * PUT /groups/:communityDid/media/:mediaItemId/chapters
   * Set the chapter map for a media item. Admin only.
   * This is stored globally on the media item so other groups can reuse it.
   *
   * Body: { totalChapters, chapters: [{ chapter, title?, startPage, endPage }, ...] }
   */
  router.put(
    '/media/:mediaItemId/chapters',
    ...adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const mediaItemId = Number(req.params.mediaItemId);
      const { totalChapters, chapters } = req.body;

      if (!totalChapters || !Array.isArray(chapters)) {
        return res.status(400).json({ error: 'totalChapters and chapters array are required' });
      }

      // Validate chapter entries
      for (const ch of chapters) {
        if (ch.chapter == null || ch.startPage == null || ch.endPage == null) {
          return res.status(400).json({
            error: 'Each chapter must have chapter, startPage, and endPage',
          });
        }
      }

      const mediaItem = await ctx.db
        .selectFrom('media_items')
        .select(['id'])
        .where('id', '=', mediaItemId)
        .executeTakeFirst();

      if (!mediaItem) {
        return res.status(404).json({ error: 'Media item not found' });
      }

      const chapterMap = JSON.stringify({ totalChapters, chapters });

      await ctx.db
        .updateTable('media_items')
        .set({ chapterMap: chapterMap as any, updatedAt: new Date() })
        .where('id', '=', mediaItemId)
        .execute();

      return res.json({ success: true, chapterMap: { totalChapters, chapters } });
    })
  );

  /**
   * GET /groups/:communityDid/media/:mediaItemId/chapters
   * Get the chapter map for a media item.
   */
  router.get(
    '/media/:mediaItemId/chapters',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const mediaItemId = Number(req.params.mediaItemId);

      const mediaItem = await ctx.db
        .selectFrom('media_items')
        .select(['id', 'chapterMap', 'length'])
        .where('id', '=', mediaItemId)
        .executeTakeFirst();

      if (!mediaItem) {
        return res.status(404).json({ error: 'Media item not found' });
      }

      const chapterMap = mediaItem.chapterMap
        ? (typeof mediaItem.chapterMap === 'string'
            ? JSON.parse(mediaItem.chapterMap)
            : mediaItem.chapterMap)
        : null;

      return res.json({ chapterMap, totalPages: mediaItem.length });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // FEED (group activity)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/feed
   * Get a chronological activity feed for the group.
   * Combines recent posts, segments, and status changes.
   */
  router.get(
    '/feed',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      // Fetch recent posts
      const posts = await ctx.db
        .selectFrom('group_posts')
        .selectAll()
        .where('communityDid', '=', communityDid)
        .where('parentPostId', 'is', null) // Only top-level
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      // Fetch recent segments
      const segments = await ctx.db
        .selectFrom('group_segments')
        .selectAll()
        .where('communityDid', '=', communityDid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      // Merge and sort chronologically
      const feed = [
        ...posts.map((p) => ({ type: 'post' as const, data: p, createdAt: p.createdAt })),
        ...segments.map((s) => ({ type: 'segment' as const, data: s, createdAt: s.createdAt })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      return res.json({ feed });
    })
  );

  return router;
};
