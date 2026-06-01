import { describe, it, expect } from 'vitest';
import { buildThreadsWithProfiles } from '../src/services/userProfiles';

const profiles = {
  'did:plc:alice': {
    did: 'did:plc:alice',
    handle: 'alice.bsky.social',
    displayName: 'Alice',
  },
  'did:plc:bob': {
    did: 'did:plc:bob',
    handle: 'bob.bsky.social',
    displayName: 'Bob',
  },
  'did:plc:carol': {
    did: 'did:plc:carol',
    handle: 'carol.bsky.social',
    displayName: 'Carol',
  },
};

describe('buildThreadsWithProfiles', () => {
  it('threads replies under their parent posts', () => {
    const posts = [
      {
        uri: 'at://did:plc:alice/post/1',
        text: 'Hello',
        authorDid: 'did:plc:alice',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        uri: 'at://did:plc:bob/post/2',
        text: 'Reply to Hello',
        authorDid: 'did:plc:bob',
        parentPostUri: 'at://did:plc:alice/post/1',
        createdAt: '2026-01-01T01:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, profiles);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello');
    expect(result[0].author.handle).toBe('alice.bsky.social');
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0].text).toBe('Reply to Hello');
    expect(result[0].replies[0].author.handle).toBe('bob.bsky.social');
  });

  it('handles deeply nested replies', () => {
    const posts = [
      {
        uri: 'at://did:plc:alice/post/1',
        text: 'Top',
        authorDid: 'did:plc:alice',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        uri: 'at://did:plc:bob/post/2',
        text: 'Reply 1',
        authorDid: 'did:plc:bob',
        parentPostUri: 'at://did:plc:alice/post/1',
        createdAt: '2026-01-01T01:00:00Z',
      },
      {
        uri: 'at://did:plc:carol/post/3',
        text: 'Reply 2',
        authorDid: 'did:plc:carol',
        parentPostUri: 'at://did:plc:bob/post/2',
        createdAt: '2026-01-01T02:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, profiles);

    expect(result).toHaveLength(1);
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0].replies).toHaveLength(1);
    expect(result[0].replies[0].replies[0].text).toBe('Reply 2');
    expect(result[0].replies[0].replies[0].author.displayName).toBe('Carol');
  });

  it('handles multiple top-level posts with their own reply trees', () => {
    const posts = [
      {
        uri: 'at://did:plc:alice/post/1',
        text: 'Post A',
        authorDid: 'did:plc:alice',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        uri: 'at://did:plc:bob/post/2',
        text: 'Post B',
        authorDid: 'did:plc:bob',
        createdAt: '2026-01-01T01:00:00Z',
      },
      {
        uri: 'at://did:plc:carol/post/3',
        text: 'Reply to A',
        authorDid: 'did:plc:carol',
        parentPostUri: 'at://did:plc:alice/post/1',
        createdAt: '2026-01-01T02:00:00Z',
      },
      {
        uri: 'at://did:plc:alice/post/4',
        text: 'Reply to B',
        authorDid: 'did:plc:alice',
        parentPostUri: 'at://did:plc:bob/post/2',
        createdAt: '2026-01-01T03:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, profiles);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Post A');
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0].text).toBe('Reply to A');
    expect(result[1].text).toBe('Post B');
    expect(result[1].replies).toHaveLength(1);
    expect(result[1].replies[0].text).toBe('Reply to B');
  });

  it('returns empty array for empty input', () => {
    const result = buildThreadsWithProfiles([], profiles);
    expect(result).toEqual([]);
  });

  it('handles posts with no replies', () => {
    const posts = [
      {
        uri: 'at://did:plc:alice/post/1',
        text: 'Standalone',
        authorDid: 'did:plc:alice',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, profiles);

    expect(result).toHaveLength(1);
    expect(result[0].replies).toEqual([]);
  });

  it('provides fallback author for unknown DIDs', () => {
    const posts = [
      {
        uri: 'at://did:plc:unknown/post/1',
        text: 'Mystery',
        authorDid: 'did:plc:unknown',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, {});

    expect(result).toHaveLength(1);
    expect(result[0].author.did).toBe('did:plc:unknown');
    expect(result[0].author.handle).toContain('…');
  });

  it('sorts posts chronologically', () => {
    const posts = [
      {
        uri: 'at://did:plc:bob/post/2',
        text: 'Second',
        authorDid: 'did:plc:bob',
        createdAt: '2026-01-02T00:00:00Z',
      },
      {
        uri: 'at://did:plc:alice/post/1',
        text: 'First',
        authorDid: 'did:plc:alice',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const result = buildThreadsWithProfiles(posts, profiles);

    expect(result[0].text).toBe('First');
    expect(result[1].text).toBe('Second');
  });
});
