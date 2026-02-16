import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';
import * as opensocial from '../services/opensocial';
import { rkeyFromUri, resolveUserPermissions } from '../services/opensocial';
import type { ResolvedCollectionPermission } from '../services/opensocial';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /groups — list all communities from OpenSocial (enriched with display names)
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      const userDid = agent?.did ?? undefined;

      try {
        const query =
          typeof req.query.query === 'string'
            ? req.query.query.trim()
            : undefined;
        const communities = await opensocial.listCommunities(userDid, query);

        // If user is authenticated, check which communities they're a member of
        const memberCommunityDids = new Set<string>();
        if (agent) {
          try {
            const membershipsResponse =
              await agent.com.atproto.repo.listRecords({
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

  /**
   * GET /groups/:did/permissions
   * Lightweight endpoint that returns ONLY the user's resolved permissions.
   * Costs 1 open-social call (cached for 60s) instead of the ~8 calls that
   * the full GET /groups/:did route makes.
   */
  router.get(
    '/:did/permissions',
    handler(async (req: Request, res: Response) => {
      const did = req.params.did as string;
      const agent = await getSessionAgent(req, res, ctx);
      const userDid = agent?.did ?? undefined;

      try {
        const permissions = await resolveUserPermissions(did, userDid);
        return res.json({ permissions });
      } catch (err: any) {
        console.error('Error resolving permissions:', err.message);
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
      const did = req.params.did as string;
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
            isMember = membership.isMember;
            isAdmin = membership.isAdmin;
          } catch (memberErr: any) {
            console.error(
              `Membership check failed for ${did}:`,
              memberErr.message || memberErr
            );
            // Not a member or check failed — that's fine for public view
          }
        }

        // Fetch group lists from PDS (source of truth)
        const COL_LIST = 'app.collectivesocial.group.list';
        const COL_LISTITEM = 'app.collectivesocial.group.listitem';
        const COL_LISTITEM_STATUS =
          'app.collectivesocial.group.listitem.status';

        const listRecords = await opensocial.listAllCommunityRecords(
          did,
          COL_LIST
        );
        const lists = listRecords
          .map((r) => ({ uri: r.uri, rkey: rkeyFromUri(r.uri), ...r.value }))
          .sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

        // Fetch in-progress items across all lists
        const [allItems, allStatuses] = await Promise.all([
          opensocial.listAllCommunityRecords(did, COL_LISTITEM),
          opensocial.listAllCommunityRecords(did, COL_LISTITEM_STATUS),
        ]);
        const inProgressItemUris = new Set(
          allStatuses
            .filter((s: any) => s.value.status === 'in-progress')
            .map((s: any) => s.value.listItemUri as string)
        );
        const inProgressItems = allItems
          .filter((r) => inProgressItemUris.has(r.uri))
          .map((r) => ({
            uri: r.uri,
            rkey: rkeyFromUri(r.uri),
            ...r.value,
            status: 'in-progress',
          }));

        // Get member count
        let memberCount = 0;
        try {
          const members = await opensocial.listMembers(did);
          memberCount = members.total;
        } catch {
          // Unable to fetch — that's okay
        }

        // Resolve the current user's permissions for each collection.
        // Returns resolved booleans based on the user's roles + community config.
        // Cached for 60s in the opensocial client.
        let permissions: Record<string, ResolvedCollectionPermission> = {};
        try {
          permissions = await resolveUserPermissions(did, userDid);
        } catch (permErr: any) {
          console.warn('Failed to resolve permissions:', permErr.message);
        }

        return res.json({
          ...data,
          is_member: isMember,
          is_admin: isAdmin,
          member_count: memberCount,
          permissions,
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

      const did = req.params.did as string;

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

      const did = req.params.did as string;

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
