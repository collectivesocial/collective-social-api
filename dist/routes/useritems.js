"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("../lib/http");
const agent_1 = require("../auth/agent");
const kysely_1 = require("kysely");
// Helper function to get the rating column name for a given rating value
const getRatingColumnName = (rating) => {
    const ratingStr = rating.toString().replace('.', '_');
    return `rating${ratingStr}`;
};
const createRouter = (ctx) => {
    const router = express_1.default.Router();
    // GET /useritems - Get all useritems for the authenticated user
    router.get('/', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        try {
            const allUseritems = [];
            let cursor;
            while (true) {
                const response = await agent.api.com.atproto.repo.listRecords({
                    repo: agent.did,
                    collection: 'app.collectivesocial.feed.useritem',
                    limit: 100,
                    cursor,
                });
                for (const record of response.data.records) {
                    const val = record.value;
                    const item = {
                        uri: record.uri,
                        cid: record.cid,
                        title: val.title,
                        creator: val.creator || null,
                        mediaItemId: val.mediaItemId,
                        mediaType: val.mediaType || null,
                        status: val.status || 'want',
                        rating: val.rating ?? null,
                        notes: val.notes || null,
                        completedAt: val.completedAt || null,
                        review: val.review || null,
                        recommendations: val.recommendations || [],
                        createdAt: val.createdAt,
                        updatedAt: val.updatedAt || null,
                    };
                    // Enrich with media_items data
                    if (val.mediaItemId) {
                        const mediaItem = await ctx.db
                            .selectFrom('media_items')
                            .selectAll()
                            .where('id', '=', val.mediaItemId)
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
                                url: mediaItem.url,
                            };
                        }
                    }
                    allUseritems.push(item);
                }
                cursor = response.data.cursor;
                if (!cursor || response.data.records.length === 0)
                    break;
            }
            res.json({ useritems: allUseritems });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch useritems');
            res.status(500).json({ error: 'Failed to fetch useritems' });
        }
    }));
    // GET /useritems/by-media/:mediaItemId - Get a specific useritem by mediaItemId
    router.get('/by-media/:mediaItemId', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const mediaItemId = parseInt(req.params.mediaItemId, 10);
        if (isNaN(mediaItemId)) {
            return res.status(400).json({ error: 'Invalid mediaItemId' });
        }
        try {
            let cursor;
            while (true) {
                const response = await agent.api.com.atproto.repo.listRecords({
                    repo: agent.did,
                    collection: 'app.collectivesocial.feed.useritem',
                    limit: 100,
                    cursor,
                });
                for (const record of response.data.records) {
                    const val = record.value;
                    if (val.mediaItemId === mediaItemId) {
                        const item = {
                            uri: record.uri,
                            cid: record.cid,
                            title: val.title,
                            creator: val.creator || null,
                            mediaItemId: val.mediaItemId,
                            mediaType: val.mediaType || null,
                            status: val.status || 'want',
                            rating: val.rating ?? null,
                            notes: val.notes || null,
                            completedAt: val.completedAt || null,
                            review: val.review || null,
                            recommendations: val.recommendations || [],
                            createdAt: val.createdAt,
                            updatedAt: val.updatedAt || null,
                        };
                        // Enrich with media_items data
                        const mediaItem = await ctx.db
                            .selectFrom('media_items')
                            .selectAll()
                            .where('id', '=', mediaItemId)
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
                                url: mediaItem.url,
                            };
                        }
                        return res.json({ useritem: item });
                    }
                }
                cursor = response.data.cursor;
                if (!cursor || response.data.records.length === 0)
                    break;
            }
            return res.json({ useritem: null });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch useritem');
            res.status(500).json({ error: 'Failed to fetch useritem' });
        }
    }));
    // POST /useritems - Create a new useritem (user's relationship with a media item)
    router.post('/', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { title, creator, mediaItemId, mediaType, status, rating, notes, recommendedBy, } = req.body;
        if (!title || !mediaItemId) {
            return res
                .status(400)
                .json({ error: 'title and mediaItemId are required' });
        }
        try {
            // Check if useritem already exists for this mediaItemId
            let cursor;
            while (true) {
                const response = await agent.api.com.atproto.repo.listRecords({
                    repo: agent.did,
                    collection: 'app.collectivesocial.feed.useritem',
                    limit: 100,
                    cursor,
                });
                for (const record of response.data.records) {
                    const val = record.value;
                    if (val.mediaItemId === mediaItemId) {
                        // Already exists, return the existing record
                        return res.json({
                            uri: record.uri,
                            cid: record.cid,
                            existing: true,
                            useritem: {
                                uri: record.uri,
                                cid: record.cid,
                                title: val.title,
                                creator: val.creator || null,
                                mediaItemId: val.mediaItemId,
                                mediaType: val.mediaType || null,
                                status: val.status || 'want',
                                rating: val.rating ?? null,
                                notes: val.notes || null,
                                completedAt: val.completedAt || null,
                                review: val.review || null,
                                recommendations: val.recommendations || [],
                                createdAt: val.createdAt,
                                updatedAt: val.updatedAt || null,
                            },
                        });
                    }
                }
                cursor = response.data.cursor;
                if (!cursor || response.data.records.length === 0)
                    break;
            }
            // Build recommendations
            const recommendations = [];
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
                        }
                        catch (err) {
                            ctx.logger.warn({ handle: recommender }, 'Failed to resolve handle, using as-is');
                        }
                    }
                    recommendations.push({ did, suggestedAt });
                }
            }
            const now = new Date().toISOString();
            const record = {
                $type: 'app.collectivesocial.feed.useritem',
                title,
                creator: creator || undefined,
                mediaItemId,
                mediaType: mediaType || undefined,
                status: status || 'want',
                rating: rating !== undefined && rating !== null ? Number(rating) : undefined,
                notes: notes || undefined,
                recommendations: recommendations.length > 0 ? recommendations : undefined,
                createdAt: now,
                updatedAt: now,
            };
            const createResponse = await agent.api.com.atproto.repo.createRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.useritem',
                record: record,
            });
            // Update totalSaves on media_items
            await ctx.db
                .updateTable('media_items')
                .set({
                totalSaves: (0, kysely_1.sql) `"totalSaves" + 1`,
                updatedAt: new Date(),
            })
                .where('id', '=', mediaItemId)
                .execute();
            // Create feed event
            try {
                const profile = await agent.getProfile({ actor: agent.did });
                const statusText = status === 'completed'
                    ? 'finished'
                    : status === 'in-progress'
                        ? 'started'
                        : 'wants';
                const eventName = `${profile.data.handle} ${statusText} "${title}"`;
                await ctx.db
                    .insertInto('feed_events')
                    .values({
                    eventName,
                    mediaLink: `/items/${mediaItemId}`,
                    userDid: agent.did,
                    createdAt: new Date(),
                })
                    .execute();
            }
            catch (err) {
                ctx.logger.error({ err }, 'Failed to create feed event');
            }
            res.json({
                uri: createResponse.data.uri,
                cid: createResponse.data.cid,
                existing: false,
                useritem: {
                    uri: createResponse.data.uri,
                    cid: createResponse.data.cid,
                    ...record,
                },
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to create useritem');
            res.status(500).json({ error: 'Failed to create useritem' });
        }
    }));
    // PUT /useritems/:useritemUri - Update a useritem
    router.put('/:useritemUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { status, rating, notes, review, completedAt } = req.body;
        const useritemUri = decodeURIComponent(req.params.useritemUri);
        // Extract rkey from URI
        const rkeyMatch = useritemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
            return res.status(400).json({ error: 'Invalid useritem URI' });
        }
        const rkey = rkeyMatch[1];
        try {
            // Get the existing record
            const existing = await agent.api.com.atproto.repo.getRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.useritem',
                rkey,
            });
            const existingData = existing.data.value;
            const oldStatus = existingData.status;
            const oldRating = existingData.rating;
            const now = new Date().toISOString();
            // Determine completedAt
            let newCompletedAt = existingData.completedAt;
            if (status === 'completed' && completedAt) {
                newCompletedAt = completedAt;
            }
            else if (status === 'completed' && !existingData.completedAt) {
                newCompletedAt = now;
            }
            else if (status && status !== 'completed') {
                // Don't clear completedAt — preserve history of last completion
            }
            const updatedRecord = {
                ...existingData,
                status: status || existingData.status,
                rating: rating !== undefined ? (rating === null ? undefined : Number(rating)) : existingData.rating,
                notes: notes !== undefined ? (notes || undefined) : existingData.notes,
                review: review !== undefined ? review : existingData.review,
                completedAt: newCompletedAt,
                updatedAt: now,
            };
            await agent.api.com.atproto.repo.putRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.useritem',
                rkey,
                record: updatedRecord,
            });
            // Handle review text + rating → Postgres reviews table
            const mediaItemId = existingData.mediaItemId;
            const mediaType = existingData.mediaType;
            const reviewText = req.body.reviewText;
            if (reviewText !== undefined &&
                rating !== undefined &&
                mediaItemId &&
                mediaType) {
                const existingReview = await ctx.db
                    .selectFrom('reviews')
                    .select(['id', 'rating', 'review'])
                    .where('authorDid', '=', agent.did)
                    .where('mediaItemId', '=', mediaItemId)
                    .where('mediaType', '=', mediaType)
                    .executeTakeFirst();
                const isNewReview = !existingReview;
                if (reviewText && reviewText.trim()) {
                    const reviewNow = new Date();
                    // Create/update AT Protocol review record
                    let reviewUri = updatedRecord.review || null;
                    try {
                        const reviewRecord = {
                            $type: 'app.collectivesocial.feed.review',
                            text: reviewText.trim(),
                            rating: Number(rating),
                            notes: notes || undefined,
                            mediaItemId,
                            mediaType: mediaType,
                            createdAt: reviewNow.toISOString(),
                            updatedAt: reviewNow.toISOString(),
                        };
                        if (reviewUri) {
                            // Update existing review
                            const reviewRkeyMatch = reviewUri.match(/\/([^\/]+)$/);
                            if (reviewRkeyMatch) {
                                await agent.api.com.atproto.repo.putRecord({
                                    repo: agent.did,
                                    collection: 'app.collectivesocial.feed.review',
                                    rkey: reviewRkeyMatch[1],
                                    record: reviewRecord,
                                });
                            }
                        }
                        else {
                            // Create new review
                            const reviewResponse = await agent.api.com.atproto.repo.createRecord({
                                repo: agent.did,
                                collection: 'app.collectivesocial.feed.review',
                                record: reviewRecord,
                            });
                            reviewUri = reviewResponse.data.uri;
                            // Update the useritem with the review URI
                            await agent.api.com.atproto.repo.putRecord({
                                repo: agent.did,
                                collection: 'app.collectivesocial.feed.useritem',
                                rkey,
                                record: {
                                    ...updatedRecord,
                                    review: reviewUri,
                                },
                            });
                        }
                    }
                    catch (err) {
                        ctx.logger.error({ err }, 'Failed to create/update AT Protocol review record');
                    }
                    // Upsert into Postgres reviews table
                    await ctx.db
                        .insertInto('reviews')
                        .values({
                        authorDid: agent.did,
                        mediaItemId,
                        mediaType,
                        rating: Number(rating),
                        review: reviewText.trim(),
                        listItemUri: useritemUri, // use useritem URI as reference
                        reviewUri,
                        createdAt: reviewNow,
                        updatedAt: reviewNow,
                    })
                        .onConflict((oc) => oc
                        .columns(['authorDid', 'mediaItemId', 'mediaType'])
                        .doUpdateSet({
                        rating: Number(rating),
                        review: reviewText.trim(),
                        reviewUri,
                        updatedAt: reviewNow,
                    }))
                        .execute();
                    // Update aggregated stats on media_items
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
                            const newTotalRatings = currentItem.totalRatings + 1;
                            const newTotalReviews = currentItem.totalReviews + 1;
                            const newAverage = (currentAvg * currentItem.totalRatings + Number(rating)) /
                                newTotalRatings;
                            const ratingColumn = getRatingColumnName(Number(rating));
                            await ctx.db
                                .updateTable('media_items')
                                .set({
                                totalRatings: newTotalRatings,
                                totalReviews: newTotalReviews,
                                averageRating: parseFloat(newAverage.toFixed(2)),
                                [ratingColumn]: (0, kysely_1.sql) `"${kysely_1.sql.raw(ratingColumn)}" + 1`,
                                updatedAt: new Date(),
                            })
                                .where('id', '=', mediaItemId)
                                .execute();
                        }
                        else if (oldRating !== Number(rating)) {
                            const newAverage = (currentAvg * currentItem.totalRatings -
                                Number(oldRating || 0) +
                                Number(rating)) /
                                currentItem.totalRatings;
                            const updates = {
                                averageRating: parseFloat(newAverage.toFixed(2)),
                                updatedAt: new Date(),
                            };
                            if (oldRating) {
                                const oldRatingColumn = getRatingColumnName(Number(oldRating));
                                updates[oldRatingColumn] = (0, kysely_1.sql) `GREATEST("${kysely_1.sql.raw(oldRatingColumn)}" - 1, 0)`;
                            }
                            const newRatingColumn = getRatingColumnName(Number(rating));
                            updates[newRatingColumn] = (0, kysely_1.sql) `"${kysely_1.sql.raw(newRatingColumn)}" + 1`;
                            await ctx.db
                                .updateTable('media_items')
                                .set(updates)
                                .where('id', '=', mediaItemId)
                                .execute();
                        }
                    }
                    // Create feed event for new review
                    if (isNewReview) {
                        try {
                            const profile = await agent.getProfile({
                                actor: agent.did,
                            });
                            const eventName = `${profile.data.handle} reviewed "${existingData.title}"`;
                            await ctx.db
                                .insertInto('feed_events')
                                .values({
                                eventName,
                                mediaLink: `/items/${mediaItemId}`,
                                userDid: agent.did,
                                createdAt: new Date(),
                            })
                                .execute();
                        }
                        catch (err) {
                            ctx.logger.error({ err }, 'Failed to create review feed event');
                        }
                    }
                }
            }
            res.json({
                success: true,
                useritem: {
                    uri: useritemUri,
                    ...updatedRecord,
                },
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to update useritem');
            res.status(500).json({ error: 'Failed to update useritem' });
        }
    }));
    // DELETE /useritems/:useritemUri - Delete a useritem
    router.delete('/:useritemUri', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const useritemUri = decodeURIComponent(req.params.useritemUri);
        const rkeyMatch = useritemUri.match(/\/([^\/]+)$/);
        if (!rkeyMatch) {
            return res.status(400).json({ error: 'Invalid useritem URI' });
        }
        const rkey = rkeyMatch[1];
        try {
            // Get the record first to clean up related data
            const existing = await agent.api.com.atproto.repo.getRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.useritem',
                rkey,
            });
            const existingData = existing.data.value;
            // Delete the atproto record
            await agent.api.com.atproto.repo.deleteRecord({
                repo: agent.did,
                collection: 'app.collectivesocial.feed.useritem',
                rkey,
            });
            // Delete associated review from Postgres
            if (existingData.mediaItemId) {
                await ctx.db
                    .deleteFrom('reviews')
                    .where('authorDid', '=', agent.did)
                    .where('mediaItemId', '=', existingData.mediaItemId)
                    .execute();
                // Decrement totalSaves
                await ctx.db
                    .updateTable('media_items')
                    .set({
                    totalSaves: (0, kysely_1.sql) `GREATEST("totalSaves" - 1, 0)`,
                    updatedAt: new Date(),
                })
                    .where('id', '=', existingData.mediaItemId)
                    .execute();
            }
            res.json({ success: true });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to delete useritem');
            res.status(500).json({ error: 'Failed to delete useritem' });
        }
    }));
    // GET /useritems/user/:did - Get another user's useritems (public view)
    router.get('/user/:did', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
        if (!agent) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const userDid = req.params.did;
        try {
            const allUseritems = [];
            let cursor;
            while (true) {
                const response = await agent.api.com.atproto.repo.listRecords({
                    repo: userDid,
                    collection: 'app.collectivesocial.feed.useritem',
                    limit: 100,
                    cursor,
                });
                for (const record of response.data.records) {
                    const val = record.value;
                    allUseritems.push({
                        uri: record.uri,
                        cid: record.cid,
                        title: val.title,
                        creator: val.creator || null,
                        mediaItemId: val.mediaItemId,
                        mediaType: val.mediaType || null,
                        status: val.status || 'want',
                        rating: val.rating ?? null,
                        // notes are private — don't expose for other users
                        completedAt: val.completedAt || null,
                        review: val.review || null,
                        recommendations: val.recommendations || [],
                        createdAt: val.createdAt,
                    });
                }
                cursor = response.data.cursor;
                if (!cursor || response.data.records.length === 0)
                    break;
            }
            res.json({ useritems: allUseritems });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch user useritems');
            res.status(500).json({ error: 'Failed to fetch useritems' });
        }
    }));
    return router;
};
exports.createRouter = createRouter;
