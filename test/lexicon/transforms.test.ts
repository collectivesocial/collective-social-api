import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/openlibrary', () => ({
  getBookByISBN: vi.fn(),
}));

vi.mock('../../src/services/omdb', () => ({
  getOMDBDetails: vi.fn(),
}));

import {
  transformList,
  transformListitem,
  transformReview,
  transformComment,
  transformReaction,
  UriRemap,
} from '../../src/lexicon/transforms';
import { getBookByISBN } from '../../src/services/openlibrary';
import { getOMDBDetails } from '../../src/services/omdb';

const mockGetBookByISBN = vi.mocked(getBookByISBN);
const mockGetOMDBDetails = vi.mocked(getOMDBDetails);

function makeDb(mediaItemRow: any) {
  return {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({
          executeTakeFirst: async () => mediaItemRow,
        }),
      }),
    }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transformList', () => {
  it('marks the default list as inbox and preserves additive fields', () => {
    const result = transformList({
      $type: 'app.collectivesocial.feed.list',
      name: 'Inbox',
      description: 'Default list',
      visibility: 'public',
      isDefault: true,
      purpose: 'app.collectivesocial.defs#curatelist',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as any);

    expect(result.$type).toBe('social.popfeed.feed.list');
    expect(result.listType).toBe('inbox');
    expect(result.tags).toEqual([]);
    expect(result.ordered).toBe(false);
    expect(result.isDefault).toBe(true);
    expect(result.name).toBe('Inbox');
  });

  it('marks a non-default list as custom', () => {
    const result = transformList({
      $type: 'app.collectivesocial.feed.list',
      name: 'Want to Read',
      isDefault: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as any);

    expect(result.listType).toBe('custom');
  });
});

describe('transformListitem', () => {
  it('renames fields and omits bookProgress/backdropUrl (out of scope)', async () => {
    mockGetOMDBDetails.mockResolvedValue(null);
    const db = makeDb(undefined);

    const result = await transformListitem(
      {
        $type: 'app.collectivesocial.feed.listitem',
        list: 'at://did:plc:user/app.collectivesocial.feed.list/abc',
        title: 'All Systems Red',
        creator: 'Martha Wells',
        mediaType: 'book',
        order: 3,
        userItem: 'at://did:plc:user/app.collectivesocial.feed.useritem/xyz',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        db,
        newList: {
          uri: 'at://did:plc:user/social.popfeed.feed.list/new123',
          listType: 'to_read_books',
        },
      }
    );

    expect(result.$type).toBe('social.popfeed.feed.listitem');
    expect(result.listUri).toBe(
      'at://did:plc:user/social.popfeed.feed.list/new123'
    );
    expect(result.mainCredit).toBe('Martha Wells');
    expect(result.creativeWorkType).toBe('book');
    expect(result.listType).toBe('to_read_books');
    expect(result.order).toBe(3);
    expect(result.userItem).toBe(
      'at://did:plc:user/app.collectivesocial.feed.useritem/xyz'
    );
    expect(result.addedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.bookProgress).toBeUndefined();
    expect(result.backdropUrl).toBeUndefined();
  });

  it('enriches from media_items and OMDB when available', async () => {
    mockGetOMDBDetails.mockResolvedValue({
      Title: 'The Bourne Identity',
      Genre: 'Action, Drama, Mystery',
      Released: '14 Jun 2002',
      Response: 'True',
    } as any);

    const db = makeDb({
      mediaType: 'movie',
      title: 'The Bourne Identity',
      creator: 'Doug Liman',
      isbn: undefined,
      externalId: 'tt0258463',
      coverImage: 'https://example.com/poster.jpg',
      publishedYear: 2002,
    });

    const result = await transformListitem(
      {
        $type: 'app.collectivesocial.feed.listitem',
        list: 'at://did:plc:user/app.collectivesocial.feed.list/abc',
        title: 'The Bourne Identity',
        mediaItemId: 42,
        mediaType: 'movie',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { db, newList: { uri: 'at://did:plc:user/social.popfeed.feed.list/x' } }
    );

    expect(result.mainCredit).toBe('Doug Liman');
    expect(result.genres).toEqual(['Action', 'Drama', 'Mystery']);
    expect(result.identifiers?.imdbId).toBe('tt0258463');
    expect(result.posterUrl).toBe('https://example.com/poster.jpg');
    expect(mockGetBookByISBN).not.toHaveBeenCalled();
  });
});

describe('transformReview', () => {
  it('converts the 0-5 half-step rating to a 0-10 integer scale', async () => {
    const db = makeDb(undefined);

    const result = await transformReview(
      {
        $type: 'app.collectivesocial.feed.review',
        title: 'Great read',
        text: 'Loved it',
        rating: 4.5,
        notes: 'private thoughts',
        listItem: 'at://did:plc:user/app.collectivesocial.feed.useritem/xyz',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { db }
    );

    expect(result.rating).toBe(9);
    expect(result.notes).toBe('private thoughts');
    expect(result.listItem).toBe(
      'at://did:plc:user/app.collectivesocial.feed.useritem/xyz'
    );
    expect(result.isRevisit).toBe(false);
    expect(result.containsSpoilers).toBe(false);
  });

  it('leaves rating undefined when the source review had none', async () => {
    const db = makeDb(undefined);
    const result = await transformReview(
      {
        $type: 'app.collectivesocial.feed.review',
        text: 'No rating given',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { db }
    );

    expect(result.rating).toBeUndefined();
  });
});

describe('transformComment / transformReaction cross-reference remap', () => {
  it('rewrites reviewRef to the migrated review URI/CID', () => {
    const uriRemap: UriRemap = new Map([
      [
        'at://did:plc:user/app.collectivesocial.feed.review/old1',
        {
          uri: 'at://did:plc:user/social.popfeed.feed.review/old1',
          cid: 'newcid',
        },
      ],
    ]);

    const result = transformComment(
      {
        $type: 'app.collectivesocial.feed.comment',
        text: 'nice review',
        reviewRef: {
          uri: 'at://did:plc:user/app.collectivesocial.feed.review/old1',
          cid: 'oldcid',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { uriRemap }
    );

    expect(result.reviewRef).toEqual({
      uri: 'at://did:plc:user/social.popfeed.feed.review/old1',
      cid: 'newcid',
    });
  });

  it('keeps the stale reference and does not throw when no remap entry exists', () => {
    const uriRemap: UriRemap = new Map();
    const result = transformComment(
      {
        $type: 'app.collectivesocial.feed.comment',
        text: 'orphaned reply',
        parentCommentRef: {
          uri: 'at://did:plc:user/app.collectivesocial.feed.comment/missing',
          cid: 'oldcid',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { uriRemap }
    );

    expect(result.parentCommentRef).toEqual({
      uri: 'at://did:plc:user/app.collectivesocial.feed.comment/missing',
      cid: 'oldcid',
    });
  });

  it('preserves the commentRef vs reviewRef sub-type on reactions', () => {
    const uriRemap: UriRemap = new Map([
      [
        'at://did:plc:user/app.collectivesocial.feed.comment/c1',
        {
          uri: 'at://did:plc:user/social.popfeed.feed.comment/c1',
          cid: 'newcid',
        },
      ],
    ]);

    const result = transformReaction(
      {
        $type: 'app.collectivesocial.feed.react',
        emoji: 'heart',
        subject: {
          $type: 'app.collectivesocial.feed.react#commentRef',
          uri: 'at://did:plc:user/app.collectivesocial.feed.comment/c1',
          cid: 'oldcid',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { uriRemap }
    );

    expect(result.subject.$type).toBe(
      'social.popfeed.feed.reaction#commentRef'
    );
    expect(result.subject.uri).toBe(
      'at://did:plc:user/social.popfeed.feed.comment/c1'
    );
    expect(result.subject.cid).toBe('newcid');
  });
});
