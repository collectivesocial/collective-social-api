import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // POST /feedback - Submit feedback
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const { message, email } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }

      try {
        const agent = await getSessionAgent(req, res, ctx);
        const userDid = agent?.did || null;

        const now = new Date();

        const result = await ctx.db
          .insertInto('feedback')
          .values({
            userDid,
            email: email || null,
            message: message.trim(),
            status: 'new',
            adminNotes: null,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning(['id', 'status', 'createdAt'])
          .executeTakeFirst();

        res.json({
          success: true,
          feedback: result,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to submit feedback');
        res.status(500).json({ error: 'Failed to submit feedback' });
      }
    })
  );

  // GET /feedback - Get all feedback (admin only)
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Check if user is admin
        const user = await ctx.db
          .selectFrom('users')
          .select(['isAdmin'])
          .where('did', '=', agent?.assertDid)
          .executeTakeFirst();

        if (!user || !user.isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        // Get all feedback ordered by newest first
        const feedback = await ctx.db
          .selectFrom('feedback')
          .select([
            'feedback.id',
            'feedback.userDid',
            'feedback.email',
            'feedback.message',
            'feedback.status',
            'feedback.adminNotes',
            'feedback.createdAt',
            'feedback.updatedAt',
          ])
          .orderBy('feedback.createdAt', 'desc')
          .execute();

        // Lookup handles for users with DIDs
        const feedbackWithHandles = await Promise.all(
          feedback.map(async (item) => {
            let userHandle = null;
            if (item.userDid) {
              try {
                const profile = await agent.getProfile({
                  actor: item.userDid,
                });
                userHandle = profile.data.handle;
              } catch (err) {
                ctx.logger.warn(
                  { did: item.userDid, err },
                  'Failed to lookup user handle'
                );
              }
            }
            return { ...item, userHandle };
          })
        );

        res.json({ feedback: feedbackWithHandles });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch feedback');
        res.status(500).json({ error: 'Failed to fetch feedback' });
      }
    })
  );

  // PUT /feedback/:id - Update feedback status/notes (admin only)
  router.put(
    '/:id',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent?.did) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { status, adminNotes } = req.body;
      const feedbackId = parseInt(req.params.id);

      if (isNaN(feedbackId)) {
        return res.status(400).json({ error: 'Invalid feedback ID' });
      }

      try {
        // Check if user is admin
        const user = await ctx.db
          .selectFrom('users')
          .select(['isAdmin'])
          .where('did', '=', agent?.assertDid)
          .executeTakeFirst();

        if (!user || !user.isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        // Update feedback
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (status !== undefined) {
          updateData.status = status;
        }

        if (adminNotes !== undefined) {
          updateData.adminNotes = adminNotes;
        }

        const result = await ctx.db
          .updateTable('feedback')
          .set(updateData)
          .where('id', '=', feedbackId)
          .returning(['id', 'status', 'adminNotes', 'updatedAt'])
          .executeTakeFirst();

        if (!result) {
          return res.status(404).json({ error: 'Feedback not found' });
        }

        res.json({
          success: true,
          feedback: result,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update feedback');
        res.status(500).json({ error: 'Failed to update feedback' });
      }
    })
  );

  return router;
};
