import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { AppCollectiveSocialFeedCompletion } from '../types/lexicon';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /completions/:mediaItemId - Get all completions for a media item
  router.get(
    '/:mediaItemId',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const mediaItemId = parseInt(req.params.mediaItemId, 10);
      if (isNaN(mediaItemId)) {
        return res.status(400).json({ error: 'Invalid mediaItemId' });
      }

      try {
        const completions: any[] = [];
        let cursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.completion',
            limit: 100,
            cursor,
          });

          for (const record of response.data.records) {
            const val = record.value as any;
            if (val.mediaItemId === mediaItemId) {
              completions.push({
                uri: record.uri,
                cid: record.cid,
                mediaItemId: val.mediaItemId,
                mediaType: val.mediaType || null,
                completedAt: val.completedAt,
                rating: val.rating ?? null,
                notes: val.notes || null,
                review: val.review || null,
                createdAt: val.createdAt,
              });
            }
          }

          cursor = response.data.cursor;
          if (!cursor || response.data.records.length === 0) break;
        }

        // Sort by completedAt descending (most recent first)
        completions.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() -
            new Date(a.completedAt).getTime()
        );

        res.json({ completions });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch completions');
        res.status(500).json({ error: 'Failed to fetch completions' });
      }
    })
  );

  // POST /completions - Create a new completion record
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { mediaItemId, mediaType, completedAt, rating, notes } = req.body;

      if (!mediaItemId || !completedAt) {
        return res
          .status(400)
          .json({ error: 'mediaItemId and completedAt are required' });
      }

      try {
        const now = new Date().toISOString();

        const record: AppCollectiveSocialFeedCompletion.Record = {
          $type: 'app.collectivesocial.feed.completion',
          mediaItemId,
          mediaType: mediaType || undefined,
          completedAt,
          rating:
            rating !== undefined && rating !== null
              ? Number(rating)
              : undefined,
          notes: notes || undefined,
          createdAt: now,
        };

        const createResponse = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.completion',
          record: record as any,
        });

        res.json({
          uri: createResponse.data.uri,
          cid: createResponse.data.cid,
          completion: {
            uri: createResponse.data.uri,
            cid: createResponse.data.cid,
            ...record,
          },
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create completion');
        res.status(500).json({ error: 'Failed to create completion' });
      }
    })
  );

  // DELETE /completions/:completionUri - Delete a completion record
  router.delete(
    '/:completionUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const completionUri = decodeURIComponent(req.params.completionUri);
      const rkeyMatch = completionUri.match(/\/([^\/]+)$/);
      if (!rkeyMatch) {
        return res.status(400).json({ error: 'Invalid completion URI' });
      }
      const rkey = rkeyMatch[1];

      try {
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.completion',
          rkey,
        });

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete completion');
        res.status(500).json({ error: 'Failed to delete completion' });
      }
    })
  );

  // GET /completions/user/:did/:mediaItemId - Get another user's completions (public)
  router.get(
    '/user/:did/:mediaItemId',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userDid = req.params.did;
      const mediaItemId = parseInt(req.params.mediaItemId, 10);
      if (isNaN(mediaItemId)) {
        return res.status(400).json({ error: 'Invalid mediaItemId' });
      }

      try {
        const completions: any[] = [];
        let cursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: userDid,
            collection: 'app.collectivesocial.feed.completion',
            limit: 100,
            cursor,
          });

          for (const record of response.data.records) {
            const val = record.value as any;
            if (val.mediaItemId === mediaItemId) {
              completions.push({
                uri: record.uri,
                cid: record.cid,
                mediaItemId: val.mediaItemId,
                mediaType: val.mediaType || null,
                completedAt: val.completedAt,
                rating: val.rating ?? null,
                // notes are private — don't expose for other users
                createdAt: val.createdAt,
              });
            }
          }

          cursor = response.data.cursor;
          if (!cursor || response.data.records.length === 0) break;
        }

        completions.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() -
            new Date(a.completedAt).getTime()
        );

        res.json({ completions });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch user completions');
        res.status(500).json({ error: 'Failed to fetch completions' });
      }
    })
  );

  return router;
};
