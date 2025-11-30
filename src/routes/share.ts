import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';
import { randomBytes } from 'crypto';

// Generate a URL-safe random string
const generateShortCode = (length: number = 10): string => {
  return randomBytes(length).toString('base64url').slice(0, length);
};

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // POST /share - Create a share link for a media item
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { mediaItemId, mediaType } = req.body;

      if (!mediaItemId || !mediaType) {
        return res.status(400).json({
          error: 'mediaItemId and mediaType are required',
        });
      }

      try {
        const userDid = agent.did!;

        // Get the client URL from Origin header or fallback to localhost
        const origin = req.get('origin') || 'http://127.0.0.1:5173';
        console.log({ origin });

        // Check if a share link already exists for this user and media item
        const existing = await ctx.db
          .selectFrom('share_links')
          .selectAll()
          .where('userDid', '=', userDid)
          .where('mediaItemId', '=', mediaItemId)
          .where('mediaType', '=', mediaType)
          .executeTakeFirst();

        if (existing) {
          // Return existing share link
          return res.json({
            shortCode: existing.shortCode,
            url: `${origin}/share/${existing.shortCode}`,
            timesClicked: existing.timesClicked,
          });
        }

        // Generate a unique short code
        let shortCode = generateShortCode(10);
        let attempts = 0;
        const maxAttempts = 5;

        // Ensure uniqueness (very unlikely to collide, but just in case)
        while (attempts < maxAttempts) {
          const collision = await ctx.db
            .selectFrom('share_links')
            .select('id')
            .where('shortCode', '=', shortCode)
            .executeTakeFirst();

          if (!collision) break;

          shortCode = generateShortCode(10);
          attempts++;
        }

        if (attempts === maxAttempts) {
          return res.status(500).json({
            error: 'Failed to generate unique share code',
          });
        }

        // Create the share link
        const now = new Date();
        const shareLink = await ctx.db
          .insertInto('share_links')
          .values({
            shortCode,
            userDid,
            mediaItemId,
            mediaType,
            timesClicked: 0,
            createdAt: now,
            updatedAt: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        ctx.logger.info(
          { userDid, mediaItemId, mediaType, shortCode },
          'Share link created'
        );

        res.json({
          shortCode: shareLink.shortCode,
          url: `${origin}/share/${shareLink.shortCode}`,
          timesClicked: shareLink.timesClicked,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create share link');
        res.status(500).json({ error: 'Failed to create share link' });
      }
    })
  );

  // GET /:shortCode - Resolve a share link and increment counter
  router.get('/:shortCode', async (req: Request, res: Response) => {
    const { shortCode } = req.params;

    try {
      // Find the share link
      const shareLink = await ctx.db
        .selectFrom('share_links')
        .selectAll()
        .where('shortCode', '=', shortCode)
        .executeTakeFirst();

      if (!shareLink) {
        return res.status(404).json({ error: 'Share link not found' });
      }

      // Increment the times clicked counter
      await ctx.db
        .updateTable('share_links')
        .set({
          timesClicked: shareLink.timesClicked + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', shareLink.id)
        .execute();

      ctx.logger.info(
        {
          shortCode,
          mediaItemId: shareLink.mediaItemId,
          timesClicked: shareLink.timesClicked + 1,
        },
        'Share link accessed'
      );

      // Return the share link data with recommender info
      res.json({
        mediaItemId: shareLink.mediaItemId,
        mediaType: shareLink.mediaType,
        recommendedBy: shareLink.userDid,
        timesClicked: shareLink.timesClicked + 1,
        createdAt: shareLink.createdAt,
      });
    } catch (err) {
      ctx.logger.error({ err, shortCode }, 'Failed to resolve share link');
      res.status(500).json({ error: 'Failed to resolve share link' });
    }
  });

  return router;
};
