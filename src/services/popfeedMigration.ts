/**
 * Per-user migration of app.collectivesocial.feed.* records to
 * social.popfeed.feed.* — triggered from the /oauth/callback handler
 * (src/routes/auth.ts) right after a fresh OAuth grant is established,
 * since the migration needs write+delete scope for both namespaces.
 *
 * Safe to re-run: each collection is skipped once its old-namespace
 * collection is empty, so a failed/partial run picks up where it left off
 * on the user's next login.
 */
import { Agent } from '@atproto/api';
import type { AppContext } from '../context';
import {
  MIGRATION_ORDER,
  MigratedCollectionKey,
  NEW_NSID,
  OLD_NSID,
} from '../lexicon/collections';
import {
  AppCollectiveSocialFeedReactRecord,
  UriRemap,
  transformComment,
  transformList,
  transformListitem,
  transformReaction,
  transformReview,
} from '../lexicon/transforms';
import {
  AppCollectiveSocialFeedComment,
  AppCollectiveSocialFeedList,
  AppCollectiveSocialFeedListitem,
  AppCollectiveSocialFeedReview,
} from '../types/lexicon';

interface ListedRecord<T> {
  uri: string;
  cid: string;
  value: T;
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split('/').pop();
  if (!rkey) throw new Error(`Could not extract rkey from URI: ${uri}`);
  return rkey;
}

async function listAllRecords<T>(
  agent: Agent,
  did: string,
  collection: string
): Promise<ListedRecord<T>[]> {
  const records: ListedRecord<T>[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await agent.api.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      cursor,
    });

    records.push(...(response.data.records as unknown as ListedRecord<T>[]));

    cursor = response.data.cursor;
    if (!cursor || response.data.records.length === 0) break;
  }

  return records;
}

/** Tracks the listType chosen for each newly-migrated list, keyed by new list URI. */
type ListTypeByNewUri = Map<string, string | undefined>;

async function migrateList(
  ctx: AppContext,
  did: string,
  agent: Agent,
  uriRemap: UriRemap,
  listTypes: ListTypeByNewUri
): Promise<void> {
  const oldRecords = await listAllRecords<AppCollectiveSocialFeedList.Record>(
    agent,
    did,
    OLD_NSID.list
  );

  for (const old of oldRecords) {
    const rkey = rkeyFromUri(old.uri);
    const newValue = transformList(old.value);

    const created = await agent.api.com.atproto.repo.createRecord({
      repo: did,
      collection: NEW_NSID.list,
      rkey,
      record: newValue as unknown as Record<string, unknown>,
    });

    await agent.api.com.atproto.repo.deleteRecord({
      repo: did,
      collection: OLD_NSID.list,
      rkey,
    });

    uriRemap.set(old.uri, { uri: created.data.uri, cid: created.data.cid });
    listTypes.set(created.data.uri, newValue.listType);
  }
}

async function migrateListitem(
  ctx: AppContext,
  did: string,
  agent: Agent,
  uriRemap: UriRemap,
  listTypes: ListTypeByNewUri
): Promise<void> {
  const oldRecords =
    await listAllRecords<AppCollectiveSocialFeedListitem.Record>(
      agent,
      did,
      OLD_NSID.listitem
    );

  for (const old of oldRecords) {
    const rkey = rkeyFromUri(old.uri);
    const remappedList = uriRemap.get(old.value.list);
    const newListUri = remappedList?.uri ?? old.value.list;
    if (!remappedList) {
      ctx.logger.warn(
        { did, oldListUri: old.value.list },
        'popfeed migration: listitem references a list with no remap entry, keeping stale list reference'
      );
    }

    const newValue = await transformListitem(old.value, {
      db: ctx.db,
      newList: { uri: newListUri, listType: listTypes.get(newListUri) },
    });

    const created = await agent.api.com.atproto.repo.createRecord({
      repo: did,
      collection: NEW_NSID.listitem,
      rkey,
      record: newValue as unknown as Record<string, unknown>,
    });

    await agent.api.com.atproto.repo.deleteRecord({
      repo: did,
      collection: OLD_NSID.listitem,
      rkey,
    });

    uriRemap.set(old.uri, { uri: created.data.uri, cid: created.data.cid });
  }
}

async function migrateReview(
  ctx: AppContext,
  did: string,
  agent: Agent,
  uriRemap: UriRemap
): Promise<void> {
  const oldRecords = await listAllRecords<AppCollectiveSocialFeedReview.Record>(
    agent,
    did,
    OLD_NSID.review
  );

  for (const old of oldRecords) {
    const rkey = rkeyFromUri(old.uri);
    const newValue = await transformReview(old.value, { db: ctx.db });

    const created = await agent.api.com.atproto.repo.createRecord({
      repo: did,
      collection: NEW_NSID.review,
      rkey,
      record: newValue as unknown as Record<string, unknown>,
    });

    await agent.api.com.atproto.repo.deleteRecord({
      repo: did,
      collection: OLD_NSID.review,
      rkey,
    });

    uriRemap.set(old.uri, { uri: created.data.uri, cid: created.data.cid });

    // Update the denormalized Postgres cache row, if one exists.
    const cachedReview = await ctx.db
      .selectFrom('reviews')
      .selectAll()
      .where('reviewUri', '=', old.uri)
      .where('authorDid', '=', did)
      .executeTakeFirst();

    if (cachedReview) {
      const remappedListItemUri =
        uriRemap.get(cachedReview.listItemUri)?.uri ?? cachedReview.listItemUri;

      await ctx.db
        .updateTable('reviews')
        .set({
          reviewUri: created.data.uri,
          listItemUri: remappedListItemUri,
        })
        .where('id', '=', cachedReview.id)
        .execute();
    }
  }
}

async function migrateComment(
  ctx: AppContext,
  did: string,
  agent: Agent,
  uriRemap: UriRemap
): Promise<void> {
  const oldRecords =
    await listAllRecords<AppCollectiveSocialFeedComment.Record>(
      agent,
      did,
      OLD_NSID.comment
    );

  for (const old of oldRecords) {
    const rkey = rkeyFromUri(old.uri);
    const newValue = transformComment(old.value, { uriRemap });

    const created = await agent.api.com.atproto.repo.createRecord({
      repo: did,
      collection: NEW_NSID.comment,
      rkey,
      record: newValue as unknown as Record<string, unknown>,
    });

    await agent.api.com.atproto.repo.deleteRecord({
      repo: did,
      collection: OLD_NSID.comment,
      rkey,
    });

    uriRemap.set(old.uri, { uri: created.data.uri, cid: created.data.cid });

    const cachedComment = await ctx.db
      .selectFrom('comments')
      .selectAll()
      .where('uri', '=', old.uri)
      .where('userDid', '=', did)
      .executeTakeFirst();

    if (cachedComment) {
      const remappedReviewUri = cachedComment.reviewUri
        ? (uriRemap.get(cachedComment.reviewUri)?.uri ??
          cachedComment.reviewUri)
        : null;
      const remappedParentUri = cachedComment.parentCommentUri
        ? (uriRemap.get(cachedComment.parentCommentUri)?.uri ??
          cachedComment.parentCommentUri)
        : null;

      await ctx.db
        .updateTable('comments')
        .set({
          uri: created.data.uri,
          cid: created.data.cid,
          reviewUri: remappedReviewUri,
          parentCommentUri: remappedParentUri,
        })
        .where('id', '=', cachedComment.id)
        .execute();
    }
  }
}

async function migrateReaction(
  ctx: AppContext,
  did: string,
  agent: Agent,
  uriRemap: UriRemap
): Promise<void> {
  const oldRecords = await listAllRecords<AppCollectiveSocialFeedReactRecord>(
    agent,
    did,
    OLD_NSID.reaction
  );

  for (const old of oldRecords) {
    const rkey = rkeyFromUri(old.uri);
    const newValue = transformReaction(old.value, { uriRemap });

    const created = await agent.api.com.atproto.repo.createRecord({
      repo: did,
      collection: NEW_NSID.reaction,
      rkey,
      record: newValue as unknown as Record<string, unknown>,
    });

    await agent.api.com.atproto.repo.deleteRecord({
      repo: did,
      collection: OLD_NSID.reaction,
      rkey,
    });

    uriRemap.set(old.uri, { uri: created.data.uri, cid: created.data.cid });

    const cachedReaction = await ctx.db
      .selectFrom('reactions')
      .selectAll()
      .where('uri', '=', old.uri)
      .where('userDid', '=', did)
      .executeTakeFirst();

    if (cachedReaction) {
      const remappedSubjectUri =
        uriRemap.get(cachedReaction.subjectUri)?.uri ??
        cachedReaction.subjectUri;

      await ctx.db
        .updateTable('reactions')
        .set({
          uri: created.data.uri,
          cid: created.data.cid,
          subjectUri: remappedSubjectUri,
        })
        .where('id', '=', cachedReaction.id)
        .execute();
    }
  }
}

async function migrateCollection(
  ctx: AppContext,
  did: string,
  agent: Agent,
  key: MigratedCollectionKey,
  uriRemap: UriRemap,
  listTypes: ListTypeByNewUri
): Promise<void> {
  switch (key) {
    case 'list':
      return migrateList(ctx, did, agent, uriRemap, listTypes);
    case 'listitem':
      return migrateListitem(ctx, did, agent, uriRemap, listTypes);
    case 'review':
      return migrateReview(ctx, did, agent, uriRemap);
    case 'comment':
      return migrateComment(ctx, did, agent, uriRemap);
    case 'reaction':
      return migrateReaction(ctx, did, agent, uriRemap);
  }
}

export async function migrateUserToPopfeed(
  ctx: AppContext,
  did: string,
  agent: Agent
): Promise<void> {
  const user = await ctx.db
    .selectFrom('users')
    .select(['popfeedMigrationStatus'])
    .where('did', '=', did)
    .executeTakeFirst();

  if (user?.popfeedMigrationStatus === 'complete') return;

  await ctx.db
    .updateTable('users')
    .set({ popfeedMigrationStatus: 'in_progress' })
    .where('did', '=', did)
    .execute();

  const uriRemap: UriRemap = new Map();
  const listTypes: ListTypeByNewUri = new Map();

  try {
    for (const key of MIGRATION_ORDER) {
      await migrateCollection(ctx, did, agent, key, uriRemap, listTypes);
    }

    await ctx.db
      .updateTable('users')
      .set({
        popfeedMigrationStatus: 'complete',
        popfeedMigratedAt: new Date(),
        popfeedMigrationError: null,
      })
      .where('did', '=', did)
      .execute();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error({ err, did }, 'popfeed migration failed');
    await ctx.db
      .updateTable('users')
      .set({
        popfeedMigrationStatus: 'failed',
        popfeedMigrationError: message,
      })
      .where('did', '=', did)
      .execute();
  }
}
