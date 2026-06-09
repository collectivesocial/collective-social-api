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
  requireGroupAdmin,
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
import * as groupPostService from '../services/groupPosts';
import * as groupEventsService from '../services/groupEvents';
import * as userProfileService from '../services/userProfiles';
import { getSessionAgent } from '../auth/agent';

// ── Collection constants ──────────────────────────────────────────

const COL_LIST = 'app.collectivesocial.group.list';
const COL_LISTITEM = 'app.collectivesocial.group.listitem';
const COL_LISTITEM_STATUS = 'app.collectivesocial.group.listitem.status';
const COL_SEGMENT = 'app.collectivesocial.group.segment';
// Segment progress now lives in the user's own PDS (B5 decision).
// The old community-PDS collection (app.collectivesocial.group.segment.progress)
// is no longer written to; existing records in the community repo are obsolete.
const COL_SEGMENT_PROGRESS_USER = 'app.collectivesocial.feed.segmentprogress';
const COL_POST = 'app.collectivesocial.group.post';
const COL_REACTION = 'app.collectivesocial.group.reaction';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router({ mergeParams: true });

  // Membership middleware: authenticates and attaches groupAuth context.
  // Fine-grained permission enforcement (member vs admin per collection)
  // is handled by open-social when the record write is proxied.
  const memberOnly = requireGroupMember(ctx);
  const adminOnly = requireGroupAdmin(ctx);

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

      const records = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LIST
      );
      const lists = records
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort(
          (a: any, b: any) =>
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
      const rkey = req.params.rkey as string;

      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(
          communityDid,
          COL_LIST,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Fetch all items and filter by this list's URI
      const allItems = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LISTITEM
      );
      const items = allItems
        .filter((r: any) => r.value.listUri === list.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      // Fetch status records to enrich items
      const allStatuses = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LISTITEM_STATUS
      );
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
        {
          name,
          description,
          purpose,
          segmentType,
          createdBy: userDid,
          createdAt: now,
        }
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
   * PUT /groups/:communityDid/lists/reorder
   * Bulk-update the display order of the community's lists. Admin only.
   *
   * Body: { order: string[] } — array of list rkeys in the new desired order.
   * Lists not included in `order` are appended after, preserving their
   * existing relative order.
   */
  router.put(
    '/lists/reorder',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const { order } = req.body as { order?: unknown };

      if (!Array.isArray(order) || order.some((r) => typeof r !== 'string')) {
        return res
          .status(400)
          .json({ error: '`order` must be an array of list rkeys' });
      }

      // Fetch the current set of lists from the community PDS. Each list we
      // need to update is read individually so we can merge the new `order`
      // value with the rest of the existing record.
      const allLists = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LIST
      );
      const byRkey = new Map(allLists.map((r) => [rkeyFromUri(r.uri), r]));

      // Reject unknown rkeys up front rather than half-applying the change.
      const unknown = (order as string[]).filter((rkey) => !byRkey.has(rkey));
      if (unknown.length > 0) {
        return res.status(404).json({
          error: `Unknown list rkey(s): ${unknown.join(', ')}`,
        });
      }

      // Apply the new order. Writes happen in parallel for speed; if any
      // individual write fails the others still complete and we report the
      // first error so the client can refetch and recover.
      const updates = (order as string[]).map((rkey, index) => {
        const existing = byRkey.get(rkey)!;
        const updatedRecord = { ...existing.value, order: index };
        return opensocial.updateCommunityRecord(
          communityDid,
          userDid,
          COL_LIST,
          rkey,
          updatedRecord
        );
      });

      const results = await Promise.allSettled(updates);
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (failures.length > 0) {
        ctx.logger.error(
          { failures: failures.map((f) => f.reason?.message) },
          'Some list reorder updates failed'
        );
        return res.status(500).json({
          error: 'Failed to reorder some lists',
          failedCount: failures.length,
        });
      }

      return res.json({ success: true, count: order.length });
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
      const rkey = req.params.rkey as string;
      const { name, description, purpose, segmentType } = req.body;

      // Fetch existing to merge
      let existing: PdsRecord;
      try {
        existing = await opensocial.getCommunityRecord(
          communityDid,
          COL_LIST,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      const updatedRecord = {
        ...existing.value,
        name: name ?? existing.value.name,
        description:
          description !== undefined ? description : existing.value.description,
        purpose: purpose !== undefined ? purpose : existing.value.purpose,
        segmentType:
          segmentType !== undefined ? segmentType : existing.value.segmentType,
      };

      const result = await opensocial.updateCommunityRecord(
        communityDid,
        userDid,
        COL_LIST,
        rkey,
        updatedRecord
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
      const rkey = req.params.rkey as string;

      // Get the list URI to find children
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(
          communityDid,
          COL_LIST,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Delete all child items (and their children: segments, posts, reactions)
      const allItems = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LISTITEM
      );
      const listItems = allItems.filter(
        (r: any) => r.value.listUri === list.uri
      );

      for (const item of listItems) {
        await deleteItemAndChildren(
          communityDid,
          userDid,
          item.uri,
          rkeyFromUri(item.uri)
        );
      }

      // Delete the list itself
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_LIST,
        rkey
      );

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
      const listRkey = req.params.listRkey as string;

      // Get the list URI
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(
          communityDid,
          COL_LIST,
          listRkey
        );
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      const allItems = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LISTITEM
      );
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
      const listRkey = req.params.listRkey as string;
      const { title, creator, mediaItemId, mediaType, order } = req.body;

      if (!title || !mediaType) {
        return res
          .status(400)
          .json({ error: 'title and mediaType are required' });
      }

      // Get the list URI + name
      let list: PdsRecord;
      try {
        list = await opensocial.getCommunityRecord(
          communityDid,
          COL_LIST,
          listRkey
        );
      } catch {
        return res.status(404).json({ error: 'List not found' });
      }

      // Determine order from existing items
      let itemOrder = order;
      if (itemOrder == null) {
        const allItems = await opensocial.listAllCommunityRecords(
          communityDid,
          COL_LISTITEM
        );
        const listItems = allItems.filter(
          (r: any) => r.value.listUri === list.uri
        );
        const maxOrder = listItems.reduce(
          (max, r: any) => Math.max(max, r.value.order ?? 0),
          -1
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
   * Admin only — sets the GROUP's shared status for a list item.
   *
   * Body: { status: 'not-started' | 'in-progress' | 'completed' }
   */
  router.put(
    '/items/:rkey/status',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const rkey = req.params.rkey as string;
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
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      const now = new Date().toISOString();

      // Find existing status record for this item
      const allStatuses = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_LISTITEM_STATUS
      );
      const existingStatus = allStatuses.find(
        (r: any) => r.value.listItemUri === item.uri
      );

      let statusUri: string;
      if (existingStatus) {
        const statusRkey = rkeyFromUri(existingStatus.uri);
        const result = await opensocial.updateCommunityRecord(
          communityDid,
          userDid,
          COL_LISTITEM_STATUS,
          statusRkey,
          { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now }
        );
        statusUri = result.uri;
      } else {
        const result = await opensocial.createCommunityRecord(
          communityDid,
          userDid,
          COL_LISTITEM_STATUS,
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
      const rkey = req.params.rkey as string;

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          rkey
        );
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
      const itemRkey = req.params.itemRkey as string;

      // Get the item URI
      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          itemRkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      const allSegments = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_SEGMENT
      );
      const segments = allSegments
        .filter((r: any) => r.value.listItemUri === item.uri)
        .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      return res.json({ segments });
    })
  );

  /**
   * GET /groups/:communityDid/items/:itemRkey/progress
   * Batch-fetch all segment progress for all segments of an item.
   * Returns a map keyed by segment URI → array of progress records.
   * This replaces N individual /segments/:rkey/progress calls with ONE call.
   */
  router.get(
    '/items/:itemRkey/progress',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const itemRkey = req.params.itemRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          itemRkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Get all segments for this item
      const allSegments = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_SEGMENT
      );
      const itemSegments = allSegments.filter(
        (r: any) => r.value.listItemUri === item.uri
      );

      // Fetch the current user's progress records from their PDS for each segment.
      // rkey = segmentRkey (by convention set at write time), so we look them
      // up directly rather than listing the entire collection.
      const progressBySegment: Record<
        string,
        { uri: string; rkey: string; [k: string]: unknown } | null
      > = {};

      await Promise.all(
        itemSegments.map(async (seg) => {
          const segRkey = rkeyFromUri(seg.uri);
          try {
            const rec = await agent.api.com.atproto.repo.getRecord({
              repo: agent.did!,
              collection: COL_SEGMENT_PROGRESS_USER,
              rkey: segRkey,
            });
            progressBySegment[seg.uri] = {
              uri: rec.data.uri,
              rkey: segRkey,
              memberDid: agent.did!,
              ...(rec.data.value as object),
            };
          } catch {
            // No progress record for this segment — user hasn't marked it yet
            progressBySegment[seg.uri] = null;
          }
        })
      );

      // Backfill segment_completions cache for any completed segments
      const completed = Object.entries(progressBySegment).filter(
        ([, prog]) => prog && (prog as any).completed
      );
      if (completed.length > 0) {
        await Promise.all(
          completed.map(([, prog]) => {
            const p = prog as any;
            return ctx.db
              .insertInto('segment_completions')
              .values({
                community_did: communityDid,
                segment_rkey: p.rkey,
                user_did: agent.did!,
                completed_at: new Date(p.createdAt || new Date().toISOString()),
              })
              .onConflict((oc) => oc.doNothing())
              .execute()
              .catch((err) => {
                ctx.logger.warn(
                  { err, segment_rkey: p.rkey },
                  'Failed to backfill segment completion'
                );
              });
          })
        );
      }

      // Count how many members have completed each segment. The per-user
      // records above only reflect the current user, so the count comes from
      // the shared segment_completions cache — the same source the roster uses,
      // keeping the summary badge and the expanded roster in agreement.
      const completionCountBySegment: Record<string, number> = {};
      const segmentRkeys = itemSegments.map((seg) => rkeyFromUri(seg.uri));
      if (segmentRkeys.length > 0) {
        const counts = await ctx.db
          .selectFrom('segment_completions')
          .select(({ fn }) => [
            'segment_rkey',
            fn.countAll<number>().as('count'),
          ])
          .where('community_did', '=', communityDid)
          .where('segment_rkey', 'in', segmentRkeys)
          .groupBy('segment_rkey')
          .execute();
        const countByRkey = new Map(
          counts.map((c) => [c.segment_rkey, Number(c.count)])
        );
        for (const seg of itemSegments) {
          completionCountBySegment[seg.uri] =
            countByRkey.get(rkeyFromUri(seg.uri)) ?? 0;
        }
      }

      return res.json({ progressBySegment, completionCountBySegment });
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
      const itemRkey = req.params.itemRkey as string;

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          itemRkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      let {
        label,
        segmentType,
        startPage,
        endPage,
        startPercent,
        endPercent,
        startChapter,
        endChapter,
        assignedDate,
        order,
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
          const map =
            typeof mediaItem.chapterMap === 'string'
              ? JSON.parse(mediaItem.chapterMap)
              : mediaItem.chapterMap;

          const startCh = map.chapters?.find(
            (c: any) => c.chapter === startChapter
          );
          const endCh =
            endChapter != null
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
          communityDid,
          COL_SEGMENT
        );
        const itemSegments = allSegments.filter(
          (r: any) => r.value.listItemUri === item.uri
        );
        const maxOrder = itemSegments.reduce(
          (max, r: any) => Math.max(max, r.value.order ?? 0),
          -1
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
          startPage,
          endPage,
          startPercent,
          endPercent,
          startChapter,
          endChapter,
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
          startPage,
          endPage,
          startPercent,
          endPercent,
          startChapter,
          endChapter,
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
      const rkey = req.params.rkey as string;

      let existing: PdsRecord;
      try {
        existing = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const {
        label,
        segmentType,
        startPage,
        endPage,
        startPercent,
        endPercent,
        startChapter,
        endChapter,
        assignedDate,
        order,
      } = req.body;

      const val = existing.value as any;
      const updatedRecord = {
        ...val,
        label: label ?? val.label,
        segmentType: segmentType !== undefined ? segmentType : val.segmentType,
        startPage: startPage !== undefined ? startPage : val.startPage,
        endPage: endPage !== undefined ? endPage : val.endPage,
        startPercent:
          startPercent !== undefined ? startPercent : val.startPercent,
        endPercent: endPercent !== undefined ? endPercent : val.endPercent,
        startChapter:
          startChapter !== undefined ? startChapter : val.startChapter,
        endChapter: endChapter !== undefined ? endChapter : val.endChapter,
        assignedDate:
          assignedDate !== undefined ? assignedDate : val.assignedDate,
        order: order ?? val.order,
      };

      const result = await opensocial.updateCommunityRecord(
        communityDid,
        userDid,
        COL_SEGMENT,
        rkey,
        updatedRecord
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
      const rkey = req.params.rkey as string;

      // Delete any posts associated with this segment
      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          rkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      // NOTE: Segment progress records now live in each user's personal PDS
      // (app.collectivesocial.feed.segmentprogress). The server cannot enumerate
      // or delete them on behalf of users; they will become orphaned stale records.
      // Deferred: a future per-user "clear progress" flow can handle cleanup.

      // Delete child posts + reactions
      const allPosts = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_POST
      );
      const segmentPosts = allPosts.filter(
        (r: any) => r.value.segmentUri === segment.uri
      );
      for (const post of segmentPosts) {
        await deletePostAndReactions(communityDid, userDid, post.uri);
      }

      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_SEGMENT,
        rkey
      );

      return res.json({ success: true });
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // SEGMENT EVENTS (meeting times for book club segments)
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /groups/:communityDid/segments/:segmentRkey/event
   * Attach an event to a segment. Admin only.
   *
   * Body: {
   *   name, description?, startsAt, endsAt?,
   *   mode? ('virtual'|'inperson'|'hybrid'),
   *   locations? [{ name?, locality?, region?, country? }],
   *   uris? [{ uri, name? }]
   * }
   */
  router.post(
    '/segments/:segmentRkey/event',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      // Verify segment exists
      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      // Check for existing event on this segment
      const existing = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'Segment already has an event', event: existing });
      }

      const { name, description, startsAt, endsAt, mode, locations, uris } =
        req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Event name is required' });
      }

      try {
        const event = await groupEventsService.createEvent(
          communityDid,
          userDid,
          {
            name: name.trim(),
            description,
            startsAt,
            endsAt,
            mode,
            status: 'scheduled',
            segmentUri: segment.uri,
            locations,
            uris,
          }
        );
        return res.status(201).json({ event });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create segment event');
        return res
          .status(500)
          .json({ error: 'Failed to create segment event' });
      }
    })
  );

  /**
   * GET /groups/:communityDid/segments/:segmentRkey/event
   * Get the event attached to a segment. Any member can read.
   */
  router.get(
    '/segments/:segmentRkey/event',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const event = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      return res.json({ event });
    })
  );

  /**
   * PUT /groups/:communityDid/segments/:segmentRkey/event
   * Update the segment's event. Admin only.
   */
  router.put(
    '/segments/:segmentRkey/event',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const existing = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!existing) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      const {
        name,
        description,
        startsAt,
        endsAt,
        mode,
        status,
        locations,
        uris,
      } = req.body;

      try {
        const event = await groupEventsService.updateEvent(
          communityDid,
          userDid,
          existing.rkey,
          { name, description, startsAt, endsAt, mode, status, locations, uris }
        );
        return res.json({ event });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update segment event');
        return res
          .status(500)
          .json({ error: 'Failed to update segment event' });
      }
    })
  );

  /**
   * DELETE /groups/:communityDid/segments/:segmentRkey/event
   * Remove the segment's event. Admin only. Cascades RSVPs.
   */
  router.delete(
    '/segments/:segmentRkey/event',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const existing = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!existing) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      try {
        await groupEventsService.deleteEvent(
          communityDid,
          userDid,
          existing.rkey,
          existing.uri,
          ctx.db
        );
        return res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete segment event');
        return res
          .status(500)
          .json({ error: 'Failed to delete segment event' });
      }
    })
  );

  /**
   * PUT /groups/:communityDid/segments/:segmentRkey/event/rsvp
   * RSVP to a segment's event. Any member can RSVP.
   * Body: { status: 'going' | 'interested' | 'notgoing' }
   */
  router.put(
    '/segments/:segmentRkey/event/rsvp',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;
      const { status } = req.body;

      const VALID_RSVP: groupEventsService.RsvpStatus[] = [
        'going',
        'interested',
        'notgoing',
      ];
      if (!status || !VALID_RSVP.includes(status)) {
        return res.status(400).json({
          error: `status must be one of: ${VALID_RSVP.join(', ')}`,
        });
      }

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const event = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      try {
        const { rsvpUri } = await groupEventsService.rsvpToEvent(
          agent,
          communityDid,
          event.uri,
          event.cid,
          event.rkey,
          status as groupEventsService.RsvpStatus,
          ctx.db
        );
        return res.json({ rsvpUri, status });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to RSVP to segment event');
        return res.status(500).json({ error: 'Failed to RSVP' });
      }
    })
  );

  /**
   * DELETE /groups/:communityDid/segments/:segmentRkey/event/rsvp
   * Remove RSVP from segment event.
   */
  router.delete(
    '/segments/:segmentRkey/event/rsvp',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const event = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      try {
        await groupEventsService.removeRsvp(
          agent,
          event.uri,
          event.rkey,
          ctx.db
        );
        return res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to remove RSVP');
        return res.status(500).json({ error: 'Failed to remove RSVP' });
      }
    })
  );

  /**
   * GET /groups/:communityDid/segments/:segmentRkey/event/rsvps
   * List RSVPs for a segment's event. Any member can read.
   * Query: status? ('going'|'interested'|'notgoing'), limit?, offset?
   */
  router.get(
    '/segments/:segmentRkey/event/rsvps',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;
      const statusFilter = req.query.status as
        | groupEventsService.RsvpStatus
        | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      const event = await groupEventsService.findEventBySegmentUri(
        communityDid,
        segment.uri,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'No event for this segment' });
      }

      try {
        const { rows, total } = await groupEventsService.listRsvps(
          event.uri,
          ctx.db,
          { status: statusFilter, limit, offset }
        );

        return res.json({
          rsvps: rows.map((r) => ({
            userDid: r.user_did,
            status: r.status.split('#')[1],
            rsvpUri: r.rsvp_uri,
            rsvpAt: r.rsvp_at,
          })),
          total,
          limit,
          offset,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to list RSVPs');
        return res.status(500).json({ error: 'Failed to list RSVPs' });
      }
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // SEGMENT PROGRESS (per-member completion tracking)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /groups/:communityDid/segments/:segmentRkey/progress
   * List all members' progress for a segment (powers the roster view).
   */
  router.get(
    '/segments/:segmentRkey/progress',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      // Progress is now in user's own PDS. Return the current user's record only.
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let progress = null;
      try {
        const rec = await agent.api.com.atproto.repo.getRecord({
          repo: agent.did!,
          collection: COL_SEGMENT_PROGRESS_USER,
          rkey: segmentRkey,
        });
        progress = {
          uri: rec.data.uri,
          rkey: segmentRkey,
          memberDid: agent.did!,
          ...(rec.data.value as object),
        };
      } catch {
        // No progress record yet
      }

      return res.json({ progress });
    })
  );

  /**
   * GET /groups/:communityDid/segments/:segmentRkey/roster
   * Fetch all members' completion status for a segment, enriched with profiles.
   * Reads from the segment_completions cache table.
   */
  router.get(
    '/segments/:segmentRkey/roster',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      // Query cached completions
      const completions = await ctx.db
        .selectFrom('segment_completions')
        .selectAll()
        .where('community_did', '=', communityDid)
        .where('segment_rkey', '=', segmentRkey)
        .execute();

      // Enrich with profiles
      const dids = completions.map((c) => c.user_did);
      const profiles =
        dids.length > 0
          ? await userProfileService.enrichWithUserProfiles(dids)
          : {};

      const roster = completions.map((c) => ({
        did: c.user_did,
        handle: profiles[c.user_did]?.handle || c.user_did.slice(0, 20) + '…',
        displayName: profiles[c.user_did]?.displayName,
        avatar: profiles[c.user_did]?.avatar,
        completedAt: c.completed_at.toISOString(),
      }));

      return res.json({ roster });
    })
  );

  /**
   * POST /groups/:communityDid/segments/:segmentRkey/progress
   * Mark the current user as having completed a segment.
   *
   * Writes app.collectivesocial.feed.segmentprogress to the USER's own PDS
   * using the segmentRkey as the record rkey (idempotent putRecord).
   * The sync calls below (/reviewsegments and /collections/quick-add) remain
   * as the primary path for updating the user's personal library (B5 pattern).
   *
   * Body: {} (no fields needed — uses auth context)
   */
  router.post(
    '/segments/:segmentRkey/progress',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      // Check for duplicate using user's own PDS (rkey = segmentRkey is idempotent)
      try {
        const existingRecord = await agent.api.com.atproto.repo.getRecord({
          repo: agent.did!,
          collection: COL_SEGMENT_PROGRESS_USER,
          rkey: segmentRkey,
        });
        if (existingRecord.data) {
          // Backfill cache if missing
          const existingVal = existingRecord.data.value as any;
          await ctx.db
            .insertInto('segment_completions')
            .values({
              community_did: communityDid,
              segment_rkey: segmentRkey,
              user_did: userDid!,
              completed_at: new Date(
                existingVal.createdAt || new Date().toISOString()
              ),
            })
            .onConflict((oc) => oc.doNothing())
            .execute()
            .catch((err) => {
              ctx.logger.warn(
                { err, segment_rkey: segmentRkey },
                'Failed to backfill segment completion'
              );
            });

          return res.json({
            progress: {
              uri: existingRecord.data.uri,
              rkey: segmentRkey,
              ...(existingRecord.data.value as object),
            },
            alreadyExists: true,
          });
        }
      } catch {
        // Record doesn't exist yet — proceed to create
      }

      const now = new Date().toISOString();
      const progressRecord = {
        $type: COL_SEGMENT_PROGRESS_USER,
        segmentUri: segment.uri,
        communityDid,
        completed: true,
        createdAt: now,
      };

      let userPdsResponse;
      try {
        userPdsResponse = await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: COL_SEGMENT_PROGRESS_USER,
          rkey: segmentRkey,
          record: progressRecord as any,
        });
      } catch (err: any) {
        ctx.logger.error(
          { err },
          'Failed to write segment progress to user PDS'
        );
        return res
          .status(500)
          .json({ error: 'Failed to create progress record' });
      }

      // Cache completion in Postgres for roster queries
      try {
        await ctx.db
          .insertInto('segment_completions')
          .values({
            community_did: communityDid,
            segment_rkey: segmentRkey,
            user_did: userDid!,
            completed_at: new Date(now),
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      } catch (cacheErr) {
        ctx.logger.warn(
          { err: cacheErr },
          'Failed to cache segment completion'
        );
      }

      // ── Sync to personal progress ──────────────────────────────
      // If the segment has an endPercent, create/update a personal
      // reviewsegment at that percentage for the user's library.
      // These calls are the primary B5 sync — they remain unchanged.
      const segVal = segment.value as any;
      if (segVal.endPercent != null) {
        try {
          const itemRecord = await opensocial.getCommunityRecord(
            communityDid,
            COL_LISTITEM,
            rkeyFromUri(segVal.listItemUri)
          );
          const itemVal = itemRecord.value as any;

          if (itemVal.mediaItemId) {
            const syncBody = {
              percentage: segVal.endPercent,
              title: segVal.label,
              mediaItemId: itemVal.mediaItemId,
              mediaType: itemVal.mediaType,
            };

            const cookie = req.headers.cookie;
            if (cookie) {
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              await fetch(`${baseUrl}/reviewsegments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify(syncBody),
              }).catch((err) => {
                ctx.logger.warn(
                  { err },
                  'Failed to sync personal review segment'
                );
              });

              await fetch(`${baseUrl}/collections/quick-add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify({
                  mediaItemId: itemVal.mediaItemId,
                  mediaType: itemVal.mediaType,
                  title: itemVal.title,
                  creator: itemVal.creator,
                  status: 'in-progress',
                }),
              }).catch((err) => {
                ctx.logger.warn({ err }, 'Failed to sync personal collection');
              });
            }
          }
        } catch (syncErr) {
          ctx.logger.warn({ err: syncErr }, 'Failed to sync personal progress');
          // Non-fatal — the user PDS progress record is already written
        }
      }

      return res.json({
        progress: {
          uri: userPdsResponse.data.uri,
          rkey: segmentRkey,
          segmentUri: segment.uri,
          communityDid,
          completed: true,
          createdAt: now,
        },
      });
    })
  );

  /**
   * DELETE /groups/:communityDid/segments/:segmentRkey/progress
   * Unmark the current user's completion of a segment.
   * Deletes the app.collectivesocial.feed.segmentprogress record from user PDS.
   * rkey = segmentRkey (matches the idempotent putRecord on creation).
   */
  router.delete(
    '/segments/:segmentRkey/progress',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid, userDid } = req.groupAuth!;
      const segmentRkey = req.params.segmentRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: COL_SEGMENT_PROGRESS_USER,
          rkey: segmentRkey,
        });
      } catch (err: any) {
        ctx.logger.error(
          { err },
          'Failed to delete segment progress from user PDS'
        );
        return res
          .status(500)
          .json({ error: 'Failed to delete progress record' });
      }

      // Remove from cache
      try {
        await ctx.db
          .deleteFrom('segment_completions')
          .where('community_did', '=', communityDid)
          .where('segment_rkey', '=', segmentRkey)
          .where('user_did', '=', userDid!)
          .execute();
      } catch (cacheErr) {
        ctx.logger.warn(
          { err: cacheErr },
          'Failed to remove cached completion'
        );
      }

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
      const segmentRkey = req.params.segmentRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let segment: PdsRecord;
      try {
        segment = await opensocial.getCommunityRecord(
          communityDid,
          COL_SEGMENT,
          segmentRkey
        );
      } catch {
        return res.status(404).json({ error: 'Segment not found' });
      }

      try {
        // Fetch posts using new dual-storage pattern with legacy support
        const posts = await groupPostService.fetchGroupPostsWithLegacy(
          agent,
          communityDid,
          {
            segmentUri: segment.uri,
          }
        );

        // Enrich with user profiles and build threads in one pass
        const dids = userProfileService.extractDidsFromPosts(posts);
        const profiles = await userProfileService.enrichWithUserProfiles(dids);
        const enrichedThreads = userProfileService.buildThreadsWithProfiles(
          posts,
          profiles
        );

        return res.json({ posts: enrichedThreads });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch posts');
        return res.status(500).json({ error: 'Failed to fetch posts' });
      }
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
      const itemRkey = req.params.itemRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let item: PdsRecord;
      try {
        item = await opensocial.getCommunityRecord(
          communityDid,
          COL_LISTITEM,
          itemRkey
        );
      } catch {
        return res.status(404).json({ error: 'Item not found' });
      }

      try {
        // Fetch posts using new dual-storage pattern with legacy support
        const posts = await groupPostService.fetchGroupPostsWithLegacy(
          agent,
          communityDid,
          {
            listItemUri: item.uri,
          }
        );

        // Enrich with user profiles and build threads in one pass
        const dids = userProfileService.extractDidsFromPosts(posts);
        const profiles = await userProfileService.enrichWithUserProfiles(dids);
        const enrichedThreads = userProfileService.buildThreadsWithProfiles(
          posts,
          profiles
        );

        return res.json({ posts: enrichedThreads });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch posts');
        return res.status(500).json({ error: 'Failed to fetch posts' });
      }
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

      if (!text?.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Create post using dual-storage pattern (user repo + group index)
        const { postUri, indexUri } = await groupPostService.createGroupPost(
          agent,
          userDid,
          communityDid,
          {
            text: text.trim(),
            segmentUri,
            listItemUri,
            parentPostUri,
            mentionedDids: mentionedDids || [],
          }
        );

        // Notifications
        if (parentPostUri) {
          // Extract author DID from parent post URI
          const parentMatch = parentPostUri.match(/at:\/\/([^\/]+)\//);
          const parentAuthor = parentMatch ? parentMatch[1] : null;
          if (parentAuthor && parentAuthor !== userDid) {
            await createNotification(ctx.db, {
              communityDid,
              recipientDid: parentAuthor,
              actorDid: userDid,
              type: 'reply',
              subjectUri: postUri,
              subjectType: 'post',
              message: 'replied to your post',
            });
          }
        } else {
          await notifyAllMembers(ctx.db, communityDid, userDid, 'new_post', {
            subjectUri: postUri,
            subjectType: 'post',
            message: 'posted in the discussion',
          });
        }

        if (mentionedDids?.length) {
          await notifyUsers(
            ctx.db,
            communityDid,
            userDid,
            mentionedDids,
            'mention',
            {
              subjectUri: postUri,
              subjectType: 'post',
              message: 'mentioned you in a post',
            }
          );
        }

        return res.json({
          success: true,
          postUri,
          indexUri,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create post');
        return res.status(500).json({ error: 'Failed to create post' });
      }
    })
  );

  /**
   * DELETE /groups/:communityDid/posts
   * Delete a post. Author or admin can delete.
   * Body: { postUri }
   */
  router.delete(
    '/posts',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid, isAdmin } = req.groupAuth!;
      const { postUri } = req.body;

      if (!postUri) {
        return res.status(400).json({ error: 'Post URI is required' });
      }

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Extract author DID from URI
        const match = postUri.match(/at:\/\/([^\/]+)\//);
        const authorDid = match ? match[1] : null;

        if (!authorDid) {
          return res.status(400).json({ error: 'Invalid post URI' });
        }

        if (authorDid === userDid) {
          // User deleting their own post — also cleans up the community postindex
          await groupPostService.deleteGroupPost(
            agent,
            postUri,
            communityDid,
            userDid
          );
        } else if (isAdmin) {
          // Admin marking post as deleted
          await groupPostService.adminDeleteGroupPost(
            communityDid,
            userDid,
            postUri
          );
        } else {
          return res.status(403).json({
            error: 'Only the author or an admin can delete this post',
          });
        }

        return res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete post');
        return res.status(500).json({ error: 'Failed to delete post' });
      }
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
      const postRkey = req.params.postRkey as string;

      let post: PdsRecord;
      try {
        post = await opensocial.getCommunityRecord(
          communityDid,
          COL_POST,
          postRkey
        );
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }

      const allReactions = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_REACTION
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
      const postRkey = req.params.postRkey as string;
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ error: 'emoji is required' });
      }

      let post: PdsRecord;
      try {
        post = await opensocial.getCommunityRecord(
          communityDid,
          COL_POST,
          postRkey
        );
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Check for existing reaction (toggle off)
      const allReactions = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_REACTION
      );
      const existing = allReactions.find(
        (r: any) =>
          r.value.postUri === post.uri &&
          r.value.authorDid === userDid &&
          r.value.emoji === emoji
      );

      if (existing) {
        await opensocial.deleteCommunityRecord(
          communityDid,
          userDid,
          COL_REACTION,
          rkeyFromUri(existing.uri)
        );
        return res.json({ action: 'removed', emoji });
      }

      // Create new reaction
      const now = new Date().toISOString();
      const pdsRecord = await opensocial.createCommunityRecord(
        communityDid,
        userDid,
        COL_REACTION,
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
      communityDid,
      COL_POST
    );
    const childPosts = allPosts.filter(
      (r: any) => r.value.parentPostUri === postUri
    );
    for (const child of childPosts) {
      await deletePostAndReactions(communityDid, userDid, child.uri);
    }

    // Delete reactions on this post
    const allReactions = await opensocial.listAllCommunityRecords(
      communityDid,
      COL_REACTION
    );
    const postReactions = allReactions.filter(
      (r: any) => r.value.postUri === postUri
    );
    for (const reaction of postReactions) {
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_REACTION,
        rkeyFromUri(reaction.uri)
      );
    }

    // Delete the post
    await opensocial.deleteCommunityRecord(
      communityDid,
      userDid,
      COL_POST,
      postRkey
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
      communityDid,
      COL_SEGMENT
    );
    const itemSegments = allSegments.filter(
      (r: any) => r.value.listItemUri === itemUri
    );
    for (const seg of itemSegments) {
      // NOTE: Segment progress now lives in each user's personal PDS.
      // The server cannot enumerate or delete on behalf of users.
      // These records become stale but harmless when a segment is removed.

      // Delete posts for this segment
      const allPosts = await opensocial.listAllCommunityRecords(
        communityDid,
        COL_POST
      );
      const segPosts = allPosts.filter(
        (r: any) => r.value.segmentUri === seg.uri
      );
      for (const post of segPosts) {
        await deletePostAndReactions(communityDid, userDid, post.uri);
      }
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_SEGMENT,
        rkeyFromUri(seg.uri)
      );
    }

    // Delete posts directly on the item (not tied to a segment)
    const allPosts = await opensocial.listAllCommunityRecords(
      communityDid,
      COL_POST
    );
    const itemPosts = allPosts.filter(
      (r: any) => r.value.listItemUri === itemUri && !r.value.segmentUri
    );
    for (const post of itemPosts) {
      await deletePostAndReactions(communityDid, userDid, post.uri);
    }

    // Delete status record for this item
    const allStatuses = await opensocial.listAllCommunityRecords(
      communityDid,
      COL_LISTITEM_STATUS
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
      communityDid,
      userDid,
      COL_LISTITEM,
      itemRkey
    );
  }

  return router;
};
