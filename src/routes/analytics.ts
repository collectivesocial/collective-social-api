import express, { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sql } from 'kysely';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import { SESSION_OPTIONS, Session } from '../auth/session';

async function requireAdmin(
  req: express.Request,
  res: express.Response,
  ctx: AppContext
): Promise<boolean> {
  res.setHeader('Vary', 'Cookie');
  const session = await getIronSession<Session>(req, res, SESSION_OPTIONS);
  if (!session.did) {
    res.status(401).json({ error: 'Not authenticated' });
    return false;
  }
  const user = await ctx.db
    .selectFrom('users')
    .select(['isAdmin'])
    .where('did', '=', session.did)
    .executeTakeFirst();
  if (!user?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // GET /analytics/signups-per-week
  router.get(
    '/signups-per-week',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      if (!(await requireAdmin(req, res, ctx))) return;

      try {
        const result = await sql<{ week: string; count: string }>`
          SELECT
            date_trunc('week', "createdAt")::date AS week,
            count(*)::text AS count
          FROM users
          GROUP BY week
          ORDER BY week ASC
        `.execute(ctx.db);

        res.json({
          data: result.rows.map((r) => ({
            week: r.week,
            count: parseInt(r.count, 10),
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch signups per week');
        res.status(500).json({ error: 'Failed to fetch signups per week' });
      }
    })
  );

  // GET /analytics/weekly-active-users
  router.get(
    '/weekly-active-users',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      if (!(await requireAdmin(req, res, ctx))) return;

      try {
        const result = await sql<{ week: string; count: string }>`
          SELECT
            date_trunc('week', activity_date)::date AS week,
            count(DISTINCT did)::text AS count
          FROM user_activity_log
          GROUP BY week
          ORDER BY week ASC
        `.execute(ctx.db);

        res.json({
          data: result.rows.map((r) => ({
            week: r.week,
            count: parseInt(r.count, 10),
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch weekly active users');
        res
          .status(500)
          .json({ error: 'Failed to fetch weekly active users' });
      }
    })
  );

  // GET /analytics/items-per-user
  router.get(
    '/items-per-user',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      if (!(await requireAdmin(req, res, ctx))) return;

      try {
        const result = await sql<{
          did: string;
          handle: string | null;
          count: string;
        }>`
          SELECT
            fe."userDid" AS did,
            u.handle,
            count(*)::text AS count
          FROM feed_events fe
          LEFT JOIN users u ON u.did = fe."userDid"
          WHERE fe."eventType" IN ('item_status_change', 'item_reviewed')
          GROUP BY fe."userDid", u.handle
          ORDER BY count(*) DESC
          LIMIT 50
        `.execute(ctx.db);

        res.json({
          data: result.rows.map((r) => ({
            did: r.did,
            handle: r.handle,
            count: parseInt(r.count, 10),
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch items per user');
        res.status(500).json({ error: 'Failed to fetch items per user' });
      }
    })
  );

  // GET /analytics/bluesky-shares-per-week
  router.get(
    '/bluesky-shares-per-week',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      if (!(await requireAdmin(req, res, ctx))) return;

      try {
        const result = await sql<{ week: string; count: string }>`
          SELECT
            date_trunc('week', "createdAt")::date AS week,
            count(*)::text AS count
          FROM bluesky_share_events
          GROUP BY week
          ORDER BY week ASC
        `.execute(ctx.db);

        res.json({
          data: result.rows.map((r) => ({
            week: r.week,
            count: parseInt(r.count, 10),
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch Bluesky shares per week');
        res
          .status(500)
          .json({ error: 'Failed to fetch Bluesky shares per week' });
      }
    })
  );

  // GET /analytics/retention
  // For each sign-up week cohort: how many users had activity >= 7 days after signup
  router.get(
    '/retention',
    handler(async (req: Request, res: Response) => {
      res.setHeader('cache-control', 'no-store');
      if (!(await requireAdmin(req, res, ctx))) return;

      try {
        const result = await sql<{
          cohort_week: string;
          signups: string;
          retained: string;
          retention_pct: string;
        }>`
          SELECT
            date_trunc('week', u."createdAt")::date AS cohort_week,
            count(DISTINCT u.did)::text AS signups,
            count(DISTINCT ual.did)::text AS retained,
            CASE
              WHEN count(DISTINCT u.did) = 0 THEN '0'
              ELSE round(
                100.0 * count(DISTINCT ual.did) / count(DISTINCT u.did), 1
              )::text
            END AS retention_pct
          FROM users u
          LEFT JOIN user_activity_log ual
            ON ual.did = u.did
            AND ual.activity_date >= (u."createdAt"::date + INTERVAL '7 days')
          WHERE u."createdAt" < (CURRENT_DATE - INTERVAL '7 days')
          GROUP BY cohort_week
          ORDER BY cohort_week ASC
        `.execute(ctx.db);

        res.json({
          data: result.rows.map((r) => ({
            cohortWeek: r.cohort_week,
            signups: parseInt(r.signups, 10),
            retained: parseInt(r.retained, 10),
            retentionPct: parseFloat(r.retention_pct),
          })),
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to fetch retention data');
        res.status(500).json({ error: 'Failed to fetch retention data' });
      }
    })
  );

  return router;
};
