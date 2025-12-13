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

  // POST /share - Create a share link for a media item or collection
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { mediaItemId, mediaType, collectionUri } = req.body;

      // Validate: must provide either media item or collection, not both
      if ((!mediaItemId && !collectionUri) || (mediaItemId && collectionUri)) {
        return res.status(400).json({
          error: 'Provide either mediaItemId and mediaType OR collectionUri',
        });
      }

      if (mediaItemId && !mediaType) {
        return res.status(400).json({
          error: 'mediaType is required when sharing a media item',
        });
      }

      try {
        const userDid = agent.did!;

        // Get the client URL from Origin header or fallback to localhost
        const origin = req.get('origin') || 'http://127.0.0.1:5173';

        // Check if a share link already exists
        let existing;
        if (collectionUri) {
          existing = await ctx.db
            .selectFrom('share_links')
            .selectAll()
            .where('userDid', '=', userDid)
            .where('collectionUri', '=', collectionUri)
            .executeTakeFirst();
        } else {
          existing = await ctx.db
            .selectFrom('share_links')
            .selectAll()
            .where('userDid', '=', userDid)
            .where('mediaItemId', '=', mediaItemId)
            .where('mediaType', '=', mediaType)
            .executeTakeFirst();
        }

        if (existing) {
          // Get title for response
          let title = null;
          if (collectionUri) {
            // Fetch collection name from ATProto
            const listsResponse = await agent.api.com.atproto.repo.listRecords({
              repo: agent.did!,
              collection: 'app.collectivesocial.feed.list',
            });
            const collection = listsResponse.data.records.find(
              (record: any) => record.uri === collectionUri
            );
            title = collection?.value?.name || null;
          } else {
            // Get media item details
            const mediaItem = await ctx.db
              .selectFrom('media_items')
              .select(['title'])
              .where('id', '=', mediaItemId)
              .executeTakeFirst();
            title = mediaItem?.title || null;
          }

          // Return existing share link
          return res.json({
            shortCode: existing.shortCode,
            url: `${origin}/share/${existing.shortCode}`,
            timesClicked: existing.timesClicked,
            title,
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
            mediaItemId: mediaItemId || null,
            mediaType: mediaType || null,
            collectionUri: collectionUri || null,
            timesClicked: 0,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returningAll()
          .executeTakeFirstOrThrow();

        // Get title for response
        let title = null;
        if (collectionUri) {
          // Fetch collection name from ATProto
          const listsResponse = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.list',
          });
          const collection = listsResponse.data.records.find(
            (record: any) => record.uri === collectionUri
          );
          title = collection?.value?.name || null;
        } else {
          // Get media item details
          const mediaItem = await ctx.db
            .selectFrom('media_items')
            .select(['title'])
            .where('id', '=', mediaItemId)
            .executeTakeFirst();
          title = mediaItem?.title || null;
        }

        ctx.logger.info(
          { userDid, mediaItemId, mediaType, collectionUri, shortCode },
          'Share link created'
        );

        res.json({
          shortCode: shareLink.shortCode,
          url: `${origin}/share/${shareLink.shortCode}`,
          timesClicked: shareLink.timesClicked,
          title,
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
        collectionUri: shareLink.collectionUri,
        recommendedBy: shareLink.userDid,
        timesClicked: shareLink.timesClicked + 1,
        createdAt: shareLink.createdAt,
      });
    } catch (err) {
      ctx.logger.error({ err, shortCode }, 'Failed to resolve share link');
      res.status(500).json({ error: 'Failed to resolve share link' });
    }
  });

  // GET /user/links - Get all share links for the authenticated user
  router.get(
    '/user/links',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const userDid = agent.did!;
        const origin = req.get('origin') || 'http://127.0.0.1:5173';

        // Fetch all share links for this user with media item details
        const shareLinks = await ctx.db
          .selectFrom('share_links')
          .leftJoin('media_items', 'share_links.mediaItemId', 'media_items.id')
          .select([
            'share_links.id',
            'share_links.shortCode',
            'share_links.mediaItemId',
            'share_links.mediaType',
            'share_links.collectionUri',
            'share_links.timesClicked',
            'share_links.createdAt',
            'share_links.updatedAt',
            'media_items.title',
            'media_items.creator',
            'media_items.coverImage',
          ])
          .where('share_links.userDid', '=', userDid)
          .orderBy('share_links.createdAt', 'desc')
          .execute();

        // For links with collectionUri, fetch collection names from ATProto
        const listsResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.list',
        });

        // Add full URL and collection names to each link
        const linksWithUrls = shareLinks.map((link) => {
          let collectionName = null;
          if (link.collectionUri) {
            const collection = listsResponse.data.records.find(
              (record: any) => record.uri === link.collectionUri
            );
            collectionName = collection?.value?.name || null;
          }

          return {
            ...link,
            url: `${origin}/share/${link.shortCode}`,
            collectionName,
          };
        });

        res.json({ links: linksWithUrls });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch user share links');
        res.status(500).json({ error: 'Failed to fetch share links' });
      }
    })
  );

  // DELETE /user/links/:id - Delete a share link
  router.delete(
    '/user/links/:id',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const userDid = agent.did!;
        const linkId = parseInt(req.params.id);

        if (isNaN(linkId)) {
          return res.status(400).json({ error: 'Invalid link ID' });
        }

        // Verify the link belongs to this user before deleting
        const link = await ctx.db
          .selectFrom('share_links')
          .select(['id', 'userDid'])
          .where('id', '=', linkId)
          .executeTakeFirst();

        if (!link) {
          return res.status(404).json({ error: 'Share link not found' });
        }

        if (link.userDid !== userDid) {
          return res
            .status(403)
            .json({ error: 'Not authorized to delete this link' });
        }

        // Delete the share link
        await ctx.db
          .deleteFrom('share_links')
          .where('id', '=', linkId)
          .execute();

        ctx.logger.info({ linkId, userDid }, 'Share link deleted');

        res.json({ success: true, message: 'Share link deleted' });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete share link');
        res.status(500).json({ error: 'Failed to delete share link' });
      }
    })
  );

  return router;
};
