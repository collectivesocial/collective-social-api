/**
 * Transform functions from the old app.collectivesocial.feed.* record shapes
 * to the new social.popfeed.feed.* shapes, used by the login-time migration
 * (see src/services/popfeedMigration.ts).
 *
 * Enrichment (genres, precise release dates, ids) is best-effort: any lookup
 * failure or missing data is swallowed and the field is simply omitted. A
 * migration must never fail because a third-party metadata lookup failed.
 */
import type { Selectable } from 'kysely';
import type { Database } from '../db';
import type { MediaItem } from '../models/media';
import {
  AppCollectiveSocialFeedComment,
  AppCollectiveSocialFeedList,
  AppCollectiveSocialFeedListitem,
  AppCollectiveSocialFeedReview,
  SocialPopfeedFeedComment,
  SocialPopfeedFeedList,
  SocialPopfeedFeedListitem,
  SocialPopfeedFeedReaction,
  SocialPopfeedFeedReview,
} from '../types/lexicon';
import { getBookByISBN } from '../services/openlibrary';
import { getOMDBDetails } from '../services/omdb';

type MediaItemRow = Selectable<MediaItem>;

/** Old-style emoji reaction record shape (never had a hand-written type). */
export interface AppCollectiveSocialFeedReactRecord {
  $type?: 'app.collectivesocial.feed.react';
  emoji: SocialPopfeedFeedReaction.Record['emoji'];
  subject: {
    $type?: string;
    uri: string;
    cid: string;
  };
  createdAt: string;
}

/** A strongRef remap entry: old record URI -> where/what it became. */
export interface UriRemapEntry {
  uri: string;
  cid: string;
}

export type UriRemap = Map<string, UriRemapEntry>;

function isbnKind(isbn: string): 'isbn10' | 'isbn13' {
  const digits = isbn.replace(/[^0-9Xx]/g, '');
  return digits.length === 13 ? 'isbn13' : 'isbn10';
}

function yearToIsoDate(year?: number): string | undefined {
  if (!year) return undefined;
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

function inferMainCreditRole(mediaType?: string): string | undefined {
  switch (mediaType) {
    case 'book':
      return 'author';
    case 'movie':
    case 'tv':
      return 'director';
    case 'podcast':
      return 'host';
    default:
      return undefined;
  }
}

async function fetchMediaItem(
  db: Database,
  mediaItemId?: number
): Promise<MediaItemRow | undefined> {
  if (!mediaItemId) return undefined;
  const row = await db
    .selectFrom('media_items')
    .selectAll()
    .where('id', '=', mediaItemId)
    .executeTakeFirst();
  return row ?? undefined;
}

/** Best-effort enrichment shared by listitem and review transforms. */
async function enrichFromMediaItem(mediaItem?: MediaItemRow): Promise<{
  genres?: string[];
  releaseDate?: string;
  identifiers?: SocialPopfeedFeedListitem.Identifiers;
  posterUrl?: string;
  mainCredit?: string;
  mainCreditRole?: string;
  creativeWorkType?: string;
}> {
  if (!mediaItem) return {};

  const identifiers: SocialPopfeedFeedListitem.Identifiers = {};
  if (mediaItem.isbn) {
    identifiers[isbnKind(mediaItem.isbn)] = mediaItem.isbn;
  }
  if (mediaItem.mediaType === 'movie' || mediaItem.mediaType === 'tv') {
    if (mediaItem.externalId) identifiers.imdbId = mediaItem.externalId;
  }

  const base = {
    posterUrl: mediaItem.coverImage,
    mainCredit: mediaItem.creator,
    mainCreditRole: inferMainCreditRole(mediaItem.mediaType),
    creativeWorkType: mediaItem.mediaType,
    releaseDate: yearToIsoDate(mediaItem.publishedYear),
    identifiers: Object.keys(identifiers).length > 0 ? identifiers : undefined,
  };

  try {
    if (mediaItem.mediaType === 'book' && mediaItem.isbn) {
      const book = await getBookByISBN(mediaItem.isbn);
      // OpenLibrary's book response doesn't model subjects/genres in our
      // local OpenLibraryBook type, so genres stay unfilled for books.
      if (book?.publish_date) {
        const published = new Date(book.publish_date);
        if (!isNaN(published.getTime())) {
          return { ...base, releaseDate: published.toISOString() };
        }
      }
    } else if (
      (mediaItem.mediaType === 'movie' || mediaItem.mediaType === 'tv') &&
      mediaItem.externalId
    ) {
      const details = await getOMDBDetails(mediaItem.externalId);
      if (details) {
        const genres = details.Genre
          ? details.Genre.split(',')
              .map((g) => g.trim())
              .filter(Boolean)
          : undefined;
        const released = details.Released
          ? new Date(details.Released)
          : undefined;
        return {
          ...base,
          genres,
          releaseDate:
            released && !isNaN(released.getTime())
              ? released.toISOString()
              : base.releaseDate,
        };
      }
    }
  } catch (err) {
    // Enrichment is best-effort; never block migration on a lookup failure.
    console.error('popfeed migration: metadata enrichment failed', err);
  }

  return base;
}

export function transformList(
  old: AppCollectiveSocialFeedList.Record
): SocialPopfeedFeedList.Record {
  return {
    $type: 'social.popfeed.feed.list',
    name: old.name,
    description: old.description,
    tags: [],
    ordered: false,
    listType: old.isDefault ? 'inbox' : 'custom',
    visibility: old.visibility,
    isDefault: old.isDefault,
    parentListUri: old.parentListUri,
    avatar: old.avatar,
    createdAt: old.createdAt,
  };
}

export async function transformListitem(
  old: AppCollectiveSocialFeedListitem.Record,
  ctx: {
    db: Database;
    newList: { uri: string; listType?: string };
  }
): Promise<SocialPopfeedFeedListitem.Record> {
  const mediaItem = await fetchMediaItem(ctx.db, old.mediaItemId);
  const enriched = await enrichFromMediaItem(mediaItem);

  return {
    $type: 'social.popfeed.feed.listitem',
    listUri: ctx.newList.uri,
    title: old.title,
    mainCredit: enriched.mainCredit ?? old.creator,
    mainCreditRole: enriched.mainCreditRole,
    creativeWorkType: (enriched.creativeWorkType ??
      old.mediaType) as SocialPopfeedFeedListitem.Record['creativeWorkType'],
    genres: enriched.genres,
    listType: ctx.newList.listType,
    posterUrl: enriched.posterUrl,
    backdropUrl: undefined, // not available from media_items/OMDB/OpenLibrary
    identifiers: enriched.identifiers,
    releaseDate: enriched.releaseDate,
    bookProgress: undefined, // requires feed.useritem/feed.completion, out of scope
    mediaItemId: old.mediaItemId,
    order: old.order,
    userItem: old.userItem,
    addedAt: old.createdAt,
  };
}

export async function transformReview(
  old: AppCollectiveSocialFeedReview.Record,
  ctx: { db: Database }
): Promise<SocialPopfeedFeedReview.Record> {
  const mediaItem = await fetchMediaItem(ctx.db, old.mediaItemId);
  const enriched = await enrichFromMediaItem(mediaItem);

  return {
    $type: 'social.popfeed.feed.review',
    title: old.title,
    text: old.text,
    facets: [],
    tags: [],
    rating: old.rating !== undefined ? Math.round(old.rating * 2) : undefined,
    genres: enriched.genres,
    isRevisit: false,
    containsSpoilers: false,
    mainCredit: enriched.mainCredit,
    mainCreditRole: enriched.mainCreditRole,
    creativeWorkType: (enriched.creativeWorkType ??
      old.mediaType) as SocialPopfeedFeedReview.Record['creativeWorkType'],
    posterUrl: enriched.posterUrl,
    backdropUrl: undefined,
    identifiers: enriched.identifiers,
    releaseDate: enriched.releaseDate,
    notes: old.notes,
    listItem: old.listItem,
    mediaItemId: old.mediaItemId,
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };
}

function remapStrongRef(
  ref: { uri: string; cid: string } | undefined,
  uriRemap: UriRemap
): { uri: string; cid: string } | undefined {
  if (!ref) return undefined;
  const remapped = uriRemap.get(ref.uri);
  if (!remapped) {
    console.error(
      'popfeed migration: no remap entry for referenced record, keeping stale reference',
      { uri: ref.uri }
    );
    return ref;
  }
  return remapped;
}

export function transformComment(
  old: AppCollectiveSocialFeedComment.Record,
  ctx: { uriRemap: UriRemap }
): SocialPopfeedFeedComment.Record {
  return {
    $type: 'social.popfeed.feed.comment',
    text: old.text,
    reviewRef: remapStrongRef(old.reviewRef, ctx.uriRemap),
    parentCommentRef: remapStrongRef(old.parentCommentRef, ctx.uriRemap),
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };
}

export function transformReaction(
  old: AppCollectiveSocialFeedReactRecord,
  ctx: { uriRemap: UriRemap }
): SocialPopfeedFeedReaction.Record {
  const remapped = remapStrongRef(old.subject, ctx.uriRemap);
  const isCommentRef = old.subject.$type?.endsWith('#commentRef');

  return {
    $type: 'social.popfeed.feed.reaction',
    emoji: old.emoji,
    subject: {
      $type: isCommentRef
        ? 'social.popfeed.feed.reaction#commentRef'
        : 'social.popfeed.feed.reaction#reviewRef',
      uri: remapped?.uri ?? old.subject.uri,
      cid: remapped?.cid ?? old.subject.cid,
    } as SocialPopfeedFeedReaction.Record['subject'],
    createdAt: old.createdAt,
  };
}
