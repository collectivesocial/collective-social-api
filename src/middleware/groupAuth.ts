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

      const communityDid = req.params.communityDid as string;
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
      ctx.logger.error({ err: error }, 'Group membership check failed');
      return res
        .status(error.status || 500)
        .json({ error: error.message || 'Membership check failed' });
    }
  };
}

/**
 * Middleware factory: resolves the current session user's membership state
 * for the community in :communityDid, but does NOT reject anonymous or
 * non-member callers. Attaches `groupAuth` to the request when possible:
 *
 * - Anonymous visitor → no `groupAuth` (or `userDid: ''`, `isMember: false`).
 * - Signed-in non-member → `groupAuth.isMember === false`.
 * - Member or admin → flags set accordingly.
 *
 * Use this on public-readable endpoints whose response shape changes based
 * on membership (e.g. hiding join links from non-members).
 */
export function optionalGroupMember(ctx: AppContext) {
  return async (req: GroupAuthRequest, res: Response, next: NextFunction) => {
    try {
      const communityDid = req.params.communityDid as string;
      if (!communityDid) {
        return res.status(400).json({ error: 'communityDid is required' });
      }

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        // Anonymous visitor: still allow through, just without groupAuth.
        req.groupAuth = {
          userDid: '',
          communityDid,
          isMember: false,
          isAdmin: false,
        };
        return next();
      }

      try {
        const membership = await opensocial.checkMembership(
          communityDid,
          agent.did
        );
        req.groupAuth = {
          userDid: agent.did,
          communityDid,
          isMember: membership.isMember,
          isAdmin: membership.isAdmin,
        };
      } catch (err) {
        // Membership lookup failed — fall back to non-member rather than 500.
        ctx.logger.warn(
          { err, communityDid, userDid: agent.did },
          'Optional membership check failed; treating as non-member'
        );
        req.groupAuth = {
          userDid: agent.did,
          communityDid,
          isMember: false,
          isAdmin: false,
        };
      }
      next();
    } catch (error: any) {
      ctx.logger.error({ err: error }, 'Optional membership check errored');
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

      const communityDid = req.params.communityDid as string;
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
      ctx.logger.error({ err: error }, 'Group admin check failed');
      return res
        .status(error.status || 500)
        .json({ error: error.message || 'Admin check failed' });
    }
  };
}
