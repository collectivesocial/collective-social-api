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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireGroupMember = requireGroupMember;
exports.requireGroupAdmin = requireGroupAdmin;
const agent_1 = require("../auth/agent");
const opensocial = __importStar(require("../services/opensocial"));
/**
 * Middleware factory: verifies the current session user is a member
 * of the community identified by :communityDid in the route params.
 *
 * Attaches groupAuth to the request.
 */
function requireGroupMember(ctx) {
    return async (req, res, next) => {
        try {
            const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
            if (!agent?.did) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            const communityDid = req.params.communityDid;
            if (!communityDid) {
                return res.status(400).json({ error: 'communityDid is required' });
            }
            const membership = await opensocial.checkMembership(communityDid, agent.did);
            if (!membership.isMember) {
                return res.status(403).json({ error: 'You are not a member of this community' });
            }
            req.groupAuth = {
                userDid: agent.did,
                communityDid,
                isMember: membership.isMember,
                isAdmin: membership.isAdmin,
            };
            next();
        }
        catch (error) {
            console.error('Group membership check failed:', error.message);
            return res.status(error.status || 500).json({ error: error.message || 'Membership check failed' });
        }
    };
}
/**
 * Middleware factory: verifies the current session user is an admin
 * of the community identified by :communityDid in the route params.
 *
 * Must be used after requireGroupMember (or performs its own check).
 */
function requireGroupAdmin(ctx) {
    return async (req, res, next) => {
        try {
            // If groupAuth is already set by requireGroupMember, just check isAdmin
            if (req.groupAuth) {
                if (!req.groupAuth.isAdmin) {
                    return res.status(403).json({ error: 'Only community admins can perform this action' });
                }
                return next();
            }
            // Otherwise do the full check
            const agent = await (0, agent_1.getSessionAgent)(req, res, ctx);
            if (!agent?.did) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            const communityDid = req.params.communityDid;
            if (!communityDid) {
                return res.status(400).json({ error: 'communityDid is required' });
            }
            const membership = await opensocial.checkMembership(communityDid, agent.did);
            if (!membership.isMember) {
                return res.status(403).json({ error: 'You are not a member of this community' });
            }
            if (!membership.isAdmin) {
                return res.status(403).json({ error: 'Only community admins can perform this action' });
            }
            req.groupAuth = {
                userDid: agent.did,
                communityDid,
                isMember: true,
                isAdmin: true,
            };
            next();
        }
        catch (error) {
            console.error('Group admin check failed:', error.message);
            return res.status(error.status || 500).json({ error: error.message || 'Admin check failed' });
        }
    };
}
