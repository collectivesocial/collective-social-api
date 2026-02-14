"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionAgent = getSessionAgent;
const iron_session_1 = require("iron-session");
const api_1 = require("@atproto/api");
const session_1 = require("./session");
/**
 * Get the authenticated ATProto agent for the current session.
 * Returns null if the user is not logged in or session is invalid.
 */
async function getSessionAgent(req, res, ctx) {
    res.setHeader('Vary', 'Cookie');
    const session = await (0, iron_session_1.getIronSession)(req, res, session_1.SESSION_OPTIONS);
    if (!session.did)
        return null;
    res.setHeader('cache-control', 'private, no-store');
    try {
        const oauthSession = await ctx.oauthClient.restore(session.did);
        return oauthSession ? new api_1.Agent(oauthSession) : null;
    }
    catch (err) {
        ctx.logger.warn({ err }, 'oauth session restore failed');
        await session.destroy();
        return null;
    }
}
