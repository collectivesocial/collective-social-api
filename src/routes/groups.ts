import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';
import * as opensocial from '../services/opensocial';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /groups — list all communities from OpenSocial (enriched with display names)
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      const userDid = agent?.did ?? undefined;

      try {
        const communities = await opensocial.listCommunities(userDid);

        // display_name comes from the list endpoint directly;
        // description is only available on the detail view.
        const result = communities.map((community) => ({
          ...community,
          display_name: community.display_name || null,
          description: null,
        }));

        return res.json({ communities: result });
      } catch (err: any) {
        console.error('Error listing communities:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // GET /groups/:did — get a single community's full details
  router.get(
    '/:did',
    handler(async (req: Request, res: Response) => {
      const { did } = req.params;
      const agent = await getSessionAgent(req, res, ctx);
      const userDid = agent?.did ?? undefined;

      try {
        const data = await opensocial.getCommunity(did, userDid);
        return res.json(data);
      } catch (err: any) {
        console.error('Error getting community:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // POST /groups — create a new community via OpenSocial
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { handle, display_name, description } = req.body;
      if (!handle || !display_name) {
        return res
          .status(400)
          .json({ error: 'Missing required fields: handle, display_name' });
      }

      try {
        const data = await opensocial.createCommunity({
          handle,
          display_name,
          description,
          creator_did: agent.did!,
        });
        return res.json(data);
      } catch (err: any) {
        console.error('Error creating community:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // POST /groups/:did/join — get join info, then write membership record
  router.post(
    '/:did/join',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { did } = req.params;

      try {
        // Ask OpenSocial for the join record template
        const joinInfo = await opensocial.joinCommunity(
          did,
          agent.did!,
          // Derive PDS host from the agent's DID doc, fallback to bsky.social
          'bsky.social'
        );

        // Write the membership record into the user's repo
        await agent.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: joinInfo.collection,
          record: joinInfo.record,
        });

        return res.json({
          success: true,
          community: joinInfo.community,
          message: 'Joined community successfully',
        });
      } catch (err: any) {
        console.error('Error joining community:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // DELETE /groups/:did — delete a community (must be sole admin)
  router.delete(
    '/:did',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { did } = req.params;

      try {
        await opensocial.deleteCommunity(did, agent.did!);
        return res.json({ success: true, message: 'Community deleted' });
      } catch (err: any) {
        console.error('Error deleting community:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  return router;
};
