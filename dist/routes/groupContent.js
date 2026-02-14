"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("../lib/http");
const groupAuth_1 = require("../middleware/groupAuth");
const opensocial = __importStar(require("../services/opensocial"));
const opensocial_1 = require("../services/opensocial");
const notifications_1 = require("../services/notifications");
const groupPostService = __importStar(require("../services/groupPosts"));
const userProfileService = __importStar(require("../services/userProfiles"));
const agent_1 = require("../auth/agent");
// ── Collection constants ──────────────────────────────────────────
const COL_LIST = 'app.collectivesocial.group.list';
const COL_LISTITEM = 'app.collectivesocial.group.listitem';
const COL_LISTITEM_STATUS = 'app.collectivesocial.group.listitem.status';
const COL_SEGMENT = 'app.collectivesocial.group.segment';
const COL_SEGMENT_PROGRESS = 'app.collectivesocial.group.segment.progress';
const COL_POST = 'app.collectivesocial.group.post';
const COL_REACTION = 'app.collectivesocial.group.reaction';
const createRouter = (ctx) => {
    const router = express_1.default.Router({ mergeParams: true });
    // Membership middleware: authenticates and attaches groupAuth context.
    // Fine-grained permission enforcement (member vs admin per collection)
    // is handled by open-social when the record write is proxied.
    const memberOnly = (0, groupAuth_1.requireGroupMember)(ctx);
    // ═══════════════════════════════════════════════════════════════
    // LISTS
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/lists
     * List all shared lists for a community (from PDS).
     */
    router.get('/lists', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const records = await opensocial.listAllCommunityRecords(communityDid, COL_LIST);
        const lists = records
            .map((r) => ({ uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value }))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json({ lists });
    }));
    /**
     * GET /groups/:communityDid/lists/:rkey
     * Get a single list with its items (from PDS).
     */
    router.get('/lists/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { rkey } = req.params;
        let list;
        try {
            list = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
        }
        catch {
            return res.status(404).json({ error: 'List not found' });
        }
        // Fetch all items and filter by this list's URI
        const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
        const items = allItems
            .filter((r) => r.value.listUri === list.uri)
            .map((r) => ({ uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        // Fetch status records to enrich items
        const allStatuses = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM_STATUS);
        const statusByItemUri = new Map();
        for (const s of allStatuses) {
            statusByItemUri.set(s.value.listItemUri, s.value);
        }
        const enrichedItems = items.map((item) => {
            const status = statusByItemUri.get(item.uri || `at://${communityDid}/${COL_LISTITEM}/${item.rkey}`);
            return {
                ...item,
                status: status?.status ?? 'not-started',
            };
        });
        return res.json({
            list: { uri: list.uri, rkey: (0, opensocial_1.rkeyFromUri)(list.uri), ...list.value },
            items: enrichedItems,
        });
    }));
    /**
     * POST /groups/:communityDid/lists
     * Create a new shared list. Any member can create.
     *
     * Body: { name, description?, purpose?, segmentType? }
     */
    router.post('/lists', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { name, description, purpose, segmentType } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }
        const now = new Date().toISOString();
        const pdsRecord = await opensocial.createCommunityRecord(communityDid, userDid, COL_LIST, { name, description, purpose, segmentType, createdBy: userDid, createdAt: now });
        // Notify members
        await (0, notifications_1.notifyAllMembers)(ctx.db, communityDid, userDid, 'new_list', {
            subjectUri: pdsRecord.uri,
            subjectType: 'list',
            message: `created a new list: ${name}`,
        });
        return res.json({
            list: {
                uri: pdsRecord.uri,
                rkey: (0, opensocial_1.rkeyFromUri)(pdsRecord.uri),
                name,
                description,
                purpose,
                segmentType,
                createdBy: userDid,
                createdAt: now,
            },
        });
    }));
    /**
     * PUT /groups/:communityDid/lists/:rkey
     * Update a list. Admin only.
     *
     * Body: { name?, description?, purpose?, segmentType? }
     */
    router.put('/lists/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        const { name, description, purpose, segmentType } = req.body;
        // Fetch existing to merge
        let existing;
        try {
            existing = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
        }
        catch {
            return res.status(404).json({ error: 'List not found' });
        }
        const updatedRecord = {
            ...existing.value,
            name: name ?? existing.value.name,
            description: description !== undefined ? description : existing.value.description,
            purpose: purpose !== undefined ? purpose : existing.value.purpose,
            segmentType: segmentType !== undefined ? segmentType : existing.value.segmentType,
        };
        const result = await opensocial.updateCommunityRecord(communityDid, userDid, COL_LIST, rkey, updatedRecord);
        return res.json({
            list: { uri: result.uri, rkey, ...updatedRecord },
        });
    }));
    /**
     * DELETE /groups/:communityDid/lists/:rkey
     * Delete a list and all its items/segments. Admin only.
     */
    router.delete('/lists/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        // Get the list URI to find children
        let list;
        try {
            list = await opensocial.getCommunityRecord(communityDid, COL_LIST, rkey);
        }
        catch {
            return res.status(404).json({ error: 'List not found' });
        }
        // Delete all child items (and their children: segments, posts, reactions)
        const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
        const listItems = allItems.filter((r) => r.value.listUri === list.uri);
        for (const item of listItems) {
            await deleteItemAndChildren(communityDid, userDid, item.uri, (0, opensocial_1.rkeyFromUri)(item.uri));
        }
        // Delete the list itself
        await opensocial.deleteCommunityRecord(communityDid, userDid, COL_LIST, rkey);
        return res.json({ success: true });
    }));
    // ═══════════════════════════════════════════════════════════════
    // LIST ITEMS
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/lists/:listRkey/items
     * List all items for a list.
     */
    router.get('/lists/:listRkey/items', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { listRkey } = req.params;
        // Get the list URI
        let list;
        try {
            list = await opensocial.getCommunityRecord(communityDid, COL_LIST, listRkey);
        }
        catch {
            return res.status(404).json({ error: 'List not found' });
        }
        const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
        const items = allItems
            .filter((r) => r.value.listUri === list.uri)
            .map((r) => ({ uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return res.json({ items });
    }));
    /**
     * POST /groups/:communityDid/lists/:listRkey/items
     * Add an item to a list. Any member can add.
     *
     * Body: { title, creator?, mediaItemId?, mediaType, order? }
     */
    router.post('/lists/:listRkey/items', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { listRkey } = req.params;
        const { title, creator, mediaItemId, mediaType, order } = req.body;
        if (!title || !mediaType) {
            return res.status(400).json({ error: 'title and mediaType are required' });
        }
        // Get the list URI + name
        let list;
        try {
            list = await opensocial.getCommunityRecord(communityDid, COL_LIST, listRkey);
        }
        catch {
            return res.status(404).json({ error: 'List not found' });
        }
        // Determine order from existing items
        let itemOrder = order;
        if (itemOrder == null) {
            const allItems = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM);
            const listItems = allItems.filter((r) => r.value.listUri === list.uri);
            const maxOrder = listItems.reduce((max, r) => Math.max(max, r.value.order ?? 0), -1);
            itemOrder = maxOrder + 1;
        }
        const now = new Date().toISOString();
        const pdsRecord = await opensocial.createCommunityRecord(communityDid, userDid, COL_LISTITEM, {
            listUri: list.uri,
            title,
            creator,
            mediaItemId,
            mediaType,
            order: itemOrder,
            addedBy: userDid,
            createdAt: now,
        });
        await (0, notifications_1.notifyAllMembers)(ctx.db, communityDid, userDid, 'new_item', {
            subjectUri: pdsRecord.uri,
            subjectType: 'listitem',
            message: `added "${title}" to ${list.value.name}`,
        });
        return res.json({
            item: {
                uri: pdsRecord.uri,
                rkey: (0, opensocial_1.rkeyFromUri)(pdsRecord.uri),
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
    }));
    /**
     * PUT /groups/:communityDid/items/:rkey/status
     * Set the group status of a list item. Admin only.
     *
     * Body: { status: 'not-started' | 'in-progress' | 'completed' }
     */
    router.put('/items/:rkey/status', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        const { status } = req.body;
        const validStatuses = ['not-started', 'in-progress', 'completed'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                error: `status must be one of: ${validStatuses.join(', ')}`,
            });
        }
        // Get the item
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, rkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        const now = new Date().toISOString();
        // Find existing status record for this item
        const allStatuses = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM_STATUS);
        const existingStatus = allStatuses.find((r) => r.value.listItemUri === item.uri);
        let statusUri;
        if (existingStatus) {
            const statusRkey = (0, opensocial_1.rkeyFromUri)(existingStatus.uri);
            const result = await opensocial.updateCommunityRecord(communityDid, userDid, COL_LISTITEM_STATUS, statusRkey, { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now });
            statusUri = result.uri;
        }
        else {
            const result = await opensocial.createCommunityRecord(communityDid, userDid, COL_LISTITEM_STATUS, { listItemUri: item.uri, status, updatedBy: userDid, updatedAt: now });
            statusUri = result.uri;
        }
        await (0, notifications_1.notifyAllMembers)(ctx.db, communityDid, userDid, 'status_change', {
            subjectUri: item.uri,
            subjectType: 'listitem',
            message: `marked "${item.value.title}" as ${status}`,
        });
        return res.json({
            item: { uri: item.uri, rkey, ...item.value, status, statusUri },
        });
    }));
    /**
     * DELETE /groups/:communityDid/items/:rkey
     * Remove an item from a list. Admin only.
     */
    router.delete('/items/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, rkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        await deleteItemAndChildren(communityDid, userDid, item.uri, rkey);
        return res.json({ success: true });
    }));
    // ═══════════════════════════════════════════════════════════════
    // SEGMENTS (reading assignments)
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/items/:itemRkey/segments
     * List all segments for a list item.
     */
    router.get('/items/:itemRkey/segments', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { itemRkey } = req.params;
        // Get the item URI
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        const allSegments = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT);
        const segments = allSegments
            .filter((r) => r.value.listItemUri === item.uri)
            .map((r) => ({ uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return res.json({ segments });
    }));
    /**
     * GET /groups/:communityDid/items/:itemRkey/progress
     * Batch-fetch all segment progress for all segments of an item.
     * Returns a map keyed by segment URI → array of progress records.
     * This replaces N individual /segments/:rkey/progress calls with ONE call.
     */
    router.get('/items/:itemRkey/progress', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { itemRkey } = req.params;
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        // Get all segments for this item
        const allSegments = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT);
        const itemSegments = allSegments.filter((r) => r.value.listItemUri === item.uri);
        const segmentUris = new Set(itemSegments.map((s) => s.uri));
        // Get ALL progress records once (not per-segment)
        let allProgress = [];
        try {
            allProgress = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT_PROGRESS);
        }
        catch (err) {
            console.error('Failed to list segment progress:', err);
        }
        // Group progress by segment URI
        const progressBySegment = {};
        for (const p of allProgress) {
            const segUri = p.value.segmentUri;
            if (segmentUris.has(segUri)) {
                if (!progressBySegment[segUri])
                    progressBySegment[segUri] = [];
                progressBySegment[segUri].push({
                    uri: p.uri,
                    rkey: (0, opensocial_1.rkeyFromUri)(p.uri),
                    ...p.value,
                });
            }
        }
        return res.json({ progressBySegment });
    }));
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
    router.post('/items/:itemRkey/segments', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { itemRkey } = req.params;
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        let { label, segmentType, startPage, endPage, startPercent, endPercent, startChapter, endChapter, assignedDate, order, } = req.body;
        if (!label) {
            return res.status(400).json({ error: 'label is required' });
        }
        // Auto-derive page/percent from chapter map if available
        const mediaItemId = item.value.mediaItemId;
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
                const startCh = map.chapters?.find((c) => c.chapter === startChapter);
                const endCh = endChapter != null
                    ? map.chapters?.find((c) => c.chapter === endChapter)
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
            const allSegments = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT);
            const itemSegments = allSegments.filter((r) => r.value.listItemUri === item.uri);
            const maxOrder = itemSegments.reduce((max, r) => Math.max(max, r.value.order ?? 0), -1);
            order = maxOrder + 1;
        }
        const now = new Date().toISOString();
        const pdsRecord = await opensocial.createCommunityRecord(communityDid, userDid, COL_SEGMENT, {
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
        });
        await (0, notifications_1.notifyAllMembers)(ctx.db, communityDid, userDid, 'new_segment', {
            subjectUri: pdsRecord.uri,
            subjectType: 'segment',
            message: `assigned: ${label}`,
        });
        return res.json({
            segment: {
                uri: pdsRecord.uri,
                rkey: (0, opensocial_1.rkeyFromUri)(pdsRecord.uri),
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
    }));
    /**
     * PUT /groups/:communityDid/segments/:rkey
     * Update a segment. Admin only.
     */
    router.put('/segments/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        let existing;
        try {
            existing = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, rkey);
        }
        catch {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const { label, segmentType, startPage, endPage, startPercent, endPercent, startChapter, endChapter, assignedDate, order, } = req.body;
        const val = existing.value;
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
        const result = await opensocial.updateCommunityRecord(communityDid, userDid, COL_SEGMENT, rkey, updatedRecord);
        return res.json({
            segment: { uri: result.uri, rkey, ...updatedRecord },
        });
    }));
    /**
     * DELETE /groups/:communityDid/segments/:rkey
     * Delete a segment. Admin only.
     */
    router.delete('/segments/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        // Delete any posts associated with this segment
        let segment;
        try {
            segment = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, rkey);
        }
        catch {
            return res.status(404).json({ error: 'Segment not found' });
        }
        // Delete progress records for this segment
        const allProgress = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT_PROGRESS);
        const segProgress = allProgress.filter((r) => r.value.segmentUri === segment.uri);
        for (const prog of segProgress) {
            await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT_PROGRESS, (0, opensocial_1.rkeyFromUri)(prog.uri));
        }
        // Delete child posts + reactions
        const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
        const segmentPosts = allPosts.filter((r) => r.value.segmentUri === segment.uri);
        for (const post of segmentPosts) {
            await deletePostAndReactions(communityDid, userDid, post.uri);
        }
        await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT, rkey);
        return res.json({ success: true });
    }));
    // ═══════════════════════════════════════════════════════════════
    // SEGMENT PROGRESS (per-member completion tracking)
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/segments/:segmentRkey/progress
     * List all members' progress for a segment (powers the roster view).
     */
    router.get('/segments/:segmentRkey/progress', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { segmentRkey } = req.params;
        let segment;
        try {
            segment = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, segmentRkey);
        }
        catch {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const allProgress = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT_PROGRESS);
        const segmentProgress = allProgress
            .filter((r) => r.value.segmentUri === segment.uri)
            .map((r) => ({ uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value }));
        return res.json({ progress: segmentProgress });
    }));
    /**
     * POST /groups/:communityDid/segments/:segmentRkey/progress
     * Mark the current user as having completed a segment.
     * Also syncs to the user's personal progress (reviewsegment + useritem).
     *
     * Body: {} (no fields needed — uses auth context)
     */
    router.post('/segments/:segmentRkey/progress', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { segmentRkey } = req.params;
        let segment;
        try {
            segment = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, segmentRkey);
        }
        catch {
            return res.status(404).json({ error: 'Segment not found' });
        }
        // Check for duplicate — member may have already marked this segment
        let allProgress;
        try {
            allProgress = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT_PROGRESS);
        }
        catch (err) {
            console.error('Failed to list segment progress records:', err);
            allProgress = [];
        }
        const existing = allProgress.find((r) => r.value.segmentUri === segment.uri && r.value.memberDid === userDid);
        if (existing) {
            return res.json({
                progress: { uri: existing.uri, rkey: (0, opensocial_1.rkeyFromUri)(existing.uri), ...existing.value },
                alreadyExists: true,
            });
        }
        const now = new Date().toISOString();
        let pdsRecord;
        try {
            pdsRecord = await opensocial.createCommunityRecord(communityDid, userDid, COL_SEGMENT_PROGRESS, {
                segmentUri: segment.uri,
                memberDid: userDid,
                completed: true,
                completedAt: now,
            });
        }
        catch (err) {
            console.error('Failed to create segment progress record:', err);
            return res.status(err.status || 500).json({
                error: err.message || 'Failed to create progress record',
            });
        }
        // ── Sync to personal progress ──────────────────────────────
        // If the segment has an endPercent, create/update a personal
        // reviewsegment at that percentage for the user's library.
        const segVal = segment.value;
        if (segVal.endPercent != null) {
            try {
                // Forward to the personal reviewsegment endpoint
                // This is an internal call — the user's session cookie is on the request
                const itemRecord = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, (0, opensocial_1.rkeyFromUri)(segVal.listItemUri));
                const itemVal = itemRecord.value;
                if (itemVal.mediaItemId) {
                    // Create personal review segment via internal API call
                    const syncBody = {
                        percentage: segVal.endPercent,
                        title: segVal.label,
                        mediaItemId: itemVal.mediaItemId,
                        mediaType: itemVal.mediaType,
                    };
                    // Use the user's cookie to call the personal reviewsegment endpoint
                    const cookie = req.headers.cookie;
                    if (cookie) {
                        const baseUrl = `${req.protocol}://${req.get('host')}`;
                        await fetch(`${baseUrl}/reviewsegments`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Cookie: cookie,
                            },
                            body: JSON.stringify(syncBody),
                        }).catch((err) => {
                            console.warn('Failed to sync personal review segment:', err);
                        });
                        // Also ensure the user's personal useritem status is 'in-progress'
                        // if it's currently 'want'. We do this via the quick-add endpoint
                        // which handles finding/creating the default list and upserting useritem.
                        await fetch(`${baseUrl}/collections/quick-add`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Cookie: cookie,
                            },
                            body: JSON.stringify({
                                mediaItemId: itemVal.mediaItemId,
                                mediaType: itemVal.mediaType,
                                title: itemVal.title,
                                creator: itemVal.creator,
                                status: 'in-progress',
                            }),
                        }).catch((err) => {
                            console.warn('Failed to sync personal collection:', err);
                        });
                    }
                }
            }
            catch (syncErr) {
                console.warn('Failed to sync personal progress:', syncErr);
                // Non-fatal — the group progress is still recorded
            }
        }
        return res.json({
            progress: {
                uri: pdsRecord.uri,
                rkey: (0, opensocial_1.rkeyFromUri)(pdsRecord.uri),
                segmentUri: segment.uri,
                memberDid: userDid,
                completed: true,
                completedAt: now,
            },
        });
    }));
    /**
     * DELETE /groups/:communityDid/segments/:segmentRkey/progress/:rkey
     * Unmark the current user's completion of a segment.
     */
    router.delete('/segments/:segmentRkey/progress/:rkey', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { rkey } = req.params;
        await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT_PROGRESS, rkey);
        return res.json({ success: true });
    }));
    // ═══════════════════════════════════════════════════════════════
    // POSTS (discussions)
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/segments/:segmentRkey/posts
     * List all top-level posts for a segment, with nested replies.
     */
    router.get('/segments/:segmentRkey/posts', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { segmentRkey } = req.params;
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        let segment;
        try {
            segment = await opensocial.getCommunityRecord(communityDid, COL_SEGMENT, segmentRkey);
        }
        catch {
            return res.status(404).json({ error: 'Segment not found' });
        }
        try {
            // Fetch posts using new dual-storage pattern with legacy support
            const posts = await groupPostService.fetchGroupPostsWithLegacy(agent, communityDid, {
                segmentUri: segment.uri,
            });
            // Enrich with user profiles
            const dids = userProfileService.extractDidsFromPosts(posts);
            const profiles = await userProfileService.enrichWithUserProfiles(dids);
            // Build threads with author profiles
            const threads = groupPostService.buildThreads(posts);
            const enrichedThreads = userProfileService.buildThreadsWithProfiles(threads, profiles);
            return res.json({ posts: enrichedThreads });
        }
        catch (err) {
            console.error('Failed to fetch posts:', err);
            return res.status(500).json({ error: 'Failed to fetch posts' });
        }
    }));
    /**
     * GET /groups/:communityDid/items/:itemRkey/posts
     * List all top-level posts for a list item.
     */
    router.get('/items/:itemRkey/posts', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { itemRkey } = req.params;
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        let item;
        try {
            item = await opensocial.getCommunityRecord(communityDid, COL_LISTITEM, itemRkey);
        }
        catch {
            return res.status(404).json({ error: 'Item not found' });
        }
        try {
            // Fetch posts using new dual-storage pattern with legacy support
            const posts = await groupPostService.fetchGroupPostsWithLegacy(agent, communityDid, {
                listItemUri: item.uri,
            });
            // Enrich with user profiles
            const dids = userProfileService.extractDidsFromPosts(posts);
            const profiles = await userProfileService.enrichWithUserProfiles(dids);
            // Build threads with author profiles
            const threads = groupPostService.buildThreads(posts);
            const enrichedThreads = userProfileService.buildThreadsWithProfiles(threads, profiles);
            return res.json({ posts: enrichedThreads });
        }
        catch (err) {
            console.error('Failed to fetch posts:', err);
            return res.status(500).json({ error: 'Failed to fetch posts' });
        }
    }));
    /**
     * POST /groups/:communityDid/posts
     * Create a discussion post. Any member can post.
     *
     * Body: { text, segmentUri?, listItemUri?, parentPostUri?, mentionedDids? }
     */
    router.post('/posts', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { text, segmentUri, listItemUri, parentPostUri, mentionedDids } = req.body;
        if (!text?.trim()) {
            return res.status(400).json({ error: 'text is required' });
        }
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            // Create post using dual-storage pattern (user repo + group index)
            const { postUri, indexUri } = await groupPostService.createGroupPost(agent, userDid, communityDid, {
                text: text.trim(),
                segmentUri,
                listItemUri,
                parentPostUri,
                mentionedDids: mentionedDids || [],
            });
            // Notifications
            if (parentPostUri) {
                // Extract author DID from parent post URI
                const parentMatch = parentPostUri.match(/at:\/\/([^\/]+)\//);
                const parentAuthor = parentMatch ? parentMatch[1] : null;
                if (parentAuthor && parentAuthor !== userDid) {
                    await (0, notifications_1.createNotification)(ctx.db, {
                        communityDid,
                        recipientDid: parentAuthor,
                        actorDid: userDid,
                        type: 'reply',
                        subjectUri: postUri,
                        subjectType: 'post',
                        message: 'replied to your post',
                    });
                }
            }
            else {
                await (0, notifications_1.notifyAllMembers)(ctx.db, communityDid, userDid, 'new_post', {
                    subjectUri: postUri,
                    subjectType: 'post',
                    message: 'posted in the discussion',
                });
            }
            if (mentionedDids?.length) {
                await (0, notifications_1.notifyUsers)(ctx.db, communityDid, userDid, mentionedDids, 'mention', {
                    subjectUri: postUri,
                    subjectType: 'post',
                    message: 'mentioned you in a post',
                });
            }
            return res.json({
                success: true,
                postUri,
                indexUri,
            });
        }
        catch (err) {
            console.error('Failed to create post:', err);
            return res.status(500).json({ error: 'Failed to create post' });
        }
    }));
    /**
     * DELETE /groups/:communityDid/posts
     * Delete a post. Author or admin can delete.
     * Body: { postUri }
     */
    router.delete('/posts', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid, isAdmin } = req.groupAuth;
        const { postUri } = req.body;
        if (!postUri) {
            return res.status(400).json({ error: 'Post URI is required' });
        }
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
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
                // User deleting their own post
                await groupPostService.deleteGroupPost(agent, postUri);
            }
            else if (isAdmin) {
                // Admin marking post as deleted
                await groupPostService.adminDeleteGroupPost(communityDid, userDid, postUri);
            }
            else {
                return res.status(403).json({
                    error: 'Only the author or an admin can delete this post',
                });
            }
            return res.json({ success: true });
        }
        catch (err) {
            console.error('Failed to delete post:', err);
            return res.status(500).json({ error: 'Failed to delete post' });
        }
    }));
    // ═══════════════════════════════════════════════════════════════
    // REACTIONS
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/posts/:postRkey/reactions
     * Get all reactions on a post.
     */
    router.get('/posts/:postRkey/reactions', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const { postRkey } = req.params;
        let post;
        try {
            post = await opensocial.getCommunityRecord(communityDid, COL_POST, postRkey);
        }
        catch {
            return res.status(404).json({ error: 'Post not found' });
        }
        const allReactions = await opensocial.listAllCommunityRecords(communityDid, COL_REACTION);
        const postReactions = allReactions.filter((r) => r.value.postUri === post.uri);
        // Group by emoji
        const grouped = {};
        for (const r of postReactions) {
            const val = r.value;
            if (!grouped[val.emoji]) {
                grouped[val.emoji] = { emoji: val.emoji, count: 0, authors: [] };
            }
            grouped[val.emoji].count++;
            grouped[val.emoji].authors.push(val.authorDid);
        }
        return res.json({ reactions: Object.values(grouped) });
    }));
    /**
     * POST /groups/:communityDid/posts/:postRkey/reactions
     * Toggle an emoji reaction on a post. Any member can react.
     *
     * Body: { emoji }
     */
    router.post('/posts/:postRkey/reactions', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { userDid, communityDid } = req.groupAuth;
        const { postRkey } = req.params;
        const { emoji } = req.body;
        if (!emoji) {
            return res.status(400).json({ error: 'emoji is required' });
        }
        let post;
        try {
            post = await opensocial.getCommunityRecord(communityDid, COL_POST, postRkey);
        }
        catch {
            return res.status(404).json({ error: 'Post not found' });
        }
        // Check for existing reaction (toggle off)
        const allReactions = await opensocial.listAllCommunityRecords(communityDid, COL_REACTION);
        const existing = allReactions.find((r) => r.value.postUri === post.uri &&
            r.value.authorDid === userDid &&
            r.value.emoji === emoji);
        if (existing) {
            await opensocial.deleteCommunityRecord(communityDid, userDid, COL_REACTION, (0, opensocial_1.rkeyFromUri)(existing.uri));
            return res.json({ action: 'removed', emoji });
        }
        // Create new reaction
        const now = new Date().toISOString();
        const pdsRecord = await opensocial.createCommunityRecord(communityDid, userDid, COL_REACTION, { postUri: post.uri, emoji, authorDid: userDid, createdAt: now });
        // Notify post author
        const postAuthor = post.value.authorDid;
        if (postAuthor) {
            await (0, notifications_1.createNotification)(ctx.db, {
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
    }));
    // ═══════════════════════════════════════════════════════════════
    // MEMBERS
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/members
     * List all members of the community.
     */
    router.get('/members', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const search = req.query.search;
        const result = await opensocial.listMembers(communityDid, search);
        return res.json(result);
    }));
    // ═══════════════════════════════════════════════════════════════
    // CHAPTER MAP (media item enrichment — still in Postgres)
    // ═══════════════════════════════════════════════════════════════
    /**
     * PUT /groups/:communityDid/media/:mediaItemId/chapters
     * Set the chapter map for a media item. Admin only.
     */
    router.put('/media/:mediaItemId/chapters', memberOnly, (0, http_1.handler)(async (req, res) => {
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
            .set({ chapterMap: chapterMap, updatedAt: new Date() })
            .where('id', '=', mediaItemId)
            .execute();
        return res.json({
            success: true,
            chapterMap: { totalChapters, chapters },
        });
    }));
    /**
     * GET /groups/:communityDid/media/:mediaItemId/chapters
     * Get the chapter map for a media item.
     */
    router.get('/media/:mediaItemId/chapters', memberOnly, (0, http_1.handler)(async (req, res) => {
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
    }));
    // ═══════════════════════════════════════════════════════════════
    // FEED (group activity — reads from PDS)
    // ═══════════════════════════════════════════════════════════════
    /**
     * GET /groups/:communityDid/feed
     * Get a chronological activity feed for the group.
     */
    router.get('/feed', memberOnly, (0, http_1.handler)(async (req, res) => {
        const { communityDid } = req.groupAuth;
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        // Fetch posts and segments from PDS
        const [posts, segments] = await Promise.all([
            opensocial.listAllCommunityRecords(communityDid, COL_POST),
            opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT),
        ]);
        const feed = [
            ...posts
                .filter((r) => !r.value.parentPostUri)
                .map((r) => ({
                type: 'post',
                data: { uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value },
                createdAt: r.value.createdAt,
            })),
            ...segments.map((r) => ({
                type: 'segment',
                data: { uri: r.uri, rkey: (0, opensocial_1.rkeyFromUri)(r.uri), ...r.value },
                createdAt: r.value.createdAt,
            })),
        ]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);
        return res.json({ feed });
    }));
    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════
    /** Build nested thread structure from flat posts array. */
    function buildThreads(posts) {
        const sorted = posts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const topLevel = sorted.filter((p) => !p.parentPostUri);
        const replies = sorted.filter((p) => p.parentPostUri);
        const buildThread = (post) => ({
            ...post,
            replies: replies
                .filter((r) => r.parentPostUri === post.uri)
                .map(buildThread),
        });
        return topLevel.map(buildThread);
    }
    /** Delete a post and all its reactions from PDS. */
    async function deletePostAndReactions(communityDid, userDid, postUri) {
        const postRkey = (0, opensocial_1.rkeyFromUri)(postUri);
        // Delete child replies recursively
        const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
        const childPosts = allPosts.filter((r) => r.value.parentPostUri === postUri);
        for (const child of childPosts) {
            await deletePostAndReactions(communityDid, userDid, child.uri);
        }
        // Delete reactions on this post
        const allReactions = await opensocial.listAllCommunityRecords(communityDid, COL_REACTION);
        const postReactions = allReactions.filter((r) => r.value.postUri === postUri);
        for (const reaction of postReactions) {
            await opensocial.deleteCommunityRecord(communityDid, userDid, COL_REACTION, (0, opensocial_1.rkeyFromUri)(reaction.uri));
        }
        // Delete the post
        await opensocial.deleteCommunityRecord(communityDid, userDid, COL_POST, postRkey);
    }
    /** Delete an item and all its children (segments, posts, reactions, status). */
    async function deleteItemAndChildren(communityDid, userDid, itemUri, itemRkey) {
        // Delete segments and their posts
        const allSegments = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT);
        const itemSegments = allSegments.filter((r) => r.value.listItemUri === itemUri);
        for (const seg of itemSegments) {
            // Delete progress records for this segment
            const allProgress = await opensocial.listAllCommunityRecords(communityDid, COL_SEGMENT_PROGRESS);
            const segProgress = allProgress.filter((r) => r.value.segmentUri === seg.uri);
            for (const prog of segProgress) {
                await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT_PROGRESS, (0, opensocial_1.rkeyFromUri)(prog.uri));
            }
            // Delete posts for this segment
            const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
            const segPosts = allPosts.filter((r) => r.value.segmentUri === seg.uri);
            for (const post of segPosts) {
                await deletePostAndReactions(communityDid, userDid, post.uri);
            }
            await opensocial.deleteCommunityRecord(communityDid, userDid, COL_SEGMENT, (0, opensocial_1.rkeyFromUri)(seg.uri));
        }
        // Delete posts directly on the item (not tied to a segment)
        const allPosts = await opensocial.listAllCommunityRecords(communityDid, COL_POST);
        const itemPosts = allPosts.filter((r) => r.value.listItemUri === itemUri && !r.value.segmentUri);
        for (const post of itemPosts) {
            await deletePostAndReactions(communityDid, userDid, post.uri);
        }
        // Delete status record for this item
        const allStatuses = await opensocial.listAllCommunityRecords(communityDid, COL_LISTITEM_STATUS);
        const itemStatus = allStatuses.find((r) => r.value.listItemUri === itemUri);
        if (itemStatus) {
            await opensocial.deleteCommunityRecord(communityDid, userDid, COL_LISTITEM_STATUS, (0, opensocial_1.rkeyFromUri)(itemStatus.uri));
        }
        // Delete the item itself
        await opensocial.deleteCommunityRecord(communityDid, userDid, COL_LISTITEM, itemRkey);
    }
    return router;
};
exports.createRouter = createRouter;
