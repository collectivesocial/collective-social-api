"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = void 0;
const path_1 = __importDefault(require("path"));
const api_1 = require("@atproto/api");
const oauth_client_node_1 = require("@atproto/oauth-client-node");
const express_1 = __importDefault(require("express"));
const iron_session_1 = require("iron-session");
const config_1 = require("../config");
const http_1 = require("../lib/http");
const stringUtil_1 = require("../lib/stringUtil");
const session_1 = require("../auth/session");
// Max age, in seconds, for static routes and assets
const MAX_AGE = config_1.config.nodeEnv === 'production' ? 60 : 300;
// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(req, res, ctx) {
    res.setHeader('Vary', 'Cookie');
    const session = await (0, iron_session_1.getIronSession)(req, res, session_1.SESSION_OPTIONS);
    if (!session.did)
        return null;
    // This page is dynamic and should not be cached publicly
    res.setHeader('cache-control', `max-age=${MAX_AGE}, private`);
    try {
        const oauthSession = await ctx.oauthClient.restore(session.did);
        return oauthSession ? new api_1.Agent(oauthSession) : null;
    }
    catch (err) {
        ctx.logger.warn({ err }, 'oauth restore failed');
        await session.destroy();
        return null;
    }
}
const createRouter = (ctx) => {
    const router = (0, express_1.default)();
    // Static assets
    router.use('/public', express_1.default.static(path_1.default.join(__dirname, 'pages', 'public'), {
        maxAge: MAX_AGE * 1000,
    }));
    // OAuth metadata
    router.get('/oauth-client-metadata.json', (0, http_1.handler)((req, res) => {
        res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);
        res.json(ctx.oauthClient.clientMetadata);
    }));
    // Public keys
    router.get('/.well-known/jwks.json', (0, http_1.handler)((req, res) => {
        res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);
        res.json(ctx.oauthClient.jwks);
    }));
    // OAuth callback to complete session creation
    router.get('/oauth/callback', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const params = new URLSearchParams(req.originalUrl.split('?')[1]);
        try {
            // Load the session cookie
            const session = await (0, iron_session_1.getIronSession)(req, res, {
                cookieName: 'sid',
                password: config_1.config.cookieSecret,
                cookieOptions: {
                    secure: config_1.config.nodeEnv === 'production',
                    sameSite: 'lax',
                    httpOnly: true,
                    path: '/',
                },
            });
            // If the user is already signed in, destroy the old credentials
            if (session.did) {
                try {
                    const oauthSession = await ctx.oauthClient.restore(session.did);
                    if (oauthSession)
                        oauthSession.signOut();
                }
                catch (err) {
                    ctx.logger.warn({ err }, 'oauth restore failed');
                }
            }
            // Complete the OAuth flow
            const oauth = await ctx.oauthClient.callback(params);
            // Update the session cookie
            session.did = oauth.session.did;
            await session.save();
        }
        catch (err) {
            ctx.logger.error({ err }, 'oauth callback failed');
        }
        // Redirect back to the React app
        const redirectUrl = config_1.config.nodeEnv === 'production'
            ? config_1.config.serviceUrl || 'http://127.0.0.1:5173'
            : 'http://127.0.0.1:5173';
        return res.redirect(redirectUrl);
    }));
    // Login handler
    router.post('/login', express_1.default.urlencoded(), (0, http_1.handler)(async (req, res) => {
        // Never store this route
        res.setHeader('cache-control', 'no-store');
        // Initiate the OAuth flow
        try {
            // Validate input: can be a handle, a DID or a service URL (PDS).
            const input = (0, stringUtil_1.ifString)(req.body.input);
            if (!input) {
                throw new Error('Invalid input');
            }
            // Initiate the OAuth flow
            const url = await ctx.oauthClient.authorize(input, {
                scope: 'atproto transition:generic',
            });
            res.redirect(url.toString());
        }
        catch (err) {
            ctx.logger.error({ err }, 'oauth authorize failed');
            const error = err instanceof Error ? err.message : 'unexpected error';
            return res.type('json').send({ error });
        }
    }));
    // Signup
    router.get('/signup', (0, http_1.handler)(async (req, res) => {
        res.setHeader('cache-control', `max-age=${MAX_AGE}, public`);
        try {
            const service = config_1.config.pdsUrl;
            const url = await ctx.oauthClient.authorize(service, {
                scope: 'atproto transition:generic',
            });
            res.redirect(url.toString());
        }
        catch (err) {
            ctx.logger.error({ err }, 'oauth authorize failed');
            res.type('json').send({
                error: err instanceof oauth_client_node_1.OAuthResolverError
                    ? err.message
                    : "couldn't initiate login",
            });
        }
    }));
    // Logout handler
    router.post('/logout', (0, http_1.handler)(async (req, res) => {
        // Never store this route
        res.setHeader('cache-control', 'no-store');
        const session = await (0, iron_session_1.getIronSession)(req, res, {
            cookieName: 'sid',
            password: config_1.config.cookieSecret,
            cookieOptions: {
                secure: config_1.config.nodeEnv === 'production',
                sameSite: 'lax',
                httpOnly: true,
                path: '/',
            },
        });
        // Revoke credentials on the server
        if (session.did) {
            try {
                const oauthSession = await ctx.oauthClient.restore(session.did);
                if (oauthSession)
                    await oauthSession.signOut();
            }
            catch (err) {
                ctx.logger.warn({ err }, 'Failed to revoke credentials');
            }
        }
        session.destroy();
        return res.json({ success: true });
    }));
    return router;
};
exports.createRouter = createRouter;
