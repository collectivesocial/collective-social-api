import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config so we control plcUrl
vi.mock('../src/config', () => ({
  config: {
    plcUrl: 'https://plc.directory',
    openSocialApiUrl: 'http://localhost:3001',
    openSocialApiKey: 'test-api-key',
    openSocialSigningKey: '',
    openSocialKeyId: '',
    openSocialKeyAlgorithm: '',
  },
}));

// Mock opensocial to control index records returned
vi.mock('../src/services/opensocial', () => ({
  listAllCommunityRecords: vi.fn(),
}));

import { fetchGroupPosts, resolvePdsUrl } from '../src/services/groupPosts';
import * as opensocial from '../src/services/opensocial';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const COMMUNITY_DID = 'did:plc:community123';
const AUTHOR_DID = 'did:plc:author456';
const REQUESTER_DID = 'did:plc:requester789';
const SEGMENT_URI = 'at://did:plc:community123/app.collectivesocial.group.segment/abc';
const POST_RKEY = 'post-rkey-1';
const POST_URI = `at://${AUTHOR_DID}/app.collectivesocial.feed.grouppost/${POST_RKEY}`;
const AUTHOR_PDS = 'https://author.pds.example';

function makeDIDDoc(did: string, pdsEndpoint: string) {
  return {
    id: did,
    service: [
      { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pdsEndpoint },
    ],
  };
}

function makeIndexRecord(postUri: string, authorDid: string, segmentUri: string) {
  return {
    uri: `at://${COMMUNITY_DID}/app.collectivesocial.group.postindex/idx-1`,
    value: {
      post: { uri: postUri, cid: 'bafyabc' },
      authorDid,
      segmentUri,
      deletedByAdmin: false,
      createdAt: '2026-01-01T00:00:00Z',
    },
  };
}

// Stub agent (not used for fetching anymore, but still passed to the function)
const fakeAgent = { did: REQUESTER_DID, api: { com: { atproto: { repo: { getRecord: vi.fn() } } } } } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchGroupPosts', () => {
  it('non-author sees posts via direct PDS fetch', async () => {
    // Index returns one post by AUTHOR_DID
    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([
      makeIndexRecord(POST_URI, AUTHOR_DID, SEGMENT_URI),
    ]);

    // fetch call 1: DID doc for author
    // fetch call 2: getRecord from author's PDS
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeDIDDoc(AUTHOR_DID, AUTHOR_PDS) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          uri: POST_URI,
          value: { text: 'hello from author', createdAt: '2026-01-01T00:00:00Z' },
        }),
      });

    const posts = await fetchGroupPosts(fakeAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe('hello from author');
    expect(posts[0].authorDid).toBe(AUTHOR_DID);

    // Agent's getRecord should never be called
    expect(fakeAgent.api.com.atproto.repo.getRecord).not.toHaveBeenCalled();
  });

  it('author sees own posts via same direct PDS fetch path', async () => {
    const authorAgent = { did: AUTHOR_DID, api: { com: { atproto: { repo: { getRecord: vi.fn() } } } } } as any;

    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([
      makeIndexRecord(POST_URI, AUTHOR_DID, SEGMENT_URI),
    ]);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeDIDDoc(AUTHOR_DID, AUTHOR_PDS) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          uri: POST_URI,
          value: { text: 'my own post', createdAt: '2026-01-01T00:00:00Z' },
        }),
      });

    const posts = await fetchGroupPosts(authorAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe('my own post');
    expect(authorAgent.api.com.atproto.repo.getRecord).not.toHaveBeenCalled();
  });

  it('returns empty array when PDS resolution fails (PLC 404)', async () => {
    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([
      makeIndexRecord(POST_URI, AUTHOR_DID, SEGMENT_URI),
    ]);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const posts = await fetchGroupPosts(fakeAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });
    expect(posts).toEqual([]);
  });

  it('returns empty array when PDS getRecord fails (PDS 404)', async () => {
    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([
      makeIndexRecord(POST_URI, AUTHOR_DID, SEGMENT_URI),
    ]);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeDIDDoc(AUTHOR_DID, AUTHOR_PDS) })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const posts = await fetchGroupPosts(fakeAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });
    expect(posts).toEqual([]);
  });

  it('skips posts marked deletedByAdmin before any network call', async () => {
    const deletedIndex = makeIndexRecord(POST_URI, AUTHOR_DID, SEGMENT_URI);
    deletedIndex.value.deletedByAdmin = true;

    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([deletedIndex]);

    const posts = await fetchGroupPosts(fakeAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });

    expect(posts).toEqual([]);
    // No fetch calls for DID doc or PDS
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips posts with mismatched segmentUri before any network call', async () => {
    vi.mocked(opensocial.listAllCommunityRecords).mockResolvedValue([
      makeIndexRecord(POST_URI, AUTHOR_DID, 'at://different/segment/uri'),
    ]);

    const posts = await fetchGroupPosts(fakeAgent, COMMUNITY_DID, { segmentUri: SEGMENT_URI });

    expect(posts).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('resolvePdsUrl', () => {
  it('resolves did:plc via PLC directory', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDIDDoc('did:plc:test', 'https://my.pds.example'),
    });

    const url = await resolvePdsUrl('did:plc:test');
    expect(url).toBe('https://my.pds.example');
    expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:plc:test');
  });

  it('resolves did:web via .well-known', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDIDDoc('did:web:example.com', 'https://pds.example.com'),
    });

    const url = await resolvePdsUrl('did:web:example.com');
    expect(url).toBe('https://pds.example.com');
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/.well-known/did.json');
  });

  it('throws when DID document has no PDS service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'did:plc:nopds', service: [] }),
    });

    await expect(resolvePdsUrl('did:plc:nopds')).rejects.toThrow('No PDS service endpoint');
  });
});
