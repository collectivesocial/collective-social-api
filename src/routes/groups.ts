import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { getSessionAgent } from '../auth/agent';
import * as opensocial from '../services/opensocial';
import { rkeyFromUri, resolveUserPermissions } from '../services/opensocial';
import type { ResolvedCollectionPermission } from '../services/opensocial';

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /groups — list communities from OpenSocial (enriched with display names).
  // Supports pagination via `limit` and `cursor` query params. Default page size
  // is 10 for the default discover list; clients may request a larger limit
  // (e.g. when running a search). Returns a `cursor` for the next page when
  // more results are available.
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
        const cursor =
          typeof req.query.cursor === 'string' && req.query.cursor.length > 0
            ? req.query.cursor
            : undefined;
        const parsedLimit =
          typeof req.query.limit === 'string'
            ? parseInt(req.query.limit, 10)
            : NaN;
        const limit =
          Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, 100)
            : 10;

        const { communities, cursor: nextCursor } =
          await opensocial.listCommunities({
            userDid,
            query,
            limit,
            cursor,
          });

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
            ctx.logger.warn({ err }, 'Could not fetch user memberships');
          }
        }

        // The OpenSocial XRPC returns camelCase keys (displayName, isAdmin,
        // createdAt). Map them back to the snake_case shape that the web
        // client (and our Community interface) expects.
        const result = communities.map((community) => {
          const c = community as any;
          return {
            did: c.did,
            handle: c.handle,
            pds_host: c.pds_host || c.pdsHost || null,
            display_name: c.display_name || c.displayName || null,
            description: null,
            type: c.type || 'open',
            created_at: c.created_at || c.createdAt || null,
            is_admin: c.is_admin ?? c.isAdmin ?? false,
            is_member: memberCommunityDids.has(c.did),
          };
        });

        return res.json({ communities: result, cursor: nextCursor });
      } catch (err: any) {
        ctx.logger.error({ err }, 'Error listing communities');
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // GET /groups/mine — list communities the authenticated user is a member of.
  // Reads the user's membership records from their PDS, then enriches each with
  // community details. Not paginated — assumes a user belongs to a manageable
  // number of communities.
  router.get(
    '/mine',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Collect every membership DID from the user's PDS.
        const memberCommunityDids = new Set<string>();
        let cursor: string | undefined;
        do {
          const resp = await agent.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: 'community.opensocial.membership',
            limit: 100,
            cursor,
          });
          for (const record of resp.data.records) {
            const value = record.value as { community?: string };
            if (value.community) memberCommunityDids.add(value.community);
          }
          cursor = resp.data.cursor;
        } while (cursor);

        if (memberCommunityDids.size === 0) {
          return res.json({ communities: [] });
        }

        // Enrich each membership with community details in parallel.
        const enriched = await Promise.all(
          Array.from(memberCommunityDids).map(async (did) => {
            try {
              const { community, is_admin } = await opensocial.getCommunity(
                did,
                agent.did!
              );
              // The XRPC response actually uses camelCase keys; alias both for
              // backward compatibility with the existing list response shape.
              const c = community as any;
              return {
                did: c.did,
                handle: c.handle,
                pds_host: c.pds_host || c.pdsHost || null,
                display_name: c.display_name || c.displayName || null,
                description: c.description || null,
                type: c.type || 'open',
                created_at: c.created_at || c.createdAt || null,
                is_admin,
                is_member: true,
              };
            } catch (err: any) {
              console.warn(
                `Failed to fetch community ${did} for /groups/mine:`,
                err.message
              );
              return null;
            }
          })
        );

        const communities = enriched.filter(
          (c): c is NonNullable<typeof c> => c !== null
        );

        return res.json({ communities });
      } catch (err: any) {
        console.error('Error listing user communities:', err.message);
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
        ctx.logger.error({ err }, 'Error resolving permissions');
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
            ctx.logger.warn(
              { err: memberErr, communityDid: did },
              'Membership check failed'
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

        // Fetch in-progress items across all lists
        const [allItems, allStatuses] = await Promise.all([
          opensocial.listAllCommunityRecords(did, COL_LISTITEM),
          opensocial.listAllCommunityRecords(did, COL_LISTITEM_STATUS),
        ]);

        // Tally items per list so the UI can show "n items" on each list card.
        const itemCountsByList = new Map<string, number>();
        for (const item of allItems) {
          const listUri = (item.value as { listUri?: string }).listUri;
          if (!listUri) continue;
          itemCountsByList.set(
            listUri,
            (itemCountsByList.get(listUri) ?? 0) + 1
          );
        }

        // Sort lists by explicit `order` first (admin-set drag-and-drop
        // ordering), falling back to creation time descending for lists that
        // pre-date the `order` field.
        const lists = listRecords
          .map((r) => {
            const value = r.value as Record<string, any>;
            return {
              uri: r.uri,
              rkey: rkeyFromUri(r.uri),
              ...value,
              item_count: itemCountsByList.get(r.uri) ?? 0,
            };
          })
          .sort((a: any, b: any) => {
            const aHasOrder = typeof a.order === 'number';
            const bHasOrder = typeof b.order === 'number';
            if (aHasOrder && bHasOrder) return a.order - b.order;
            if (aHasOrder) return -1;
            if (bHasOrder) return 1;
            return (
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          });

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
          ctx.logger.warn(
            { err: permErr, communityDid: did },
            'Failed to resolve permissions'
          );
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
        ctx.logger.error({ err, communityDid: did }, 'Error getting community');
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
        ctx.logger.error({ err }, 'Error creating community');
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  // POST /groups/:did/join — record a join through OpenSocial and write the
  // matching membership record into the user's PDS.
  //
  // Recovery: if OpenSocial returns 409 AlreadyMember (because a prior attempt
  // wrote the proof to the community's PDS but failed before writing to the
  // user's PDS), we still check the user's PDS and create the missing
  // `community.opensocial.membership` record so the two stores stay in sync.
  router.post(
    '/:did/join',
    handler(async (req: Request, res: Response) => {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const did = req.params.did as string;
      const MEMBERSHIP_COLLECTION = 'community.opensocial.membership';

      // Check whether the user already has a local membership record for this
      // community. Used both as an optimization and as part of the AlreadyMember
      // recovery flow below.
      const hasLocalMembershipRecord = async (): Promise<boolean> => {
        try {
          let cursor: string | undefined;
          do {
            const resp = await agent.com.atproto.repo.listRecords({
              repo: agent.did!,
              collection: MEMBERSHIP_COLLECTION,
              limit: 100,
              cursor,
            });
            const found = resp.data.records.some(
              (r) => (r.value as { community?: string }).community === did
            );
            if (found) return true;
            cursor = resp.data.cursor;
          } while (cursor);
        } catch (err) {
          console.warn('Failed to list local membership records:', err);
        }
        return false;
      };

      // Write the membership record into the user's PDS.
      const writeLocalMembership = async (): Promise<void> => {
        await agent.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: MEMBERSHIP_COLLECTION,
          record: {
            $type: MEMBERSHIP_COLLECTION,
            community: did,
            joinedAt: new Date().toISOString(),
          },
        });
      };

      try {
        const joinResp = await opensocial.joinCommunity(
          did,
          agent.did!,
          // Derive PDS host from the agent's DID doc, fallback to bsky.social
          'bsky.social'
        );

        if (joinResp.status === 'pending') {
          return res.json({
            success: true,
            status: 'pending',
            message: joinResp.message || 'Join request submitted for approval',
          });
        }

        // 'joined' (or any non-pending success) — make sure the user's PDS
        // has the matching membership record before we report success.
        if (!(await hasLocalMembershipRecord())) {
          await writeLocalMembership();
        }

        return res.json({
          success: true,
          status: 'joined',
          message: joinResp.message || 'Joined community successfully',
        });
      } catch (err: any) {
        // Recovery path: the proof exists in the community PDS but a previous
        // attempt didn't get the membership record written to the user's PDS.
        // Treat this as a successful "complete the join" rather than an error.
        const isAlreadyMember =
          err?.status === 409 &&
          (err?.message?.includes('Already a member') ||
            err?.message?.includes('AlreadyMember'));

        if (isAlreadyMember) {
          try {
            if (!(await hasLocalMembershipRecord())) {
              await writeLocalMembership();
            }
            return res.json({
              success: true,
              status: 'joined',
              message: 'Joined community successfully',
              recovered: true,
            });
          } catch (recoveryErr: any) {
            console.error(
              'Failed to recover incomplete join:',
              recoveryErr.message
            );
            return res
              .status(500)
              .json({ error: 'Failed to complete previous join attempt' });
          }
        }

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
        ctx.logger.error(
          { err, communityDid: did },
          'Error deleting community'
        );
        return res.status(err.status || 500).json({ error: err.message });
      }
    })
  );

  return router;
};
