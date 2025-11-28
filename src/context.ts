import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { Firehose } from '@atproto/sync';
import { pino } from 'pino';

import { createOAuthClient } from './auth/client';
import { createDb, Database, migrateToLatest } from './db';
// import { createIngester } from './ingester';
import { config } from './config';
import {
  BidirectionalResolver,
  createBidirectionalResolver,
} from './id-resolver';

/**
 * Application state passed to the router and elsewhere
 */
export type AppContext = {
  db: Database;
  logger: pino.Logger;
  oauthClient: NodeOAuthClient;
  resolver: BidirectionalResolver;
  destroy: () => Promise<void>;
};

export async function createAppContext(): Promise<AppContext> {
  const db = createDb(config.databaseUrl);
  await migrateToLatest(db);
  const oauthClient = await createOAuthClient(db);
  const logger = pino({ name: 'server', level: config.logLevel });
  const resolver = createBidirectionalResolver(oauthClient);

  return {
    db,
    logger,
    oauthClient,
    resolver,

    async destroy() {
      await db.destroy();
    },
  };
}
