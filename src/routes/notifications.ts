/**
 * Notification routes for group activity.
 * Mounted at /notifications.
 */

import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  /**
   * GET /notifications
   * Get the current user's group notifications.
   * Query: ?unread_only=true&community_did=…&limit=&offset=
   */
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const unreadOnly = req.query.unread_only === 'true';
      const communityDid = req.query.community_did as string | undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      let query = ctx.db
        .selectFrom('group_notifications')
        .selectAll()
        .where('recipientDid', '=', agent.did)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset);

      if (unreadOnly) {
        query = query.where('read', '=', false);
      }

      if (communityDid) {
        query = query.where('communityDid', '=', communityDid);
      }

      const notifications = await query.execute();

      // Also get unread count
      const countResult = await ctx.db
        .selectFrom('group_notifications')
        .select(ctx.db.fn.count<number>('id').as('count'))
        .where('recipientDid', '=', agent.did)
        .where('read', '=', false)
        .executeTakeFirst();

      return res.json({
        notifications,
        unreadCount: Number(countResult?.count ?? 0),
      });
    })
  );

  /**
   * POST /notifications/read
   * Mark notifications as read.
   * Body: { notification_ids: number[] } — mark specific notifications
   * OR:   { all: true, community_did?: string } — mark all (optionally per-community)
   */
  router.post(
    '/read',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { notification_ids, all, community_did } = req.body;

      if (all) {
        let query = ctx.db
          .updateTable('group_notifications')
          .set({ read: true })
          .where('recipientDid', '=', agent.did)
          .where('read', '=', false);

        if (community_did) {
          query = query.where('communityDid', '=', community_did);
        }

        await query.execute();
      } else if (Array.isArray(notification_ids) && notification_ids.length > 0) {
        await ctx.db
          .updateTable('group_notifications')
          .set({ read: true })
          .where('recipientDid', '=', agent.did)
          .where('id', 'in', notification_ids)
          .execute();
      } else {
        return res.status(400).json({ error: 'Provide notification_ids or set all: true' });
      }

      return res.json({ success: true });
    })
  );

  /**
   * GET /notifications/count
   * Get only the unread notification count (lightweight endpoint for badge display).
   */
  router.get(
    '/count',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const communityDid = req.query.community_did as string | undefined;

      let query = ctx.db
        .selectFrom('group_notifications')
        .select(ctx.db.fn.count<number>('id').as('count'))
        .where('recipientDid', '=', agent.did)
        .where('read', '=', false);

      if (communityDid) {
        query = query.where('communityDid', '=', communityDid);
      }

      const result = await query.executeTakeFirst();

      return res.json({ unreadCount: Number(result?.count ?? 0) });
    })
  );

  return router;
};
