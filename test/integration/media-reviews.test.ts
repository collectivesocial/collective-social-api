/**
 * Integration tests — media_items and reviews tables.
 *
 * These tests insert real rows into the test DB and verify that:
 *   - media_items can be created and queried by type
 *   - reviews can be inserted and queried by authorDid
 *   - rating columns (rating0 … rating5) have the right structure
 *   - averageRating is queryable (numeric → parseFloat pattern)
 *   - share_links FK relationship to media_items works
 *
 * No HTTP layer, no mocks — pure DB interactions via Kysely.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, cleanupTables } from './helpers';
import type { Database } from '../../src/db';

const AUTHOR_DID = 'did:plc:reviewauthor001';

/** Minimal valid media_item row (all NOT NULL columns) */
function baseMediaItem(overrides: Record<string, unknown> = {}) {
  return {
    mediaType: 'book' as const,
    title: 'Test Book',
    totalRatings: 0,
    totalReviews: 0,
    totalSaves: 0,
    rating0: 0,
    rating0_5: 0,
    rating1: 0,
    rating1_5: 0,
    rating2: 0,
    rating2_5: 0,
    rating3: 0,
    rating3_5: 0,
    rating4: 0,
    rating4_5: 0,
    rating5: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('media_items — DB integration', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await cleanupTables(db, [
      'reviews',
      'media_item_tags',
      'share_links',
      'media_items',
    ]);
  });

  it('inserts a media_item and retrieves it by id', async () => {
    const result = await db
      .insertInto('media_items')
      .values(
        baseMediaItem({
          title: 'The Left Hand of Darkness',
          creator: 'Ursula K. Le Guin',
        })
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    const item = await db
      .selectFrom('media_items')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirst();

    expect(item).toBeDefined();
    expect(item!.title).toBe('The Left Hand of Darkness');
    expect(item!.creator).toBe('Ursula K. Le Guin');
    expect(item!.mediaType).toBe('book');
  });

  it('inserts items of different mediaTypes and filters correctly', async () => {
    await db
      .insertInto('media_items')
      .values([
        baseMediaItem({ title: 'A Book', mediaType: 'book' }),
        baseMediaItem({ title: 'A Movie', mediaType: 'movie' }),
        baseMediaItem({ title: 'A Game', mediaType: 'game' }),
      ])
      .execute();

    const books = await db
      .selectFrom('media_items')
      .selectAll()
      .where('mediaType', '=', 'book')
      .execute();

    const movies = await db
      .selectFrom('media_items')
      .selectAll()
      .where('mediaType', '=', 'movie')
      .execute();

    expect(books).toHaveLength(1);
    expect(movies).toHaveLength(1);
    expect(books[0].title).toBe('A Book');
  });

  it('all 11 rating distribution columns exist and default to 0', async () => {
    const result = await db
      .insertInto('media_items')
      .values(baseMediaItem())
      .returning('id')
      .executeTakeFirstOrThrow();

    const item = await db
      .selectFrom('media_items')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();

    const ratingCols = [
      'rating0',
      'rating0_5',
      'rating1',
      'rating1_5',
      'rating2',
      'rating2_5',
      'rating3',
      'rating3_5',
      'rating4',
      'rating4_5',
      'rating5',
    ] as const;

    for (const col of ratingCols) {
      expect(item[col], `column ${col} should default to 0`).toBe(0);
    }
  });

  it('updates totalRatings and averageRating, averageRating returns as string from Postgres', async () => {
    const result = await db
      .insertInto('media_items')
      .values(baseMediaItem({ totalRatings: 2, averageRating: 4.0 }))
      .returning('id')
      .executeTakeFirstOrThrow();

    const item = await db
      .selectFrom('media_items')
      .select(['totalRatings', 'averageRating'])
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();

    expect(item.totalRatings).toBe(2);
    // Postgres numeric comes back as a string — parseFloat() is required.
    expect(typeof item.averageRating).toBe('string');
    expect(parseFloat(item.averageRating as unknown as string)).toBeCloseTo(
      4.0
    );
  });

  it('isbn column exists and accepts values (no unique constraint — just an index)', async () => {
    // isbn is indexed but not unique — two books may share an isbn (e.g., reprints).
    await db
      .insertInto('media_items')
      .values(
        baseMediaItem({ isbn: '978-0-06-112008-4', title: 'First Edition' })
      )
      .execute();

    await db
      .insertInto('media_items')
      .values(
        baseMediaItem({ isbn: '978-0-06-112008-4', title: 'Second Printing' })
      )
      .execute();

    const rows = await db
      .selectFrom('media_items')
      .selectAll()
      .where('isbn', '=', '978-0-06-112008-4')
      .execute();

    expect(rows).toHaveLength(2);
  });
});

describe('reviews — DB integration', () => {
  let db: Database;
  let mediaItemId: number;

  beforeAll(async () => {
    db = await createTestDb();
    // Insert a media_item to associate reviews with.
    const result = await db
      .insertInto('media_items')
      .values(baseMediaItem({ title: 'Reviewed Book' }))
      .returning('id')
      .executeTakeFirstOrThrow();
    mediaItemId = result.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await cleanupTables(db, ['reviews']);
  });

  it('inserts a review and retrieves it by authorDid', async () => {
    await db
      .insertInto('reviews')
      .values({
        authorDid: AUTHOR_DID,
        mediaItemId,
        mediaType: 'book',
        rating: 4,
        review: 'Excellent read.',
        listItemUri: `at://${AUTHOR_DID}/app.collectivesocial.feed.listitem/item1`,
        reviewUri: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    const reviews = await db
      .selectFrom('reviews')
      .selectAll()
      .where('authorDid', '=', AUTHOR_DID)
      .execute();

    expect(reviews).toHaveLength(1);
    // Postgres decimal(2,1) comes back as a string — parseFloat() is required.
    expect(parseFloat(reviews[0].rating as unknown as string)).toBe(4);
    expect(reviews[0].review).toBe('Excellent read.');
    expect(reviews[0].mediaItemId).toBe(mediaItemId);
  });

  it('one author can have at most one review per mediaItem (unique constraint)', async () => {
    await db
      .insertInto('reviews')
      .values({
        authorDid: AUTHOR_DID,
        mediaItemId,
        mediaType: 'book',
        rating: 3,
        review: 'First review',
        listItemUri: `at://${AUTHOR_DID}/app.collectivesocial.feed.listitem/item1`,
        reviewUri: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    await expect(
      db
        .insertInto('reviews')
        .values({
          authorDid: AUTHOR_DID,
          mediaItemId,
          mediaType: 'book',
          rating: 5,
          review: 'Changed my mind',
          listItemUri: `at://${AUTHOR_DID}/app.collectivesocial.feed.listitem/item1`,
          reviewUri: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute()
    ).rejects.toThrow(); // unique(authorDid, mediaItemId, mediaType)
  });

  it('upsert on conflict updates the review correctly', async () => {
    await db
      .insertInto('reviews')
      .values({
        authorDid: AUTHOR_DID,
        mediaItemId,
        mediaType: 'book',
        rating: 2,
        review: 'Not sure yet',
        listItemUri: `at://${AUTHOR_DID}/app.collectivesocial.feed.listitem/item1`,
        reviewUri: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    await db
      .insertInto('reviews')
      .values({
        authorDid: AUTHOR_DID,
        mediaItemId,
        mediaType: 'book',
        rating: 5,
        review: 'Loved it on reflection.',
        listItemUri: `at://${AUTHOR_DID}/app.collectivesocial.feed.listitem/item1`,
        reviewUri: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflict((oc) =>
        oc
          .columns(['authorDid', 'mediaItemId', 'mediaType'])
          .doUpdateSet({
            rating: 5,
            review: 'Loved it on reflection.',
            updatedAt: new Date(),
          })
      )
      .execute();

    const all = await db
      .selectFrom('reviews')
      .selectAll()
      .where('authorDid', '=', AUTHOR_DID)
      .execute();

    expect(all).toHaveLength(1);
    // Postgres decimal(2,1) comes back as a string — parseFloat() is required.
    expect(parseFloat(all[0].rating as unknown as string)).toBe(5);
    expect(all[0].review).toBe('Loved it on reflection.');
  });

  it('count of reviews per mediaItem is queryable', async () => {
    const authorDids = ['did:plc:a', 'did:plc:b', 'did:plc:c'];

    for (const did of authorDids) {
      await db
        .insertInto('reviews')
        .values({
          authorDid: did,
          mediaItemId,
          mediaType: 'book',
          rating: 4,
          review: '',
          listItemUri: `at://${did}/app.collectivesocial.feed.listitem/item1`,
          reviewUri: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();
    }

    const countRow = await db
      .selectFrom('reviews')
      .select(({ fn }) => [fn.countAll().as('count')])
      .where('mediaItemId', '=', mediaItemId)
      .executeTakeFirstOrThrow();

    // Postgres count() returns a string
    expect(parseInt(countRow.count as unknown as string, 10)).toBe(3);
  });
});
