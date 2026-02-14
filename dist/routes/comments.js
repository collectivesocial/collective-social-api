"use strict";
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
const agent_1 = require("../auth/agent");
const createRouter = (ctx) => {
    const router = express_1.default.Router();
    // POST /comments - Create a new comment (on a review or another comment)
    router.post('/', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { text, reviewUri, parentCommentUri } = req.body;
        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'Comment text is required' });
        }
        if (text.length > 3000) {
            return res
                .status(400)
                .json({ error: 'Comment text cannot exceed 3000 characters' });
        }
        // Must have either reviewUri or parentCommentUri, but not both
        if ((!reviewUri && !parentCommentUri) ||
            (reviewUri && parentCommentUri)) {
            return res.status(400).json({
                error: 'Comment must reference either a review or a parent comment, but not both',
            });
        }
        try {
            const now = new Date().toISOString();
            const record = {
                $type: 'app.collectivesocial.feed.comment',
                text: text.trim(),
                reviewRef: reviewUri
                    ? {
                        uri: reviewUri,
                        cid: '', // We'll need to fetch the CID
                    }
                    : undefined,
                parentCommentRef: parentCommentUri
                    ? {
                        uri: parentCommentUri,
                        cid: '', // We'll need to fetch the CID
                    }
                    : undefined,
                createdAt: now,
                updatedAt: now,
            };
            // If we have a reviewUri, try to fetch the review to get its CID
            if (reviewUri && record.reviewRef) {
                try {
                    const uriParts = reviewUri.split('/');
                    const rkey = uriParts[uriParts.length - 1];
                    const did = uriParts[2];
                    const reviewRecord = await agent.api.com.atproto.repo.getRecord({
                        repo: did,
                        collection: 'app.collectivesocial.feed.review',
                        rkey: rkey,
                    });
                    record.reviewRef.cid = reviewRecord.data.cid;
                }
                catch (err) {
                    // If review doesn't exist in AT Protocol, use a placeholder CID
                    // The comment will still be stored in our database
                    ctx.logger.warn({ err, reviewUri }, 'Could not fetch review CID, using placeholder');
                    record.reviewRef.cid = 'bafyreib2rxk3rh6kzwq';
                }
            }
            // If we have a parentCommentUri, try to fetch the parent comment to get its CID
            if (parentCommentUri && record.parentCommentRef) {
                try {
                    const uriParts = parentCommentUri.split('/');
                    const rkey = uriParts[uriParts.length - 1];
                    const did = uriParts[2];
                    const parentRecord = await agent.api.com.atproto.repo.getRecord({
                        repo: did,
                        collection: 'app.collectivesocial.feed.comment',
                        rkey: rkey,
                    });
                    record.parentCommentRef.cid = parentRecord.data.cid;
                }
                catch (err) {
                    // If parent comment doesn't exist in AT Protocol, use a placeholder CID
                    ctx.logger.warn({ err, parentCommentUri }, 'Could not fetch parent comment CID, using placeholder');
                    record.parentCommentRef.cid = 'bafyreib2rxk3rh6kzwq';
                }
            }
            // Create the comment record
            const response = await agent.api.com.atproto.repo.createRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.comment',
                record: record,
            });
            // Store in database
            await ctx.db
                .insertInto('comments')
                .values({
                uri: response.data.uri,
                cid: response.data.cid,
                userDid: agent.did,
                text: text.trim(),
                reviewUri: reviewUri || null,
                parentCommentUri: parentCommentUri || null,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
                .execute();
            res.json({
                uri: response.data.uri,
                cid: response.data.cid,
                userDid: agent.did,
                text: text.trim(),
                reviewUri: reviewUri || null,
                parentCommentUri: parentCommentUri || null,
                createdAt: now,
                updatedAt: now,
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to create comment');
            res.status(500).json({ error: 'Failed to create comment' });
        }
    }));
    // GET /comments/review/* - Get all comments for a review
    router.get('/review/:encodedUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'public, max-age=30');
        const reviewUri = decodeURIComponent(req.params.encodedUri);
        try {
            const comments = await ctx.db
                .selectFrom('comments')
                .selectAll()
                .where('reviewUri', '=', reviewUri)
                .orderBy('createdAt', 'asc')
                .execute();
            // Fetch user profile from AT Protocol for each comment
            const { Agent } = await Promise.resolve().then(() => __importStar(require('@atproto/api')));
            const commentsWithUsers = await Promise.all(comments.map(async (comment) => {
                let user = null;
                try {
                    // Create a public agent (no auth needed for profile lookups)
                    const agent = new Agent({
                        service: 'https://public.api.bsky.app',
                    });
                    const profile = await agent.getProfile({
                        actor: comment.userDid,
                    });
                    user = {
                        did: profile.data.did,
                        handle: profile.data.handle,
                        displayName: profile.data.displayName || null,
                        avatar: profile.data.avatar || null,
                    };
                }
                catch (err) {
                    ctx.logger.warn({ err, did: comment.userDid }, 'Failed to fetch user profile from AT Protocol');
                }
                return {
                    ...comment,
                    createdAt: comment.createdAt.toISOString(),
                    updatedAt: comment.updatedAt.toISOString(),
                    user,
                };
            }));
            res.json({ comments: commentsWithUsers });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch comments');
            res.status(500).json({ error: 'Failed to fetch comments' });
        }
    }));
    // GET /comments/:encodedUri/replies - Get replies to a comment
    router.get('/:encodedUri/replies', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'public, max-age=30');
        const commentUri = decodeURIComponent(req.params.encodedUri);
        try {
            const replies = await ctx.db
                .selectFrom('comments')
                .selectAll()
                .where('parentCommentUri', '=', commentUri)
                .orderBy('createdAt', 'asc')
                .execute();
            // Fetch user profile from AT Protocol for each reply
            const { Agent } = await Promise.resolve().then(() => __importStar(require('@atproto/api')));
            const repliesWithUsers = await Promise.all(replies.map(async (reply) => {
                let user = null;
                try {
                    // Create a public agent (no auth needed for profile lookups)
                    const agent = new Agent({
                        service: 'https://public.api.bsky.app',
                    });
                    const profile = await agent.getProfile({ actor: reply.userDid });
                    user = {
                        did: profile.data.did,
                        handle: profile.data.handle,
                        displayName: profile.data.displayName || null,
                        avatar: profile.data.avatar || null,
                    };
                }
                catch (err) {
                    ctx.logger.warn({ err, did: reply.userDid }, 'Failed to fetch user profile from AT Protocol');
                }
                return {
                    ...reply,
                    createdAt: reply.createdAt.toISOString(),
                    updatedAt: reply.updatedAt.toISOString(),
                    user,
                };
            }));
            res.json({ replies: repliesWithUsers });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch replies');
            res.status(500).json({ error: 'Failed to fetch replies' });
        }
    }));
    // PUT /comments/:encodedUri - Update a comment
    router.put('/:encodedUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const commentUri = decodeURIComponent(req.params.encodedUri);
        const { text } = req.body;
        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'Comment text is required' });
        }
        if (text.length > 3000) {
            return res
                .status(400)
                .json({ error: 'Comment text cannot exceed 3000 characters' });
        }
        try {
            // Check if the comment exists and belongs to the user
            const existingComment = await ctx.db
                .selectFrom('comments')
                .selectAll()
                .where('uri', '=', commentUri)
                .executeTakeFirst();
            if (!existingComment) {
                return res.status(404).json({ error: 'Comment not found' });
            }
            if (existingComment.userDid !== agent.did) {
                return res
                    .status(403)
                    .json({ error: 'Not authorized to edit this comment' });
            }
            // Parse the URI to get repo and rkey
            const uriParts = commentUri.split('/');
            const rkey = uriParts[uriParts.length - 1];
            // Fetch the current record
            const currentRecord = await agent.api.com.atproto.repo.getRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.comment',
                rkey: rkey,
            });
            const now = new Date().toISOString();
            const updatedRecord = {
                ...currentRecord.data.value,
                text: text.trim(),
                updatedAt: now,
            };
            // Update the record in ATProto
            const response = await agent.api.com.atproto.repo.putRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.comment',
                rkey: rkey,
                record: updatedRecord,
            });
            // Update in database
            await ctx.db
                .updateTable('comments')
                .set({
                text: text.trim(),
                cid: response.data.cid,
                updatedAt: new Date(),
            })
                .where('uri', '=', commentUri)
                .execute();
            res.json({
                uri: commentUri,
                cid: response.data.cid,
                text: text.trim(),
                updatedAt: now,
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to update comment');
            res.status(500).json({ error: 'Failed to update comment' });
        }
    }));
    // DELETE /comments/:encodedUri - Delete a comment
    router.delete('/:encodedUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const commentUri = decodeURIComponent(req.params.encodedUri);
        try {
            // Check if the comment exists and belongs to the user
            const existingComment = await ctx.db
                .selectFrom('comments')
                .selectAll()
                .where('uri', '=', commentUri)
                .executeTakeFirst();
            if (!existingComment) {
                return res.status(404).json({ error: 'Comment not found' });
            }
            if (existingComment.userDid !== agent.did) {
                return res
                    .status(403)
                    .json({ error: 'Not authorized to delete this comment' });
            }
            // Parse the URI to get rkey
            const uriParts = commentUri.split('/');
            const rkey = uriParts[uriParts.length - 1];
            // Delete from ATProto
            await agent.api.com.atproto.repo.deleteRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.comment',
                rkey: rkey,
            });
            // Delete from database
            await ctx.db
                .deleteFrom('comments')
                .where('uri', '=', commentUri)
                .execute();
            res.json({ success: true });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to delete comment');
            res.status(500).json({ error: 'Failed to delete comment' });
        }
    }));
    return router;
};
exports.createRouter = createRouter;
