"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("../lib/http");
const createRouter = (ctx) => {
    const router = express_1.default.Router();
    // GET /feed/events - Get recent feed events
    router.get('/events', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'public, max-age=30');
        try {
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const events = await ctx.db
                .selectFrom('feed_events')
                .selectAll()
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .offset(offset)
                .execute();
            res.json({
                events,
                limit,
                offset,
            });
        }
        catch (err) {
            ctx.logger.error({ err }, 'Failed to fetch feed events');
            res.status(500).json({ error: 'Failed to fetch feed events' });
        }
    }));
    return router;
};
exports.createRouter = createRouter;
