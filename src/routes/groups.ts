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

        // If user is authenticated, check which communities they're a member of
        const memberCommunityDids = new Set<string>();
        if (agent) {
          try {
            const membershipsResponse = await agent.com.atproto.repo.listRecords({
              repo: agent.did!,
              collection: 'community.opensocial.membership',
            });
            for (const record of membershipsResponse.data.records) {
              const value = record.value as { community?: string };
              if (value.community) {
                memberCommunityDids.add(value.community);
              }
            }
          } catch (err) {
            console.warn('Could not fetch user memberships:', err);
          }
        }

        // display_name comes from the list endpoint directly;
        // description is only available on the detail view.
        const result = communities.map((community) => ({
          ...community,
          display_name: community.display_name || null,
          description: null,
          is_member: memberCommunityDids.has(community.did),
        }));

        return res.json({ communities: result });
      } catch (err: any) {
        console.error('Error listing communities:', err.message);
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // GET /groups/:did — get a single community's full details
  // Includes public lists and in-progress items for the group detail page.
  // Works for both authenticated members and unauthenticated visitors.
  router.get(
    '/:did',
    handler(async (req: Request, res: Response) => {
      const { did } = req.params;
      const agent = await getSessionAgent(req, res, ctx);
      const userDid = agent?.did ?? undefined;

      try {
        const data = await opensocial.getCommunity(did, userDid);

        // Check membership status
        let isMember = false;
        let isAdmin = false;
        if (userDid) {
          try {
            const membership = await opensocial.checkMembership(did, userDid);
            isMember = membership.is_member;
            isAdmin = membership.is_admin;
          } catch (memberErr: any) {
            console.error(`Membership check failed for ${did}:`, memberErr.message || memberErr);
            // Not a member or check failed — that's fine for public view
          }
        }

        // Fetch group lists from Postgres index (public data)
        const lists = await ctx.db
          .selectFrom('group_lists')
          .selectAll()
          .where('communityDid', '=', did)
          .orderBy('createdAt', 'desc')
          .execute();

        // Fetch in-progress items across all lists
        const inProgressItems = await ctx.db
          .selectFrom('group_list_items')
          .selectAll()
          .where('communityDid', '=', did)
          .where('status', '=', 'in-progress')
          .orderBy('updatedAt', 'desc')
          .execute();

        // Get member count
        let memberCount = 0;
        try {
          const members = await opensocial.listMembers(did);
          memberCount = members.total;
        } catch {
          // Unable to fetch — that's okay
        }

        return res.json({
          ...data,
          is_member: isMember,
          is_admin: isAdmin,
          member_count: memberCount,
          lists,
          in_progress_items: inProgressItems,
        });
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
