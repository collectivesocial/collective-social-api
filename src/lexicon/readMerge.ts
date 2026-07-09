/**
 * Read-compatibility helpers for the app.collectivesocial.feed.* ->
 * social.popfeed.feed.* migration (see src/lexicon/collections.ts and
 * src/services/popfeedMigration.ts).
 *
 * Until every user has logged in at least once post-migration, a given
 * user's records may live under either namespace: already-migrated users
 * (and popfeed-native users who've never used collectivesocial) have
 * records under social.popfeed.*; not-yet-migrated collectivesocial users
 * still have them under app.collectivesocial.*. These helpers read both so
 * routes don't need to special-case either case.
 *
 * A record only ever lives under one namespace at a time (the migration is
 * a hard cutover — copy then delete), so no de-duplication is needed beyond
 * concatenating the two result sets.
 */
import { Agent } from '@atproto/api';
import { MigratedCollectionKey, NEW_NSID, OLD_NSID } from './collections';

export interface MergedRecord {
  uri: string;
  cid: string;
  value: any;
}

async function listAll(
  agent: Agent,
  did: string,
  collection: string
): Promise<MergedRecord[]> {
  const records: MergedRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await agent.api.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      cursor,
    });

    records.push(...(response.data.records as MergedRecord[]));

    cursor = response.data.cursor;
    if (!cursor || response.data.records.length === 0) break;
  }

  return records;
}

/**
 * Lists all records for `key` across both the old and new NSID, for a given
 * user's repo. The new-namespace collection is the one expected to grow
 * over time, while the old-namespace collection only shrinks as users
 * migrate — so rather than combining two independent cursor spaces, this
 * always fetches the old collection in full and paginates only the new one.
 */
export async function listRecordsMerged(
  agent: Agent,
  did: string,
  key: MigratedCollectionKey,
  opts: { limit?: number; cursor?: string } = {}
): Promise<{ records: MergedRecord[]; cursor?: string }> {
  const [newResponse, oldRecords] = await Promise.all([
    agent.api.com.atproto.repo.listRecords({
      repo: did,
      collection: NEW_NSID[key],
      limit: opts.limit ?? 100,
      cursor: opts.cursor,
    }),
    listAll(agent, did, OLD_NSID[key]),
  ]);

  return {
    records: [...(newResponse.data.records as MergedRecord[]), ...oldRecords],
    cursor: newResponse.data.cursor,
  };
}

/**
 * Fetches a single record by rkey, trying the new NSID first and falling
 * back to the old one. The migration preserves rkeys across the rename, so
 * a caller holding an old rkey can still resolve it either way.
 */
export async function getRecordMerged(
  agent: Agent,
  did: string,
  key: MigratedCollectionKey,
  rkey: string
): Promise<MergedRecord | null> {
  try {
    const response = await agent.api.com.atproto.repo.getRecord({
      repo: did,
      collection: NEW_NSID[key],
      rkey,
    });
    return response.data as MergedRecord;
  } catch {
    // Fall through and try the old namespace.
  }

  try {
    const response = await agent.api.com.atproto.repo.getRecord({
      repo: did,
      collection: OLD_NSID[key],
      rkey,
    });
    return response.data as MergedRecord;
  } catch {
    return null;
  }
}
