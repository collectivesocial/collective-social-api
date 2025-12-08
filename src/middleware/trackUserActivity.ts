import { Request, Response, NextFunction } from 'express';
import { getIronSession } from 'iron-session';
import { config } from '../config';
import type { AppContext } from '../context';

type Session = { did?: string };

/**
 * Middleware to track user activity
 * - Creates user record on first login
 * - Updates lastActivityAt on every authenticated request
 * - Generally keeps an eye on the number of users using the app and how often its used
 */
export function createUserActivityTracker(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      // Only track activity for authenticated users
      if (session.did) {
        const now = new Date();

        // Check if user exists
        const existingUser = await ctx.db
          .selectFrom('users')
          .select(['did', 'firstLoginAt'])
          .where('did', '=', session.did)
          .executeTakeFirst();

        if (!existingUser) {
          // First login - get user profile and create user record
          try {
            const oauthSession = await ctx.oauthClient.restore(session.did);
            if (oauthSession) {
              const { Agent } = await import('@atproto/api');
              const agent = new Agent(oauthSession);

              // Get user profile
              const profile = await agent.getProfile({ actor: session.did });
              const userHandle = profile.data.handle;
              const displayName = profile.data.displayName || null;
              const avatar = profile.data.avatar || null;

              // Create user record with profile info
              await ctx.db
                .insertInto('users')
                .values({
                  did: session.did,
                  handle: userHandle,
                  displayName: displayName,
                  avatar: avatar,
                  firstLoginAt: now,
                  lastActivityAt: now,
                  createdAt: now,
                  updatedAt: now,
                } as any)
                .onConflict((oc) =>
                  oc.column('did').doUpdateSet({
                    handle: userHandle,
                    displayName: displayName,
                    avatar: avatar,
                    lastActivityAt: now,
                    updatedAt: now,
                  })
                )
                .execute();

              const defaultListRecord = {
                $type: 'app.collectivesocial.feed.list',
                name: 'Inbox',
                description:
                  'Your default inbox for recommendations and items to review',
                visibility: 'public',
                isDefault: true,
                purpose: 'app.collectivesocial.defs#curatelist',
                createdAt: now.toISOString(),
              };

              await agent.api.com.atproto.repo.createRecord({
                repo: session.did,
                collection: 'app.collectivesocial.feed.list',
                record: defaultListRecord as any,
              });

              ctx.logger.info(
                { did: session.did },
                'Created default Inbox list for new user'
              );

              // Create feed event for new user joining
              await ctx.db
                .insertInto('feed_events')
                .values({
                  eventName: `${userHandle} joined Collective!`,
                  mediaLink: null,
                  userDid: session.did,
                  createdAt: now,
                } as any)
                .execute();

              ctx.logger.info(
                { did: session.did, handle: userHandle },
                'Created feed event for new user'
              );
            }
          } catch (err) {
            ctx.logger.error(
              { err, did: session.did },
              'Failed to create default Inbox list or feed event'
            );
          }

          ctx.logger.info(
            { did: session.did },
            'New user first login recorded'
          );
        } else {
          // Update last activity and refresh profile occasionally
          const shouldRefreshProfile =
            !existingUser.firstLoginAt ||
            now.getTime() - existingUser.firstLoginAt.getTime() >
              24 * 60 * 60 * 1000; // 24 hours

          if (shouldRefreshProfile) {
            try {
              const oauthSession = await ctx.oauthClient.restore(session.did);
              if (oauthSession) {
                const { Agent } = await import('@atproto/api');
                const agent = new Agent(oauthSession);
                const profile = await agent.getProfile({ actor: session.did });

                await ctx.db
                  .updateTable('users')
                  .set({
                    handle: profile.data.handle,
                    displayName: profile.data.displayName || null,
                    avatar: profile.data.avatar || null,
                    lastActivityAt: now,
                    updatedAt: now,
                  })
                  .where('did', '=', session.did)
                  .execute();
              }
            } catch (err) {
              // If profile refresh fails, just update activity
              await ctx.db
                .updateTable('users')
                .set({
                  lastActivityAt: now,
                  updatedAt: now,
                })
                .where('did', '=', session.did)
                .execute();
            }
          } else {
            // Just update last activity
            await ctx.db
              .updateTable('users')
              .set({
                lastActivityAt: now,
                updatedAt: now,
              })
              .where('did', '=', session.did)
              .execute();
          }
        }
      }
    } catch (err) {
      // Log error but don't block the request
      ctx.logger.error({ err }, 'Failed to track user activity');
    }

    next();
  };
}
