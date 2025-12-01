import express, { Request, Response } from 'express';
import { getUserByHandle } from '../models/user';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /users/me - Get current authenticated user profile
  router.get(
    '/me',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const profile = await agent.getProfile({ actor: agent.did! });

        // Get collection count
        const collectionsResponse =
          await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.list',
          });
        const collectionCount = collectionsResponse.data.records.length;

        // Get review count
        const reviewCount = await ctx.db
          .selectFrom('reviews')
          .select(({ fn }) => [fn.countAll().as('count')])
          .where('authorDid', '=', agent.did!)
          .executeTakeFirst();

        res.json({
          did: profile.data.did,
          handle: profile.data.handle,
          displayName: profile.data.displayName,
          avatar: profile.data.avatar,
          description: profile.data.description,
          followerCount: profile.data.followersCount,
          collectionCount,
          reviewCount: Number(reviewCount?.count || 0),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch profile');
        res.status(500).json({ error: 'Failed to fetch profile' });
      }
    })
  );

  // GET /users/:handle - Get a user by handle
  router.get('/:handle', async (req: Request, res: Response) => {
    const agent = await getSessionAgent(req, res, ctx);
    if (!agent) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const profile = await agent.getProfile({ actor: req.params.handle });

      // Get collection count
      const collectionsResponse = await agent.api.com.atproto.repo.listRecords({
        repo: profile.data.did,
        collection: 'app.collectivesocial.feed.list',
      });
      const collectionCount = collectionsResponse.data.records.length;

      // Get review count
      const user = await ctx.db
        .selectFrom('users')
        .where('did', '=', profile.data.did)
        .executeTakeFirst();

      // Get review count
      const reviewCount = await ctx.db
        .selectFrom('reviews')
        .select(({ fn }) => [fn.countAll().as('count')])
        .where('authorDid', '=', profile.data.did)
        .executeTakeFirst();

      res.json({
        did: profile.data.did,
        handle: profile.data.handle,
        displayName: profile.data.displayName,
        avatar: profile.data.avatar,
        description: profile.data.description,
        followerCount: profile.data.followersCount,
        collectionCount,
        reviewCount: Number(reviewCount?.count || 0),
        isInDatabase: user ? true : false,
      });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to fetch profile');
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  // GET /users/following/:did - Check if current user is following the specified DID
  router.get(
    '/following/:did',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const { did } = req.params;

        // List follow records from the current user's repo
        const response = await agent.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.bsky.graph.follow',
        });

        // Check if there's a follow record for the specified DID
        const followRecord = response.data.records.find(
          (record: any) => record.value.subject === did
        );

        res.json({
          isFollowing: !!followRecord,
          followUri: followRecord?.uri || null,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to check follow status');
        res.status(500).json({ error: 'Failed to check follow status' });
      }
    })
  );

  // POST /users/follow/:did - Follow a user
  router.post(
    '/follow/:did',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const { did } = req.params;

        // Check if already following
        const listResponse = await agent.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.bsky.graph.follow',
        });

        const existingFollow = listResponse.data.records.find(
          (record: any) => record.value.subject === did
        );

        if (existingFollow) {
          return res.json({
            success: true,
            uri: existingFollow.uri,
            message: 'Already following',
          });
        }

        // Create follow record
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.bsky.graph.follow',
          record: {
            subject: did,
            createdAt: new Date().toISOString(),
          },
        });

        res.json({
          success: true,
          uri: response.data.uri,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to follow user');
        res.status(500).json({ error: 'Failed to follow user' });
      }
    })
  );

  // DELETE /users/unfollow/:did - Unfollow a user
  router.delete(
    '/unfollow/:did',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const { did } = req.params;

        // Find the follow record
        const listResponse = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.bsky.graph.follow',
        });

        const followRecord = listResponse.data.records.find(
          (record: any) => record.value.subject === did
        );

        if (!followRecord) {
          return res.status(404).json({ error: 'Not following this user' });
        }

        // Extract rkey from URI (format: at://did/collection/rkey)
        const rkey = followRecord.uri.split('/').pop();

        // Delete the follow record
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: 'app.bsky.graph.follow',
          rkey: rkey!,
        });

        res.json({
          success: true,
          message: 'Unfollowed successfully',
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to unfollow user');
        res.status(500).json({ error: 'Failed to unfollow user' });
      }
    })
  );

  // DELETE /users/me - Delete user account and all associated data
  router.delete(
    '/me',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userDid = agent.did!;

      try {
        // Delete all user-related data in a transaction-like fashion
        // 1. Delete reviews authored by this user
        await ctx.db
          .deleteFrom('reviews')
          .where('authorDid', '=', userDid)
          .execute();

        // 2. Delete feedback submitted by this user
        await ctx.db
          .deleteFrom('feedback')
          .where('userDid', '=', userDid)
          .execute();

        // 3. Delete feed events for this user
        await ctx.db
          .deleteFrom('feed_events')
          .where('userDid', '=', userDid)
          .execute();

        // 4. Delete share links created by this user
        await ctx.db
          .deleteFrom('share_links')
          .where('userDid', '=', userDid)
          .execute();

        // 5. Delete the user record
        await ctx.db.deleteFrom('users').where('did', '=', userDid).execute();

        // 6. Clear session
        res.clearCookie('connect.sid');

        ctx.logger.info({ userDid }, 'User account deleted successfully');

        res.json({
          success: true,
          message: 'Account and all associated data deleted successfully',
        });
      } catch (err) {
        ctx.logger.error({ err, userDid }, 'Failed to delete user account');
        res.status(500).json({ error: 'Failed to delete account' });
      }
    })
  );

  return router;
};
