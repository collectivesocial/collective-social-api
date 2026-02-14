"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("../lib/http");
const agent_1 = require("../auth/agent");
const common_1 = require("@atproto/common");
const createRouter = (ctx) => {
    const router = express_1.default.Router();
    // POST /reviewsegments - Create a new review segment
    router.post('/', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const { title, text, percentage, mediaItemId, mediaType, listItem } = req.body;
            // Validate required fields
            if (percentage === undefined || percentage === null) {
                return res.status(400).json({ error: 'Percentage is required' });
            }
            // Validate percentage range
            if (percentage < 0 || percentage > 100) {
                return res.status(400).json({
                    error: 'Percentage must be between 0 and 100',
                });
            }
            // Create the review segment record
            const now = new Date().toISOString();
            const record = {
                ...(text && text.trim() ? { text: text.trim() } : {}),
                percentage: percentage,
                createdAt: now,
                ...(title && title.trim() ? { title: title.trim() } : {}),
                ...(mediaItemId ? { mediaItemId } : {}),
                ...(mediaType ? { mediaType } : {}),
                ...(listItem ? { listItem } : {}),
            };
            // Generate a new rkey using TID
            const rkey = common_1.TID.nextStr();
            // Put the record in the user's repo
            const response = await agent.api.com.atproto.repo.putRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
                rkey: rkey,
                record: record,
            });
            res.json({
                success: true,
                uri: response.data.uri,
                cid: response.data.cid,
                reviewSegment: {
                    uri: response.data.uri,
                    cid: response.data.cid,
                    value: record,
                },
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to create review segment');
            res.status(500).json({ error: 'Failed to create review segment' });
        }
    }));
    // PUT /reviewsegments/:uri - Update an existing review segment
    router.put('/:uri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const segmentUri = decodeURIComponent(req.params.uri);
            const { title, text, percentage, mediaItemId, mediaType, listItem } = req.body;
            // Extract DID from URI to verify ownership
            const didMatch = segmentUri.match(/^at:\/\/([^\/]+)/);
            if (!didMatch) {
                return res.status(400).json({ error: 'Invalid segment URI' });
            }
            const segmentOwnerDid = didMatch[1];
            // Check if the authenticated user owns this segment
            if (agent.did !== segmentOwnerDid) {
                return res.status(403).json({
                    error: 'You can only update your own review segments',
                });
            }
            // Get the existing record
            const segmentsResponse = await agent.api.com.atproto.repo.listRecords({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
            });
            const existingSegment = segmentsResponse.data.records.find((record) => record.uri === segmentUri);
            if (!existingSegment) {
                return res.status(404).json({ error: 'Review segment not found' });
            }
            const currentData = existingSegment.value;
            // Validate required fields if provided
            if (percentage !== undefined && percentage !== null) {
                if (percentage < 0 || percentage > 100) {
                    return res.status(400).json({
                        error: 'Percentage must be between 0 and 100',
                    });
                }
            }
            // Extract rkey from URI
            const rkeyMatch = segmentUri.match(/\/([^\/]+)$/);
            if (!rkeyMatch) {
                return res.status(400).json({ error: 'Invalid segment URI' });
            }
            const rkey = rkeyMatch[1];
            // Update the record, keeping existing data but updating provided fields
            const updatedRecord = {
                ...(text !== undefined
                    ? text && text.trim()
                        ? { text: text.trim() }
                        : {}
                    : currentData.text
                        ? { text: currentData.text }
                        : {}),
                percentage: percentage !== undefined ? percentage : currentData.percentage,
                createdAt: currentData.createdAt,
                ...(title !== undefined
                    ? title && title.trim()
                        ? { title: title.trim() }
                        : {}
                    : currentData.title
                        ? { title: currentData.title }
                        : {}),
                ...(mediaItemId !== undefined
                    ? mediaItemId
                        ? { mediaItemId }
                        : {}
                    : currentData.mediaItemId
                        ? { mediaItemId: currentData.mediaItemId }
                        : {}),
                ...(mediaType !== undefined
                    ? mediaType
                        ? { mediaType }
                        : {}
                    : currentData.mediaType
                        ? { mediaType: currentData.mediaType }
                        : {}),
                ...(listItem !== undefined
                    ? listItem
                        ? { listItem }
                        : {}
                    : currentData.listItem
                        ? { listItem: currentData.listItem }
                        : {}),
            };
            const response = await agent.api.com.atproto.repo.putRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
                rkey: rkey,
                record: updatedRecord,
            });
            res.json({
                success: true,
                uri: response.data.uri,
                cid: response.data.cid,
                reviewSegment: {
                    uri: response.data.uri,
                    cid: response.data.cid,
                    value: updatedRecord,
                },
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to update review segment');
            res.status(500).json({ error: 'Failed to update review segment' });
        }
    }));
    // DELETE /reviewsegments/:uri - Delete a review segment
    router.delete('/:uri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const segmentUri = decodeURIComponent(req.params.uri);
            // Extract DID from URI to verify ownership
            const didMatch = segmentUri.match(/^at:\/\/([^\/]+)/);
            if (!didMatch) {
                return res.status(400).json({ error: 'Invalid segment URI' });
            }
            const segmentOwnerDid = didMatch[1];
            // Check if the authenticated user owns this segment
            if (agent.did !== segmentOwnerDid) {
                return res.status(403).json({
                    error: 'You can only delete your own review segments',
                });
            }
            // Extract rkey from URI
            const rkeyMatch = segmentUri.match(/\/([^\/]+)$/);
            if (!rkeyMatch) {
                return res.status(400).json({ error: 'Invalid segment URI' });
            }
            const rkey = rkeyMatch[1];
            // Delete the record
            await agent.api.com.atproto.repo.deleteRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
                rkey: rkey,
            });
            res.json({ success: true });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to delete review segment');
            res.status(500).json({ error: 'Failed to delete review segment' });
        }
    }));
    // GET /reviewsegments/media/:mediaItemId - Get all review segments for a media item
    router.get('/media/:mediaItemId', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const mediaItemId = parseInt(req.params.mediaItemId);
            if (isNaN(mediaItemId)) {
                return res.status(400).json({ error: 'Invalid media item ID' });
            }
            // Get all review segments from the user's repo
            const response = await agent.api.com.atproto.repo.listRecords({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
            });
            // Filter segments for this media item
            const segments = response.data.records.filter((record) => {
                return record.value.mediaItemId === mediaItemId;
            });
            // Sort by percentage (chronological order of consumption)
            segments.sort((a, b) => {
                return a.value.percentage - b.value.percentage;
            });
            res.json({ segments });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to get review segments');
            res.status(500).json({ error: 'Failed to get review segments' });
        }
    }));
    // GET /reviewsegments/list/:listItemUri - Get all review segments for a list item
    router.get('/list/:listItemUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const listItemUri = decodeURIComponent(req.params.listItemUri);
            // Get all review segments from the user's repo
            const response = await agent.api.com.atproto.repo.listRecords({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.reviewsegment',
            });
            // Filter segments for this list item
            const segments = response.data.records.filter((record) => {
                return record.value.listItem === listItemUri;
            });
            // Sort by percentage (chronological order of consumption)
            segments.sort((a, b) => {
                return a.value.percentage - b.value.percentage;
            });
            res.json({ segments });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to get review segments');
            res.status(500).json({ error: 'Failed to get review segments' });
        }
    }));
    // GET /reviewsegments/user/:did - Get all review segments for a user (for viewing others' segments)
    router.get('/user/:did', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const userDid = req.params.did;
            const mediaItemId = req.query.mediaItemId
                ? parseInt(req.query.mediaItemId)
                : undefined;
            // Get all review segments from the specified user's repo
            const response = await agent.api.com.atproto.repo.listRecords({
                repo: userDid,
                collection: 'app.collectivesocial.feed.reviewsegment',
            });
            let segments = response.data.records;
            // Filter by media item if specified
            if (mediaItemId && !isNaN(mediaItemId)) {
                segments = segments.filter((record) => {
                    return record.value.mediaItemId === mediaItemId;
                });
            }
            // Sort by percentage (chronological order of consumption)
            segments.sort((a, b) => {
                return a.value.percentage - b.value.percentage;
            });
            res.json({ segments });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to get review segments');
            res.status(500).json({ error: 'Failed to get review segments' });
        }
    }));
    return router;
};
exports.createRouter = createRouter;
