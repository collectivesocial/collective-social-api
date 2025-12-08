import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';

const VALID_EMOJIS = [
  'joy',
  'heart',
  'grin',
  'sob',
  'scream',
  'upside_down',
  'smirk',
];

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // POST /reactions - Add or toggle a reaction
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { emoji, subjectUri, subjectType } = req.body;

      if (!emoji || !VALID_EMOJIS.includes(emoji)) {
        return res.status(400).json({ error: 'Invalid emoji type' });
      }

      if (!subjectUri || !subjectType) {
        return res
          .status(400)
          .json({ error: 'Subject URI and type are required' });
      }

      if (subjectType !== 'review' && subjectType !== 'comment') {
        return res
          .status(400)
          .json({ error: 'Subject type must be "review" or "comment"' });
      }

      try {
        // Check if user already has this reaction
        const existingReaction = await ctx.db
          .selectFrom('reactions')
          .selectAll()
          .where('userDid', '=', agent.did!)
          .where('subjectUri', '=', subjectUri)
          .where('emoji', '=', emoji)
          .executeTakeFirst();

        if (existingReaction) {
          // Remove the reaction (toggle off)
          const uriParts = existingReaction.uri.split('/');
          const rkey = uriParts[uriParts.length - 1];

          await agent.api.com.atproto.repo.deleteRecord({
            repo: agent.did!,
            collection: 'app.collectivesocial.feed.react',
            rkey: rkey,
          });

          await ctx.db
            .deleteFrom('reactions')
            .where('uri', '=', existingReaction.uri)
            .execute();

          return res.json({ removed: true });
        }

        // Create new reaction
        const now = new Date().toISOString();

        // Try to fetch the subject CID
        let subjectCid = 'bafyreib2rxk3rh6kzwq'; // placeholder
        try {
          const uriParts = subjectUri.split('/');
          const rkey = uriParts[uriParts.length - 1];
          const did = uriParts[2];
          const collection =
            subjectType === 'review'
              ? 'app.collectivesocial.feed.review'
              : 'app.collectivesocial.feed.comment';

          const subjectRecord = await agent.api.com.atproto.repo.getRecord({
            repo: did,
            collection: collection,
            rkey: rkey,
          });
          subjectCid = subjectRecord.data.cid as string;
        } catch (err) {
          ctx.logger.warn(
            { err, subjectUri },
            'Could not fetch subject CID, using placeholder'
          );
        }

        const record = {
          $type: 'app.collectivesocial.feed.react',
          emoji: emoji,
          subject:
            subjectType === 'review'
              ? {
                  $type: 'app.collectivesocial.feed.react#reviewRef',
                  uri: subjectUri,
                  cid: subjectCid,
                }
              : {
                  $type: 'app.collectivesocial.feed.react#commentRef',
                  uri: subjectUri,
                  cid: subjectCid,
                },
          createdAt: now,
        };

        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.feed.react',
          record: record as any,
        });

        await ctx.db
          .insertInto('reactions')
          .values({
            uri: response.data.uri,
            cid: response.data.cid,
            userDid: agent.did!,
            emoji: emoji,
            subjectUri: subjectUri,
            subjectType: subjectType,
            createdAt: new Date(),
          })
          .execute();

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          emoji: emoji,
          added: true,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to toggle reaction');
        res.status(500).json({ error: 'Failed to toggle reaction' });
      }
    })
  );

  // GET /reactions/:subjectType/:encodedUri - Get all reactions for a subject
  router.get(
    '/:subjectType/:encodedUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'public, max-age=30');

      const { subjectType } = req.params;
      const subjectUri = decodeURIComponent(req.params.encodedUri);

      if (subjectType !== 'review' && subjectType !== 'comment') {
        return res
          .status(400)
          .json({ error: 'Subject type must be "review" or "comment"' });
      }

      try {
        const reactions = await ctx.db
          .selectFrom('reactions')
          .selectAll()
          .where('subjectUri', '=', subjectUri)
          .where('subjectType', '=', subjectType)
          .execute();

        // Aggregate by emoji
        const aggregated: Record<
          string,
          { count: number; userDids: string[] }
        > = {};

        for (const reaction of reactions) {
          if (!aggregated[reaction.emoji]) {
            aggregated[reaction.emoji] = { count: 0, userDids: [] };
          }
          aggregated[reaction.emoji].count++;
          aggregated[reaction.emoji].userDids.push(reaction.userDid);
        }

        res.json({ reactions: aggregated });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch reactions');
        res.status(500).json({ error: 'Failed to fetch reactions' });
      }
    })
  );

  // GET /reactions/user/:subjectType/:encodedUri - Get current user's reactions for a subject
  router.get(
    '/user/:subjectType/:encodedUri',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.json({ userReactions: [] });
      }

      const { subjectType } = req.params;
      const subjectUri = decodeURIComponent(req.params.encodedUri);

      if (subjectType !== 'review' && subjectType !== 'comment') {
        return res
          .status(400)
          .json({ error: 'Subject type must be "review" or "comment"' });
      }

      try {
        const reactions = await ctx.db
          .selectFrom('reactions')
          .select(['emoji'])
          .where('subjectUri', '=', subjectUri)
          .where('subjectType', '=', subjectType)
          .where('userDid', '=', agent.did!)
          .execute();

        res.json({ userReactions: reactions.map((r) => r.emoji) });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch user reactions');
        res.status(500).json({ error: 'Failed to fetch user reactions' });
      }
    })
  );

  return router;
};
