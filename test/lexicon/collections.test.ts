import { describe, it, expect } from 'vitest';
import {
  collectionFromUri,
  normalizeListitemValue,
  OLD_NSID,
  NEW_NSID,
  MIGRATION_ORDER,
} from '../../src/lexicon/collections';

describe('collectionFromUri', () => {
  it('extracts the collection segment from an AT-URI', () => {
    expect(
      collectionFromUri('at://did:plc:abc123/social.popfeed.feed.list/xyz')
    ).toBe('social.popfeed.feed.list');
    expect(
      collectionFromUri(
        'at://did:plc:abc123/app.collectivesocial.feed.listitem/xyz'
      )
    ).toBe('app.collectivesocial.feed.listitem');
  });
});

describe('normalizeListitemValue', () => {
  it('reads new-shape fields directly and mirrors them to old-shape names', () => {
    const normalized = normalizeListitemValue({
      listUri: 'at://did/social.popfeed.feed.list/1',
      mainCredit: 'Martha Wells',
      creativeWorkType: 'book',
      addedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.listUri).toBe('at://did/social.popfeed.feed.list/1');
    expect(normalized.list).toBe('at://did/social.popfeed.feed.list/1');
    expect(normalized.creator).toBe('Martha Wells');
    expect(normalized.mediaType).toBe('book');
    expect(normalized.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reads old-shape fields directly and mirrors them to new-shape names', () => {
    const normalized = normalizeListitemValue({
      list: 'at://did/app.collectivesocial.feed.list/1',
      creator: 'Doug Liman',
      mediaType: 'movie',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.list).toBe('at://did/app.collectivesocial.feed.list/1');
    expect(normalized.listUri).toBe(
      'at://did/app.collectivesocial.feed.list/1'
    );
    expect(normalized.mainCredit).toBe('Doug Liman');
    expect(normalized.creativeWorkType).toBe('movie');
    expect(normalized.addedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('NSID maps', () => {
  it('share the same keys between OLD_NSID and NEW_NSID', () => {
    expect(Object.keys(OLD_NSID).sort()).toEqual(Object.keys(NEW_NSID).sort());
  });

  it('migrates list and listitem before review, comment, and reaction', () => {
    expect(MIGRATION_ORDER.indexOf('list')).toBeLessThan(
      MIGRATION_ORDER.indexOf('review')
    );
    expect(MIGRATION_ORDER.indexOf('listitem')).toBeLessThan(
      MIGRATION_ORDER.indexOf('review')
    );
    expect(MIGRATION_ORDER.indexOf('review')).toBeLessThan(
      MIGRATION_ORDER.indexOf('comment')
    );
    expect(MIGRATION_ORDER.indexOf('comment')).toBeLessThan(
      MIGRATION_ORDER.indexOf('reaction')
    );
  });
});
