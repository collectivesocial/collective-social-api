import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import { config } from '../config';
import { handler } from '../lib/http';
import {
  AppCollectiveSocialList,
  AppCollectiveSocialListitem,
} from '../types/lexicon';

type Session = { did?: string };

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: express.Request,
  res: express.Response,
  ctx: AppContext
) {
  res.setHeader('Vary', 'Cookie');

  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: config.cookieSecret,
    cookieOptions: {
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      httpOnly: true,
      path: '/',
    },
  });
  if (!session.did) return null;

  res.setHeader('cache-control', 'private, no-store');

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    await session.destroy();
    return null;
  }
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /collections - Get all collections for the authenticated user
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // List records of type app.collectivesocial.list from the user's repo
        const response = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
        });

        res.json({
          collections: response.data.records.map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            name: record.value.name,
            description: record.value.description || null,
            purpose: record.value.purpose,
            avatar: record.value.avatar || null,
            createdAt: record.value.createdAt,
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch collections');
        res.status(500).json({ error: 'Failed to fetch collections' });
      }
    })
  );

  // POST /collections - Create a new collection
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { name, description, purpose } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      try {
        const record: AppCollectiveSocialList.Record = {
          $type: 'app.collectivesocial.list',
          name,
          description: description || undefined,
          purpose: purpose || 'app.collectivesocial.defs#curatelist',
          createdAt: new Date().toISOString(),
        };

        // Create a record in the user's repo using the custom lexicon
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.list',
          record: record as any,
        });

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          name,
          description: description || null,
          purpose: record.purpose,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create collection');
        res.status(500).json({ error: 'Failed to create collection' });
      }
    })
  );

  // GET /collections/:uri/items - Get all items in a collection
  router.get(
    '/:listUri/items',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Decode URI from route param
        const listUri = decodeURIComponent(req.params.listUri);

        // List all listitem records from the user's repo
        const response = await agent.api.com.atproto.repo.listRecords({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
        });

        // Filter items that belong to this list
        const items = response.data.records
          .filter((record: any) => record.value.list === listUri)
          .map((record: any) => ({
            uri: record.uri,
            cid: record.cid,
            title: record.value.title,
            creator: record.value.creator || null,
            mediaType: record.value.mediaType || null,
            status: record.value.status || null,
            rating:
              record.value.rating !== undefined ? record.value.rating : null,
            review: record.value.review || null,
            createdAt: record.value.createdAt,
          }));

        res.json({ items });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch collection items');
        res.status(500).json({ error: 'Failed to fetch collection items' });
      }
    })
  );

  // POST /collections/:listUri/items - Add an item to a collection
  router.post(
    '/:listUri/items',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { title, rating, status, review, mediaType, creator } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      try {
        const listUri = decodeURIComponent(req.params.listUri);

        // Create a listitem record with the review data
        const listItemRecord: AppCollectiveSocialListitem.Record = {
          $type: 'app.collectivesocial.listitem',
          list: listUri,
          title,
          creator: creator || undefined,
          mediaType: mediaType || undefined,
          status: status || undefined,
          rating: rating !== undefined ? Number(rating) : undefined,
          review: review || undefined,
          createdAt: new Date().toISOString(),
        };

        // Create the record in the user's repo
        const response = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: 'app.collectivesocial.listitem',
          record: listItemRecord as any,
        });

        res.json({
          uri: response.data.uri,
          cid: response.data.cid,
          title,
          rating,
          status,
          mediaType,
          creator,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to add item to collection');
        res.status(500).json({ error: 'Failed to add item to collection' });
      }
    })
  );

  return router;
};
