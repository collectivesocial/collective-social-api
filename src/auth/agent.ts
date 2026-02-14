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
    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth session restore failed');
    await session.destroy();
    return null;
  }
}
