import { describe, it, expect, vi } from 'vitest';
import {
  listRecordsMerged,
  getRecordMerged,
} from '../../src/lexicon/readMerge';

function makeAgent(
  responses: Record<string, { records: any[]; cursor?: string }>
) {
  const listRecords = vi.fn(async ({ collection }: { collection: string }) => ({
    data: responses[collection] ?? { records: [] },
  }));
  return {
    api: { com: { atproto: { repo: { listRecords, getRecord: vi.fn() } } } },
    _listRecords: listRecords,
  } as any;
}

describe('listRecordsMerged', () => {
  it('concatenates old and new namespace records', async () => {
    const agent = makeAgent({
      'social.popfeed.feed.list': {
        records: [{ uri: 'at://did/social.popfeed.feed.list/new1', value: {} }],
      },
      'app.collectivesocial.feed.list': {
        records: [
          { uri: 'at://did/app.collectivesocial.feed.list/old1', value: {} },
        ],
      },
    });

    const { records } = await listRecordsMerged(agent, 'did:plc:user', 'list');

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.uri)).toEqual([
      'at://did/social.popfeed.feed.list/new1',
      'at://did/app.collectivesocial.feed.list/old1',
    ]);
  });

  it('paginates the old-namespace collection in full', async () => {
    const page1 = {
      records: [
        { uri: 'at://did/app.collectivesocial.feed.list/1', value: {} },
      ],
      cursor: 'page2',
    };
    const page2 = {
      records: [
        { uri: 'at://did/app.collectivesocial.feed.list/2', value: {} },
      ],
    };

    const listRecords = vi
      .fn()
      .mockImplementationOnce(async () => ({
        data: { records: [], cursor: undefined },
      })) // new namespace: empty
      .mockImplementationOnce(async () => ({ data: page1 }))
      .mockImplementationOnce(async () => ({ data: page2 }));

    const agent = {
      api: { com: { atproto: { repo: { listRecords } } } },
    } as any;

    const { records } = await listRecordsMerged(agent, 'did:plc:user', 'list');

    expect(records).toHaveLength(2);
    expect(listRecords).toHaveBeenCalledTimes(3);
  });

  it('returns only the new-namespace cursor for the caller to continue paginating', async () => {
    const agent = makeAgent({
      'social.popfeed.feed.list': {
        records: [{ uri: 'at://did/social.popfeed.feed.list/new1', value: {} }],
        cursor: 'next-page-token',
      },
    });

    const { cursor } = await listRecordsMerged(agent, 'did:plc:user', 'list');
    expect(cursor).toBe('next-page-token');
  });
});

describe('getRecordMerged', () => {
  it('returns the new-namespace record when it exists', async () => {
    const getRecord = vi.fn().mockResolvedValueOnce({
      data: {
        uri: 'at://did/social.popfeed.feed.review/r1',
        cid: 'c1',
        value: {},
      },
    });
    const agent = {
      api: { com: { atproto: { repo: { getRecord } } } },
    } as any;

    const result = await getRecordMerged(agent, 'did:plc:user', 'review', 'r1');
    expect(result?.uri).toBe('at://did/social.popfeed.feed.review/r1');
    expect(getRecord).toHaveBeenCalledTimes(1);
  });

  it('falls back to the old namespace when the new one 404s', async () => {
    const getRecord = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({
        data: {
          uri: 'at://did/app.collectivesocial.feed.review/r1',
          cid: 'c1',
          value: {},
        },
      });
    const agent = {
      api: { com: { atproto: { repo: { getRecord } } } },
    } as any;

    const result = await getRecordMerged(agent, 'did:plc:user', 'review', 'r1');
    expect(result?.uri).toBe('at://did/app.collectivesocial.feed.review/r1');
    expect(getRecord).toHaveBeenCalledTimes(2);
  });

  it('returns null when neither namespace has the record', async () => {
    const getRecord = vi.fn().mockRejectedValue(new Error('not found'));
    const agent = {
      api: { com: { atproto: { repo: { getRecord } } } },
    } as any;

    const result = await getRecordMerged(agent, 'did:plc:user', 'review', 'r1');
    expect(result).toBeNull();
  });
});
