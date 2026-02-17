import express, { Request, Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { AppCollectiveSocialFeedGoal } from '../types/lexicon';
import { getSessionAgent } from '../auth/agent';

const COLLECTION = 'app.collectivesocial.feed.goal';
const COMPLETION_COLLECTION = 'app.collectivesocial.feed.completion';

/**
 * Count completions in a user's PDS that fall within a date range,
 * optionally filtered by media type.
 */
async function countCompletionsForGoal(
  agent: any,
  repo: string,
  mediaType: string | null | undefined,
  startDate: string,
  endDate: string
): Promise<number> {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  let count = 0;
  let cursor: string | undefined;

  while (true) {
    const response = await agent.api.com.atproto.repo.listRecords({
      repo,
      collection: COMPLETION_COLLECTION,
      limit: 100,
      cursor,
    });

    for (const record of response.data.records) {
      const val = record.value as any;
      const completedAt = new Date(val.completedAt).getTime();

      if (completedAt >= start && completedAt <= end) {
        if (!mediaType || val.mediaType === mediaType) {
          count++;
        }
      }
    }

    cursor = response.data.cursor;
    if (!cursor || response.data.records.length === 0) break;
  }

  return count;
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /goals — List the authenticated user's goals, enriched with cached progress
  router.get(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        const goals: any[] = [];
        let cursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: COLLECTION,
            limit: 100,
            cursor,
          });

          for (const record of response.data.records) {
            const val = record.value as any;
            goals.push({
              uri: record.uri,
              cid: record.cid,
              title: val.title,
              mediaType: val.mediaType || null,
              targetCount: val.targetCount,
              startDate: val.startDate,
              endDate: val.endDate,
              visibility: val.visibility || 'public',
              createdAt: val.createdAt,
            });
          }

          cursor = response.data.cursor;
          if (!cursor || response.data.records.length === 0) break;
        }

        // Enrich with cached progress from Postgres
        const goalUris = goals.map((g) => g.uri);
        let cachedMap = new Map<string, number>();

        if (goalUris.length > 0) {
          const cached = await ctx.db
            .selectFrom('goals')
            .select(['uri', 'cachedCompletedCount'])
            .where('uri', 'in', goalUris)
            .execute();

          for (const row of cached) {
            cachedMap.set(row.uri, row.cachedCompletedCount);
          }
        }

        const enriched = goals.map((g) => ({
          ...g,
          completedCount: cachedMap.get(g.uri) ?? 0,
          percentage: Math.min(
            100,
            Math.round(
              ((cachedMap.get(g.uri) ?? 0) / g.targetCount) * 100
            )
          ),
        }));

        // Sort: active goals first (endDate in the future), then by startDate desc
        enriched.sort((a, b) => {
          const now = Date.now();
          const aActive = new Date(a.endDate).getTime() >= now ? 1 : 0;
          const bActive = new Date(b.endDate).getTime() >= now ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (
            new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
          );
        });

        res.json({ goals: enriched });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch goals');
        res.status(500).json({ error: 'Failed to fetch goals' });
      }
    })
  );

  // POST /goals — Create a new goal
  router.post(
    '/',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { title, mediaType, targetCount, startDate, endDate, visibility } =
        req.body;

      if (!title || !targetCount || !startDate || !endDate) {
        return res.status(400).json({
          error: 'title, targetCount, startDate, and endDate are required',
        });
      }

      if (targetCount < 1) {
        return res
          .status(400)
          .json({ error: 'targetCount must be at least 1' });
      }

      if (new Date(endDate) <= new Date(startDate)) {
        return res
          .status(400)
          .json({ error: 'endDate must be after startDate' });
      }

      try {
        const now = new Date().toISOString();

        const record: AppCollectiveSocialFeedGoal.Record = {
          $type: COLLECTION,
          title,
          mediaType: mediaType || undefined,
          targetCount: Number(targetCount),
          startDate,
          endDate,
          visibility: visibility || 'public',
          createdAt: now,
        };

        const createResponse = await agent.api.com.atproto.repo.createRecord({
          repo: agent.did!,
          collection: COLLECTION,
          record: record as any,
        });

        // Also index in Postgres for cached progress
        await ctx.db
          .insertInto('goals')
          .values({
            uri: createResponse.data.uri,
            authorDid: agent.did!,
            title,
            mediaType: mediaType || null,
            targetCount: Number(targetCount),
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            visibility: visibility || 'public',
            cachedCompletedCount: 0,
            createdAt: new Date(now),
          } as any)
          .execute();

        ctx.logger.info(
          { userDid: agent.did, uri: createResponse.data.uri },
          'Goal created'
        );

        res.json({
          uri: createResponse.data.uri,
          cid: createResponse.data.cid,
          goal: {
            uri: createResponse.data.uri,
            cid: createResponse.data.cid,
            ...record,
            completedCount: 0,
            percentage: 0,
          },
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create goal');
        res.status(500).json({ error: 'Failed to create goal' });
      }
    })
  );

  // PUT /goals/:rkey — Update an existing goal
  router.put(
    '/:rkey',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const rkey = req.params.rkey as string;
      const { title, mediaType, targetCount, startDate, endDate, visibility } =
        req.body;

      if (!title || !targetCount || !startDate || !endDate) {
        return res.status(400).json({
          error: 'title, targetCount, startDate, and endDate are required',
        });
      }

      try {
        const record: AppCollectiveSocialFeedGoal.Record = {
          $type: COLLECTION,
          title,
          mediaType: mediaType || undefined,
          targetCount: Number(targetCount),
          startDate,
          endDate,
          visibility: visibility || 'public',
          createdAt: req.body.createdAt || new Date().toISOString(),
        };

        await agent.api.com.atproto.repo.putRecord({
          repo: agent.did!,
          collection: COLLECTION,
          rkey,
          record: record as any,
        });

        const uri = `at://${agent.did}/${COLLECTION}/${rkey}`;

        // Update Postgres index
        await ctx.db
          .updateTable('goals')
          .set({
            title,
            mediaType: mediaType || null,
            targetCount: Number(targetCount),
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            visibility: visibility || 'public',
          })
          .where('uri', '=', uri)
          .execute();

        ctx.logger.info({ userDid: agent.did, uri }, 'Goal updated');

        res.json({
          uri,
          goal: record,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to update goal');
        res.status(500).json({ error: 'Failed to update goal' });
      }
    })
  );

  // DELETE /goals/:rkey — Delete a goal
  router.delete(
    '/:rkey',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const rkey = req.params.rkey as string;

      try {
        await agent.api.com.atproto.repo.deleteRecord({
          repo: agent.did!,
          collection: COLLECTION,
          rkey,
        });

        const uri = `at://${agent.did}/${COLLECTION}/${rkey}`;

        // Remove from Postgres index
        await ctx.db.deleteFrom('goals').where('uri', '=', uri).execute();

        ctx.logger.info({ userDid: agent.did, uri }, 'Goal deleted');

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete goal');
        res.status(500).json({ error: 'Failed to delete goal' });
      }
    })
  );

  // GET /goals/:rkey/progress — Calculate live progress for a goal
  router.get(
    '/:rkey/progress',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const rkey = req.params.rkey as string;

      try {
        // Fetch the goal record from PDS
        const goalResponse = await agent.api.com.atproto.repo.getRecord({
          repo: agent.did!,
          collection: COLLECTION,
          rkey,
        });

        const goal = goalResponse.data.value as any;
        const uri = goalResponse.data.uri;

        // Count completions that match
        const completed = await countCompletionsForGoal(
          agent,
          agent.did!,
          goal.mediaType,
          goal.startDate,
          goal.endDate
        );

        // Update the cached count in Postgres
        await ctx.db
          .updateTable('goals')
          .set({ cachedCompletedCount: completed })
          .where('uri', '=', uri)
          .execute();

        const percentage = Math.min(
          100,
          Math.round((completed / goal.targetCount) * 100)
        );

        res.json({
          uri,
          title: goal.title,
          mediaType: goal.mediaType || null,
          target: goal.targetCount,
          completed,
          percentage,
          startDate: goal.startDate,
          endDate: goal.endDate,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to calculate goal progress');
        res.status(500).json({ error: 'Failed to calculate goal progress' });
      }
    })
  );

  // GET /goals/user/:did — Public: fetch another user's public goals
  router.get(
    '/user/:did',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userDid = req.params.did as string;

      try {
        const goals: any[] = [];
        let cursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: userDid,
            collection: COLLECTION,
            limit: 100,
            cursor,
          });

          for (const record of response.data.records) {
            const val = record.value as any;
            // Only show public goals for other users
            if (val.visibility === 'private') continue;

            goals.push({
              uri: record.uri,
              cid: record.cid,
              title: val.title,
              mediaType: val.mediaType || null,
              targetCount: val.targetCount,
              startDate: val.startDate,
              endDate: val.endDate,
              visibility: val.visibility || 'public',
              createdAt: val.createdAt,
            });
          }

          cursor = response.data.cursor;
          if (!cursor || response.data.records.length === 0) break;
        }

        // Enrich with cached progress from Postgres
        const goalUris = goals.map((g) => g.uri);
        let cachedMap = new Map<string, number>();

        if (goalUris.length > 0) {
          const cached = await ctx.db
            .selectFrom('goals')
            .select(['uri', 'cachedCompletedCount'])
            .where('uri', 'in', goalUris)
            .execute();

          for (const row of cached) {
            cachedMap.set(row.uri, row.cachedCompletedCount);
          }
        }

        const enriched = goals.map((g) => ({
          ...g,
          completedCount: cachedMap.get(g.uri) ?? 0,
          percentage: Math.min(
            100,
            Math.round(
              ((cachedMap.get(g.uri) ?? 0) / g.targetCount) * 100
            )
          ),
        }));

        enriched.sort((a, b) => {
          const now = Date.now();
          const aActive = new Date(a.endDate).getTime() >= now ? 1 : 0;
          const bActive = new Date(b.endDate).getTime() >= now ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (
            new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
          );
        });

        res.json({ goals: enriched });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch user goals');
        res.status(500).json({ error: 'Failed to fetch goals' });
      }
    })
  );

  // POST /goals/refresh — Refresh cached progress for all of the user's goals
  router.post(
    '/refresh',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      try {
        // Get all goals from PDS
        const goals: any[] = [];
        let cursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: COLLECTION,
            limit: 100,
            cursor,
          });

          for (const record of response.data.records) {
            goals.push({
              uri: record.uri,
              value: record.value as any,
            });
          }

          cursor = response.data.cursor;
          if (!cursor || response.data.records.length === 0) break;
        }

        // Get all completions once (avoids repeated PDS calls per goal)
        const completions: any[] = [];
        let compCursor: string | undefined;

        while (true) {
          const response = await agent.api.com.atproto.repo.listRecords({
            repo: agent.did!,
            collection: COMPLETION_COLLECTION,
            limit: 100,
            cursor: compCursor,
          });

          for (const record of response.data.records) {
            completions.push(record.value);
          }

          compCursor = response.data.cursor;
          if (!compCursor || response.data.records.length === 0) break;
        }

        // Calculate progress for each goal
        const updates: { uri: string; count: number }[] = [];
        for (const goal of goals) {
          const start = new Date(goal.value.startDate).getTime();
          const end = new Date(goal.value.endDate).getTime();
          const mt = goal.value.mediaType;

          let count = 0;
          for (const c of completions) {
            const cTime = new Date(c.completedAt).getTime();
            if (cTime >= start && cTime <= end) {
              if (!mt || c.mediaType === mt) {
                count++;
              }
            }
          }

          updates.push({ uri: goal.uri, count });
        }

        // Batch update Postgres
        for (const upd of updates) {
          await ctx.db
            .updateTable('goals')
            .set({ cachedCompletedCount: upd.count })
            .where('uri', '=', upd.uri)
            .execute();
        }

        ctx.logger.info(
          { userDid: agent.did, goalCount: updates.length },
          'Goal progress refreshed'
        );

        res.json({ refreshed: updates.length });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to refresh goal progress');
        res.status(500).json({ error: 'Failed to refresh goal progress' });
      }
    })
  );

  return router;
};
