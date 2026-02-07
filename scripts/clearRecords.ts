#!/usr/bin/env node
/**
 * Script to delete all app.collectivesocial.* records from a user's PDS
 * and clean up associated Postgres rows.
 *
 * Usage: npx ts-node scripts/clearRecords.ts <did>
 * Example: npx ts-node scripts/clearRecords.ts did:plc:abc123
 *
 * IMPORTANT: The user must have previously logged in via OAuth so their
 * session can be restored from the database.
 */

import { Agent } from '@atproto/api';
import { createAppContext } from '../src/context';

const COLLECTIONS = [
  'app.collectivesocial.feed.react',
  'app.collectivesocial.feed.comment',
  'app.collectivesocial.feed.reviewsegment',
  'app.collectivesocial.feed.review',
  'app.collectivesocial.feed.completion',
  'app.collectivesocial.feed.listitem',
  'app.collectivesocial.feed.useritem',
  'app.collectivesocial.feed.list',
];

async function deleteAllRecordsInCollection(
  agent: Agent,
  did: string,
  collection: string
): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  // Paginate through all records in this collection
  while (true) {
    const response = await agent.api.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      cursor,
    });

    const records = response.data.records;
    if (records.length === 0) break;

    for (const record of records) {
      const rkey = record.uri.split('/').pop();
      if (!rkey) {
        console.warn(`  ⚠ Could not extract rkey from: ${record.uri}`);
        continue;
      }

      await agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection,
        rkey,
      });

      deleted++;
      console.log(`  ✓ Deleted ${collection} rkey=${rkey}`);
    }

    cursor = response.data.cursor;
    if (!cursor) break;
  }

  return deleted;
}

async function clearPostgresData(ctx: Awaited<ReturnType<typeof createAppContext>>, did: string) {
  console.log('\n--- Cleaning Postgres data ---');

  // Delete reviews
  const reviewResult = await ctx.db
    .deleteFrom('reviews')
    .where('authorDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${reviewResult.numDeletedRows} review rows`);

  // Delete feed events
  const feedResult = await ctx.db
    .deleteFrom('feed_events')
    .where('userDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${feedResult.numDeletedRows} feed_event rows`);

  // Delete media item tags
  const tagResult = await ctx.db
    .deleteFrom('media_item_tags')
    .where('userDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${tagResult.numDeletedRows} media_item_tag rows`);

  // Delete reactions
  const reactionResult = await ctx.db
    .deleteFrom('reactions')
    .where('userDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${reactionResult.numDeletedRows} reaction rows`);

  // Delete comments
  const commentResult = await ctx.db
    .deleteFrom('comments')
    .where('userDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${commentResult.numDeletedRows} comment rows`);

  // Delete share links
  const shareResult = await ctx.db
    .deleteFrom('share_links')
    .where('userDid', '=', did)
    .executeTakeFirst();
  console.log(`  ✓ Deleted ${shareResult.numDeletedRows} share_link rows`);
}

async function main() {
  const did = process.argv[2];

  if (!did || !did.startsWith('did:')) {
    console.error('Usage: npx ts-node scripts/clearRecords.ts <did>');
    console.error('Example: npx ts-node scripts/clearRecords.ts did:plc:abc123');
    process.exit(1);
  }

  console.log(`Clearing all app.collectivesocial records for: ${did}\n`);

  const ctx = await createAppContext();

  try {
    // Restore the user's OAuth session
    const oauthSession = await ctx.oauthClient.restore(did);
    if (!oauthSession) {
      console.error(`Error: No OAuth session found for ${did}`);
      console.error('The user must have previously logged in via the web app.');
      process.exit(1);
    }

    const agent = new Agent(oauthSession);
    console.log(`Authenticated as: ${agent.did}\n`);

    // Delete all atproto records
    let totalDeleted = 0;
    for (const collection of COLLECTIONS) {
      console.log(`--- ${collection} ---`);
      const count = await deleteAllRecordsInCollection(agent, did, collection);
      totalDeleted += count;
      if (count === 0) {
        console.log('  (no records found)');
      }
    }

    console.log(`\n✓ Deleted ${totalDeleted} total atproto records`);

    // Clean up Postgres
    await clearPostgresData(ctx, did);

    console.log('\n✅ All done! PDS and database are clean.');
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await ctx.destroy();
  }
}

main();
