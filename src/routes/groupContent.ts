/**
 * Group content routes — lists, items, segments, posts, reactions
 * for community book clubs and shared reading lists.
 *
 * All data lives on the community's PDS repo (source of truth).
 * Records are addressed by AT-URI / rkey, not integer IDs.
 * Notifications are the only thing stored in Postgres.
 *
 * All routes are mounted at /groups/:communityDid/...
 * and require authenticated membership via the groupAuth middleware.
 */

import express, { Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import {
  requireGroupMember,
  GroupAuthRequest,
} from '../middleware/groupAuth';
import * as opensocial from '../services/opensocial';
import { rkeyFromUri } from '../services/opensocial';
import type { PdsRecord } from '../services/opensocial';
import {
  createNotification,
  notifyAllMembers,
  notifyUsers,
} from '../services/notifications';

// ── Collection constants ──────────────────────────────────────────

const COL_LIST = 'app.collectivesocial.group.list';
const COL_LISTITEM = 'app.collectivesocial.group.listitem';
const COL_LISTITEM_STATUS = 'app.collectivesocial.group.listitem.status';
const COL_SEGMENT = 'app.collectivesocial.group.segment';
const COL_POST = 'app.collectivesocial.group.post';
const COL_REACTION = 'app.collectivesocial.group.reaction';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router({ mergeParams: true });

  // Membership middleware: authenticates and attaches groupAuth context.
  // Fine-grained permission enforcement (member vs admin per collection)
  // is handled by open-social when the record write is proxied.
  const memberOnly = requireGroupMember(ctx);

  // ═══════════════════════════════════════════════════════════════
  // LISTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/lists
   * List all shared lists for a community (from PDS).
   */
  router.get(
    '/lists',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;

      const records = await opensocial.listAllCommunityRecords(communityDid, COL_LIST);
      const lists = records
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      return res.json({ lists });
    })
  );

  /**
   * GET /groups/:communityDid/lists/:rkey
   * Get a single list with its items (from PDS).
   */
  router.get(
    '/lists/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { rkey } = req.params;

      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Fetch all items and filter by this list's URI
      const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
      const items = allItems
        .filter((r: any) => r.value.listUri === list.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      // Fetch status records to enrich items
      const allStatuses = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM_STATUS);
      const statusByItemUri = new Map<string, any>();
      for (const s of allStatuses) {
        statusByItemUri.set(s.value.listItemUri as string, s.value);
      }

      const enrichedItems = items.map((item: any) => {
        const status = statusByItemUri.get(
          item.uri || `at://${communityDid}/${COL_LISTITEM}/${item.rkey}`
        );
        return {
          ...item,
          status: status?.status ?? 'not-started',
        };
      });

      return res.json({
        list: { uri: list.uri, rkey: rkeyFromUri(list.uri), ...list.value },
        items: enrichedItems,
      });
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

      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        COL_LIST,
        { name, description, purpose, segmentType, createdBy: userDid, createdAt: now }
      );

      // Notify members
      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_list', {
        subjectUri: pdsRecord.uri,
        subjectType: 'list',
        message: `created a new list: ${name}`,
      });

      return res.json({
        list: {
          uri: pdsRecord.uri,
          rkey: rkeyFromUri(pdsRecord.uri),
          name,
          description,
          purpose,
          segmentType,
          createdBy: userDid,
          createdAt: now,
        },
      });
    })
  );

  /**
   * PUT /groups/:communityDid/lists/:rkey
   * Update a list. Admin only.
   *
   * Body: { name?, description?, purpose?, segmentType? }
   */
  router.put(
    '/lists/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;
      const { name, description, purpose, segmentType } = req.body;

      // Fetch existing to merge
      let existing: PdsRecord;
      try {
        existing = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      const updatedRecord = {
        ...existing.value,
        name: name ?? existing.value.name,
        description: description !== undefined ? description : existing.value.description,
        purpose: purpose !== undefined ? purpose : existing.value.purpose,
        segmentType: segmentType !== undefined ? segmentType : existing.value.segmentType,
      };

      const result = await opensocial.updateCommunityRecord(
        communityDid, userDid, COL_LIST, rkey, updatedRecord
      );

      return res.json({
        list: { uri: result.uri, rkey, ...updatedRecord },
      });
    })
  );

  /**
   * DELETE /groups/:communityDid/lists/:rkey
   * Delete a list and all its items/segments. Admin only.
   */
  router.delete(
    '/lists/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;

      // Get the list URI to find children
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Delete all child items (and their children: segments, posts, reactions)
      const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
      const listItems = allItems.filter((r: any) => r.value.listUri === list.uri);

      for (const item of listItems) {
        await deleteItemAndChildren(communityDid, userDid, item.uri, rkeyFromUri(item.uri));
      }

      // Delete the list itself
      await opensocial.deleteCommunityRecord(communityDid, userDid, COL_LIST, rkey);

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // LIST ITEMS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/lists/:listRkey/items
   * List all items for a list.
   */
  router.get(
    '/lists/:listRkey/items',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { listRkey } = req.params;

      // Get the list URI
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(communityDid, COL_LIST, listRkey);
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
      const items = allItems
        .filter((r: any) => r.value.listUri === list.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      return res.json({ items });
    })
  );

  /**
   * POST /groups/:communityDid/lists/:listRkey/items
   * Add an item to a list. Any member can add.
   *
   * Body: { title, creator?, mediaItemId?, mediaType, order? }
   */
  router.post(
    '/lists/:listRkey/items',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { listRkey } = req.params;
      const { title, creator, mediaItemId, mediaType, order } = req.body;

      if (!title || !mediaType) {
        return res.status(400).json({ error: 'title and mediaType are required' });
      }

      // Get the list URI + name
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(communityDid, COL_LIST, listRkey);
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Determine order from existing items
      let itemOrder = order;
      if (itemOrder == null) {
        const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
        const listItems = allItems.filter((r: any) => r.value.listUri === list.uri);
        const maxOrder = listItems.reduce(
          (max, r: any) => Math.max(max, r.value.order ?? 0), -1
        );
        itemOrder = maxOrder + 1;
      }

      const now = new Date().toISOString();

      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        COL_LISTITEM,
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

      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_item', {
        subjectUri: pdsRecord.uri,
        subjectType: 'listitem',
        message: `added "${title}" to ${(list.value as any).name}`,
      });

      return res.json({
        item: {
          uri: pdsRecord.uri,
          rkey: rkeyFromUri(pdsRecord.uri),
          listUri: list.uri,
          title,
          creator,
          mediaItemId,
          mediaType,
          order: itemOrder,
          addedBy: userDid,
          createdAt: now,
        },
      });
    })
  );

  /**
   * PUT /groups/:communityDid/items/:rkey/status
   * Set the group status of a list item. Admin only.
   *
   * Body: { status: 'not-started' | 'in-progress' | 'completed' }
   */
  router.put(
    '/items/:rkey/status',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;
      const { status } = req.body;

      const validStatuses = ['not-started', 'in-progress', 'completed'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          error: `status must be one of: ${validStatuses.join(', ')}`,
        });
      }

      // Get the item
      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, rkey);
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      const now = new Date().toISOString();

      // Find existing status record for this item
      const allStatuses = await opensocial.listAllCommunityRecords(
        communityDid, COL_LISTITEM_STATUS
      );
      const existingStatus = allStatuses.find(
        (r: any) => r.value.listItemUri === item.uri
      );

      let statusUri: string;
      if (existingStatus) {
        const statusRkey = rkeyFromUri(existingStatus.uri);
        const result = await opensocial.updateCommunityRecord(
          communityDid, userDid, COL_LISTITEM_STATUS, statusRkey,
          { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now }
        );
        statusUri = result.uri;
      } else {
        const result = await opensocial.createCommunityRecord(
          communityDid, userDid, COL_LISTITEM_STATUS,
          { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now }
        );
        statusUri = result.uri;
      }

      await notifyAllMembers(ctx.db, communityDid, userDid, 'status_change', {
        subjectUri: item.uri,
        subjectType: 'listitem',
        message: `marked "${(item.value as any).title}" as ${status}`,
      });

      return res.json({
        item: { uri: item.uri, rkey, ...item.value, status, statusUri },
      });
    })
  );

  /**
   * DELETE /groups/:communityDid/items/:rkey
   * Remove an item from a list. Admin only.
   */
  router.delete(
    '/items/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, rkey);
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      await deleteItemAndChildren(communityDid, userDid, item.uri, rkey);

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // SEGMENTS (reading assignments)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/items/:itemRkey/segments
   * List all segments for a list item.
   */
  router.get(
    '/items/:itemRkey/segments',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { itemRkey } = req.params;

      // Get the item URI
      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      const allSegments = await opensocial.listAllCommunityRecords(
        communityDid, COL_SEGMENT
      );
      const segments = allSegments
        .filter((r: any) => r.value.listItemUri === item.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      return res.json({ segments });
    })
  );

  /**
   * POST /groups/:communityDid/items/:itemRkey/segments
   * Create a reading assignment segment. Admin only.
   *
   * Body: {
   *   label, segmentType?,
   *   startPage?, endPage?, startPercent?, endPercent?,
   *   startChapter?, endChapter?,
   *   assignedDate?, order?
   * }
   */
  router.post(
    '/items/:itemRkey/segments',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { itemRkey } = req.params;

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
      } catch {
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
      const mediaItemId = (item.value as any).mediaItemId;
      if (segmentType === 'chapters' && startChapter != null && mediaItemId) {
        const mediaItem = await ctx.db
          .selectFrom('media_items')
          .select(['chapterMap', 'length'])
          .where('id', '=', mediaItemId)
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
            const totalPages = mediaItem.length;
            if (totalPages && totalPages > 0) {
              startPercent = Math.round((startPage / totalPages) * 100);
              endPercent = Math.round((endPage / totalPages) * 100);
            }
          }
        }
      }

      // Determine order
      if (order == null) {
        const allSegments = await opensocial.listAllCommunityRecords(
          communityDid, COL_SEGMENT
        );
        const itemSegments = allSegments.filter(
          (r: any) => r.value.listItemUri === item.uri
        );
        const maxOrder = itemSegments.reduce(
          (max, r: any) => Math.max(max, r.value.order ?? 0), -1
        );
        order = maxOrder + 1;
      }

      const now = new Date().toISOString();

      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        COL_SEGMENT,
        {
          listItemUri: item.uri,
          label,
          segmentType,
          startPage, endPage,
          startPercent, endPercent,
          startChapter, endChapter,
          assignedDate,
          order,
          createdBy: userDid,
          createdAt: now,
        }
      );

      await notifyAllMembers(ctx.db, communityDid, userDid, 'new_segment', {
        subjectUri: pdsRecord.uri,
        subjectType: 'segment',
        message: `assigned: ${label}`,
      });

      return res.json({
        segment: {
          uri: pdsRecord.uri,
          rkey: rkeyFromUri(pdsRecord.uri),
          listItemUri: item.uri,
          label,
          segmentType,
          startPage, endPage,
          startPercent, endPercent,
          startChapter, endChapter,
          assignedDate,
          order,
          createdBy: userDid,
          createdAt: now,
        },
      });
    })
  );

  /**
   * PUT /groups/:communityDid/segments/:rkey
   * Update a segment. Admin only.
   */
  router.put(
    '/segments/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;

      let existing: PdsRecord;
      try {
        existing = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, rkey);
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const {
        label, segmentType,
        startPage, endPage, startPercent, endPercent,
        startChapter, endChapter,
        assignedDate, order,
      } = req.body;

      const val = existing.value as any;
      const updatedRecord = {
        ...val,
        label: label ?? val.label,
        segmentType: segmentType !== undefined ? segmentType : val.segmentType,
        startPage: startPage !== undefined ? startPage : val.startPage,
        endPage: endPage !== undefined ? endPage : val.endPage,
        startPercent: startPercent !== undefined ? startPercent : val.startPercent,
        endPercent: endPercent !== undefined ? endPercent : val.endPercent,
        startChapter: startChapter !== undefined ? startChapter : val.startChapter,
        endChapter: endChapter !== undefined ? endChapter : val.endChapter,
        assignedDate: assignedDate !== undefined ? assignedDate : val.assignedDate,
        order: order ?? val.order,
      };

      const result = await opensocial.updateCommunityRecord(
        communityDid, userDid, COL_SEGMENT, rkey, updatedRecord
      );

      return res.json({
        segment: { uri: result.uri, rkey, ...updatedRecord },
      });
    })
  );

  /**
   * DELETE /groups/:communityDid/segments/:rkey
   * Delete a segment. Admin only.
   */
  router.delete(
    '/segments/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { rkey } = req.params;

      // Delete any posts associated with this segment
      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, rkey);
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      // Delete child posts + reactions
      const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
      const segmentPosts = allPosts.filter(
        (r: any) => r.value.segmentUri === segment.uri
      );
      for (const post of segmentPosts) {
        await deletePostAndReactions(communityDid, userDid, post.uri);
      }

      await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT, rkey);

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // POSTS (discussions)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/segments/:segmentRkey/posts
   * List all top-level posts for a segment, with nested replies.
   */
  router.get(
    '/segments/:segmentRkey/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { segmentRkey } = req.params;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid, COL_SEGMENT, segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
      const segmentPosts = allPosts
        .filter((r: any) => r.value.segmentUri === segment.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }));

      return res.json({ posts: buildThreads(segmentPosts) });
    })
  );

  /**
   * GET /groups/:communityDid/items/:itemRkey/posts
   * List all top-level posts for a list item.
   */
  router.get(
    '/items/:itemRkey/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { itemRkey } = req.params;

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid, COL_LISTITEM, itemRkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
      const itemPosts = allPosts
        .filter((r: any) => r.value.listItemUri === item.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }));

      return res.json({ posts: buildThreads(itemPosts) });
    })
  );

  /**
   * POST /groups/:communityDid/posts
   * Create a discussion post. Any member can post.
   *
   * Body: { text, segmentUri?, listItemUri?, parentPostUri?, mentionedDids? }
   */
  router.post(
    '/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { text, segmentUri, listItemUri, parentPostUri, mentionedDids } =
        req.body;

      if (!text) {
        return res.status(400).json({ error: 'text is required' });
      }

      const now = new Date().toISOString();

      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        COL_POST,
        {
          text,
          segmentUri: segmentUri || null,
          listItemUri: listItemUri || null,
          parentPostUri: parentPostUri || null,
          authorDid: userDid,
          mentionedDids: mentionedDids || [],
          createdAt: now,
        }
      );

      // Notifications
      if (parentPostUri) {
        // Find parent post author from PDS
        const parentRkey = rkeyFromUri(parentPostUri);
        try {
          const parentPost = await opensocial.getCommunityRecord(
            communityDid, COL_POST, parentRkey
          );
          const parentAuthor = (parentPost.value as any).authorDid;
          if (parentAuthor) {
            await createNotification(ctx.db, {
              communityDid,
              recipientDid: parentAuthor,
              actorDid: userDid,
              type: 'reply',
              subjectUri: pdsRecord.uri,
              subjectType: 'post',
              message: 'replied to your post',
            });
          }
        } catch {
          // Parent post lookup failed — skip reply notification
        }
      } else {
        await notifyAllMembers(ctx.db, communityDid, userDid, 'new_post', {
          subjectUri: pdsRecord.uri,
          subjectType: 'post',
          message: 'posted in the discussion',
        });
      }

      if (mentionedDids?.length) {
        await notifyUsers(
          ctx.db, communityDid, userDid, mentionedDids, 'mention',
          {
            subjectUri: pdsRecord.uri,
            subjectType: 'post',
            message: 'mentioned you in a post',
          }
        );
      }

      return res.json({
        post: {
          uri: pdsRecord.uri,
          rkey: rkeyFromUri(pdsRecord.uri),
          text,
          segmentUri,
          listItemUri,
          parentPostUri,
          authorDid: userDid,
          createdAt: now,
        },
      });
    })
  );

  /**
   * DELETE /groups/:communityDid/posts/:rkey
   * Delete a post. Author or admin can delete.
   */
  router.delete(
    '/posts/:rkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid, isAdmin } = req.groupAuth!;
      const { rkey } = req.params;

      let post: PdsRecord;
      try {
        post = await opensocial.getCommunityRecord(communityDid, COL_POST, rkey);
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }

      const authorDid = (post.value as any).authorDid;
      if (authorDid !== userDid && !isAdmin) {
        return res
          .status(403)
          .json({ error: 'Only the author or an admin can delete this post' });
      }

      await deletePostAndReactions(communityDid, userDid, post.uri);

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // REACTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/posts/:postRkey/reactions
   * Get all reactions on a post.
   */
  router.get(
    '/posts/:postRkey/reactions',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const { postRkey } = req.params;

      let post: PdsRecord;
      try {
        post = await opensocial.getCommunityRecord(
          communityDid, COL_POST, postRkey
        );
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }

      const allReactions = await opensocial.listAllCommunityRecords(
        communityDid, COL_REACTION
      );
      const postReactions = allReactions.filter(
        (r: any) => r.value.postUri === post.uri
      );

      // Group by emoji
      const grouped: Record<
        string,
        { emoji: string; count: number; authors: string[] }
      > = {};
      for (const r of postReactions) {
        const val = r.value as any;
        if (!grouped[val.emoji]) {
          grouped[val.emoji] = { emoji: val.emoji, count: 0, authors: [] };
        }
        grouped[val.emoji].count++;
        grouped[val.emoji].authors.push(val.authorDid);
      }

      return res.json({ reactions: Object.values(grouped) });
    })
  );

  /**
   * POST /groups/:communityDid/posts/:postRkey/reactions
   * Toggle an emoji reaction on a post. Any member can react.
   *
   * Body: { emoji }
   */
  router.post(
    '/posts/:postRkey/reactions',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { postRkey } = req.params;
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ error: 'emoji is required' });
      }

      let post: PdsRecord;
      try {
        post = await opensocial.getCommunityRecord(
          communityDid, COL_POST, postRkey
        );
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Check for existing reaction (toggle off)
      const allReactions = await opensocial.listAllCommunityRecords(
        communityDid, COL_REACTION
      );
      const existing = allReactions.find(
        (r: any) =>
          r.value.postUri === post.uri &&
          r.value.authorDid === userDid &&
          r.value.emoji === emoji
      );

      if (existing) {
        await opensocial.deleteCommunityRecord(
          communityDid, userDid, COL_REACTION, rkeyFromUri(existing.uri)
        );
        return res.json({ action: 'removed', emoji });
      }

      // Create new reaction
      const now = new Date().toISOString();
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid, userDid, COL_REACTION,
        { postUri: post.uri, emoji, authorDid: userDid, createdAt: now }
      );

      // Notify post author
      const postAuthor = (post.value as any).authorDid;
      if (postAuthor) {
        await createNotification(ctx.db, {
          communityDid,
          recipientDid: postAuthor,
          actorDid: userDid,
          type: 'reaction',
          subjectUri: post.uri,
          subjectType: 'post',
          message: `reacted ${emoji} to your post`,
        });
      }

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
  // CHAPTER MAP (media item enrichment — still in Postgres)
  // ═══════════════════════════════════════════════════════════════

  /**
   * PUT /groups/:communityDid/media/:mediaItemId/chapters
   * Set the chapter map for a media item. Admin only.
   */
  router.put(
    '/media/:mediaItemId/chapters',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const mediaItemId = Number(req.params.mediaItemId);
      const { totalChapters, chapters } = req.body;

      if (!totalChapters || !Array.isArray(chapters)) {
        return res
          .status(400)
          .json({ error: 'totalChapters and chapters array are required' });
      }

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

      return res.json({
        success: true,
        chapterMap: { totalChapters, chapters },
      });
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
        ? typeof mediaItem.chapterMap === 'string'
          ? JSON.parse(mediaItem.chapterMap)
          : mediaItem.chapterMap
        : null;

      return res.json({ chapterMap, totalPages: mediaItem.length });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // FEED (group activity — reads from PDS)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/feed
   * Get a chronological activity feed for the group.
   */
  router.get(
    '/feed',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      // Fetch posts and segments from PDS
      const [posts, segments] = await Promise.all([
        opensocial.listAllCommunityRecords(communityDid, COL_POST),
        opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT),
      ]);

      const feed = [
        ...posts
          .filter((r: any) => !r.value.parentPostUri)
          .map((r) => ({
            type: 'post' as const,
            data: { uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value },
            createdAt: (r.value as any).createdAt,
          })),
        ...segments.map((r) => ({
          type: 'segment' as const,
          data: { uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value },
          createdAt: (r.value as any).createdAt,
        })),
      ]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, limit);

      return res.json({ feed });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  /** Build nested thread structure from flat posts array. */
  function buildThreads(posts: any[]): any[] {
    const sorted = posts.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const topLevel = sorted.filter((p) => !p.parentPostUri);
    const replies = sorted.filter((p) => p.parentPostUri);

    const buildThread = (post: any): any => ({
      ...post,
      replies: replies
        .filter((r) => r.parentPostUri === post.uri)
        .map(buildThread),
    });

    return topLevel.map(buildThread);
  }

  /** Delete a post and all its reactions from PDS. */
  async function deletePostAndReactions(
    communityDid: string,
    userDid: string,
    postUri: string
  ) {
    const postRkey = rkeyFromUri(postUri);

    // Delete child replies recursively
    const allPosts = await opensocial.listAllCommunityRecords(
      communityDid, COL_POST
    );
    const childPosts = allPosts.filter(
      (r: any) => r.value.parentPostUri === postUri
    );
    for (const child of childPosts) {
      await deletePostAndReactions(communityDid, userDid, child.uri);
    }

    // Delete reactions on this post
    const allReactions = await opensocial.listAllCommunityRecords(
      communityDid, COL_REACTION
    );
    const postReactions = allReactions.filter(
      (r: any) => r.value.postUri === postUri
    );
    for (const reaction of postReactions) {
      await opensocial.deleteCommunityRecord(
        communityDid, userDid, COL_REACTION, rkeyFromUri(reaction.uri)
      );
    }

    // Delete the post
    await opensocial.deleteCommunityRecord(
      communityDid, userDid, COL_POST, postRkey
    );
  }

  /** Delete an item and all its children (segments, posts, reactions, status). */
  async function deleteItemAndChildren(
    communityDid: string,
    userDid: string,
    itemUri: string,
    itemRkey: string
  ) {
    // Delete segments and their posts
    const allSegments = await opensocial.listAllCommunityRecords(
      communityDid, COL_SEGMENT
    );
    const itemSegments = allSegments.filter(
      (r: any) => r.value.listItemUri === itemUri
    );
    for (const seg of itemSegments) {
      // Delete posts for this segment
      const allPosts = await opensocial.listAllCommunityRecords(
        communityDid, COL_POST
      );
      const segPosts = allPosts.filter(
        (r: any) => r.value.segmentUri === seg.uri
      );
      for (const post of segPosts) {
        await deletePostAndReactions(communityDid, userDid, post.uri);
      }
      await opensocial.deleteCommunityRecord(
        communityDid, userDid, COL_SEGMENT, rkeyFromUri(seg.uri)
      );
    }

    // Delete posts directly on the item (not tied to a segment)
    const allPosts = await opensocial.listAllCommunityRecords(
      communityDid, COL_POST
    );
    const itemPosts = allPosts.filter(
      (r: any) =>
        r.value.listItemUri === itemUri && !r.value.segmentUri
    );
    for (const post of itemPosts) {
      await deletePostAndReactions(communityDid, userDid, post.uri);
    }

    // Delete status record for this item
    const allStatuses = await opensocial.listAllCommunityRecords(
      communityDid, COL_LISTITEM_STATUS
    );
    const itemStatus = allStatuses.find(
      (r: any) => r.value.listItemUri === itemUri
    );
    if (itemStatus) {
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_LISTITEM_STATUS,
        rkeyFromUri(itemStatus.uri)
      );
    }

    // Delete the item itself
    await opensocial.deleteCommunityRecord(
      communityDid, userDid, COL_LISTITEM, itemRkey
    );
  }

  return router;
};
