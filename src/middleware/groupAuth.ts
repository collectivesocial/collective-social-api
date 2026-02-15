import { Request, Response, NextFunction } from 'express';
import type { AppContext } from '../context';
import { getSessionAgent } from '../auth/agent';
import * as opensocial from '../services/opensocial';

/**
 * Extended request type that carries group auth info after middleware runs.
 */
export interface GroupAuthRequest extends Request {
  groupAuth?: {
    userDid: string;
    communityDid: string;
    isMember: boolean;
    isAdmin: boolean;
  };
}

/**
 * Middleware factory: verifies the current session user is a member
 * of the community identified by :communityDid in the route params.
 *
 * Attaches groupAuth to the request.
 */
export function requireGroupMember(ctx: AppContext) {
  return async (req: GroupAuthRequest, res: Response, next: NextFunction) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const communityDid = req.params.communityDid;
      if (!communityDid) {
        return res.status(400).json({ error: 'communityDid is required' });
      }

      const membership = await opensocial.checkMembership(
        communityDid,
        agent.did
      );

      if (!membership.isMember) {
        return res
          .status(403)
          .json({ error: 'You are not a member of this community' });
      }

      req.groupAuth = {
        userDid: agent.did,
        communityDid,
        isMember: membership.isMember,
        isAdmin: membership.isAdmin,
      };

      next();
    } catch (error: any) {
      console.error('Group membership check failed:', error.message);
      return res
        .status(error.status || 500)
        .json({ error: error.message || 'Membership check failed' });
    }
  };
}

/**
 * Middleware factory: verifies the current session user is an admin
 * of the community identified by :communityDid in the route params.
 *
 * Must be used after requireGroupMember (or performs its own check).
 */
export function requireGroupAdmin(ctx: AppContext) {
  return async (req: GroupAuthRequest, res: Response, next: NextFunction) => {
    try {
      // If groupAuth is already set by requireGroupMember, just check isAdmin
      if (req.groupAuth) {
        if (!req.groupAuth.isAdmin) {
          return res
            .status(403)
            .json({ error: 'Only community admins can perform this action' });
        }
        return next();
      }

      // Otherwise do the full check
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const communityDid = req.params.communityDid;
      if (!communityDid) {
        return res.status(400).json({ error: 'communityDid is required' });
      }

      const membership = await opensocial.checkMembership(
        communityDid,
        agent.did
      );

      if (!membership.isMember) {
        return res
          .status(403)
          .json({ error: 'You are not a member of this community' });
      }

      if (!membership.isAdmin) {
        return res
          .status(403)
          .json({ error: 'Only community admins can perform this action' });
      }

      req.groupAuth = {
        userDid: agent.did,
        communityDid,
        isMember: true,
        isAdmin: true,
      };

      next();
    } catch (error: any) {
      console.error('Group admin check failed:', error.message);
      return res
        .status(error.status || 500)
        .json({ error: error.message || 'Admin check failed' });
    }
  };
}
