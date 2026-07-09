import express from 'express';
import { AppContext } from '../context';
import { getIronSession } from 'iron-session';
import { Agent } from '@atproto/api';
import { SESSION_OPTIONS, Session } from './session';

/**
 * Get the authenticated ATProto agent for the current session.
 * Returns null if the user is not logged in or session is invalid.
 */
export async function getSessionAgent(
  req: express.Request,
  res: express.Response,
  ctx: AppContext
) {
  res.setHeader('Vary', 'Cookie');

  const session = await getIronSession<Session>(req, res, SESSION_OPTIONS);
  if (!session.did) return null;

  res.setHeader('cache-control', 'private, no-store');

  try {
    // A restored session's OAuth grant reflects whatever scope was in effect
    // at the time the user last authorized this app. Users who haven't
    // completed the popfeed migration yet (see src/services/popfeedMigration.ts)
    // may be carrying a token scoped under the pre-migration collection set,
    // so force them through a fresh /login rather than silently proceeding.
    const user = await ctx.db
      .selectFrom('users')
      .select(['popfeedMigrationStatus'])
      .where('did', '=', session.did)
      .executeTakeFirst();

    if (user && user.popfeedMigrationStatus !== 'complete') {
      ctx.logger.info(
        { did: session.did },
        'destroying session pending popfeed migration re-auth'
      );
      await session.destroy();
      return null;
    }

    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth session restore failed');
    await session.destroy();
    return null;
  }
}
