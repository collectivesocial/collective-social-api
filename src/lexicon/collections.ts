/**
 * NSID constants for the lexicons being migrated from app.collectivesocial.*
 * to social.popfeed.* (see docs/superpowers/specs — popfeed lexicon migration).
 *
 * Both maps share the same keys so a collection key (e.g. "list") can be used
 * to look up either its old or new NSID from the same call site.
 */

export const MIGRATED_COLLECTIONS = [
  'list',
  'listitem',
  'comment',
  'reaction',
  'review',
] as const;

export type MigratedCollectionKey = (typeof MIGRATED_COLLECTIONS)[number];

export const OLD_NSID: Record<MigratedCollectionKey, string> = {
  list: 'app.collectivesocial.feed.list',
  listitem: 'app.collectivesocial.feed.listitem',
  comment: 'app.collectivesocial.feed.comment',
  reaction: 'app.collectivesocial.feed.react',
  review: 'app.collectivesocial.feed.review',
};

export const NEW_NSID: Record<MigratedCollectionKey, string> = {
  list: 'social.popfeed.feed.list',
  listitem: 'social.popfeed.feed.listitem',
  comment: 'social.popfeed.feed.comment',
  reaction: 'social.popfeed.feed.reaction',
  review: 'social.popfeed.feed.review',
};

/**
 * Order matters: later collections in this list reference earlier ones
 * (comment -> review, reaction -> review|comment), so migrating in this
 * order lets cross-reference rewriting use already-migrated URIs.
 */
export const MIGRATION_ORDER: MigratedCollectionKey[] = [
  'list',
  'listitem',
  'review',
  'comment',
  'reaction',
];

/** Extracts the collection NSID segment from an AT-URI (at://did/collection/rkey). */
export function collectionFromUri(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 2];
}

/**
 * Normalizes a social.popfeed.feed.listitem or app.collectivesocial.feed.listitem
 * record value to a shape that reads the same regardless of which namespace it
 * came from — for use with records returned by listRecordsMerged/getRecordMerged.
 */
export function normalizeListitemValue(value: any) {
  return {
    ...value,
    list: value.list ?? value.listUri,
    listUri: value.listUri ?? value.list,
    creator: value.creator ?? value.mainCredit,
    mainCredit: value.mainCredit ?? value.creator,
    mediaType: value.mediaType ?? value.creativeWorkType,
    creativeWorkType: value.creativeWorkType ?? value.mediaType,
    createdAt: value.createdAt ?? value.addedAt,
    addedAt: value.addedAt ?? value.createdAt,
  };
}
