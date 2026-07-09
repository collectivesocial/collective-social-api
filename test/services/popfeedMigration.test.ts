import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/openlibrary', () => ({
  getBookByISBN: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/omdb', () => ({
  getOMDBDetails: vi.fn().mockResolvedValue(null),
}));

import { migrateUserToPopfeed } from '../../src/services/popfeedMigration';

const DID = 'did:plc:user1';

/** Minimal fake Kysely-like query builder covering exactly what popfeedMigration.ts calls. */
function makeFakeDb({
  userRow,
  reviewRow,
}: {
  userRow: { popfeedMigrationStatus: string } | undefined;
  reviewRow?: any;
}) {
  const updateCalls: Array<{ table: string; values: any; where: any }> = [];

  const db = {
    selectFrom(table: string) {
      return {
        select: () => ({
          where: () => ({
            executeTakeFirst: async () =>
              table === 'users' ? userRow : undefined,
          }),
        }),
        selectAll: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () =>
                table === 'reviews' ? reviewRow : undefined,
            }),
          }),
          where2: undefined,
        }),
      };
    },
    updateTable(table: string) {
      const builder = {
        set: (values: any) => {
          const whereClauses: any[] = [];
          const chain = {
            where: (...args: any[]) => {
              whereClauses.push(args);
              return chain;
            },
            execute: async () => {
              updateCalls.push({ table, values, where: whereClauses });
              return { numUpdatedRows: 1n };
            },
          };
          return chain;
        },
      };
      return builder;
    },
  };

  return { db: db as any, updateCalls };
}

function makeAgent(recordsByCollection: Record<string, any[]>) {
  const created: Array<{ collection: string; record: any; rkey?: string }> = [];
  const deleted: Array<{ collection: string; rkey: string }> = [];

  const listRecords = vi.fn(async ({ collection }: { collection: string }) => ({
    data: { records: recordsByCollection[collection] ?? [], cursor: undefined },
  }));

  const createRecord = vi.fn(async ({ collection, record, rkey }: any) => {
    created.push({ collection, record, rkey });
    return {
      data: {
        uri: `at://${DID}/${collection}/${rkey ?? 'newkey'}`,
        cid: 'newcid',
      },
    };
  });

  const deleteRecord = vi.fn(async ({ collection, rkey }: any) => {
    deleted.push({ collection, rkey });
  });

  return {
    agent: {
      did: DID,
      api: {
        com: { atproto: { repo: { listRecords, createRecord, deleteRecord } } },
      },
    } as any,
    created,
    deleted,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrateUserToPopfeed', () => {
  it('skips entirely when the user is already marked complete', async () => {
    const { db, updateCalls } = makeFakeDb({
      userRow: { popfeedMigrationStatus: 'complete' },
    });
    const { agent } = makeAgent({});
    const ctx = {
      db,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as any;

    await migrateUserToPopfeed(ctx, DID, agent);

    expect(updateCalls).toHaveLength(0);
    expect(agent.api.com.atproto.repo.listRecords).not.toHaveBeenCalled();
  });

  it('completes successfully for a brand-new user with no legacy records', async () => {
    const { db, updateCalls } = makeFakeDb({ userRow: undefined });
    const { agent, created, deleted } = makeAgent({});
    const ctx = {
      db,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as any;

    await migrateUserToPopfeed(ctx, DID, agent);

    expect(created).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const statuses = updateCalls
      .filter((c) => c.table === 'users')
      .map((c) => c.values.popfeedMigrationStatus);
    expect(statuses).toEqual(['in_progress', 'complete']);
  });

  it('copies a list record to the new NSID, preserving rkey, then deletes the old one', async () => {
    const { db } = makeFakeDb({ userRow: undefined });
    const { agent, created, deleted } = makeAgent({
      'app.collectivesocial.feed.list': [
        {
          uri: `at://${DID}/app.collectivesocial.feed.list/rkey123`,
          cid: 'oldcid',
          value: {
            $type: 'app.collectivesocial.feed.list',
            name: 'Inbox',
            isDefault: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    });
    const ctx = {
      db,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as any;

    await migrateUserToPopfeed(ctx, DID, agent);

    expect(created).toHaveLength(1);
    expect(created[0].collection).toBe('social.popfeed.feed.list');
    expect(created[0].rkey).toBe('rkey123');
    expect(created[0].record.name).toBe('Inbox');
    expect(created[0].record.listType).toBe('inbox');

    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toEqual({
      collection: 'app.collectivesocial.feed.list',
      rkey: 'rkey123',
    });
  });

  it('marks status failed (without throwing) when a collection fails to migrate', async () => {
    const { db, updateCalls } = makeFakeDb({ userRow: undefined });
    const { agent } = makeAgent({});
    agent.api.com.atproto.repo.listRecords = vi
      .fn()
      .mockRejectedValue(new Error('PDS unavailable'));
    const ctx = {
      db,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as any;

    await expect(
      migrateUserToPopfeed(ctx, DID, agent)
    ).resolves.toBeUndefined();

    const statuses = updateCalls
      .filter((c) => c.table === 'users')
      .map((c) => c.values.popfeedMigrationStatus);
    expect(statuses).toEqual(['in_progress', 'failed']);
    const failedUpdate = updateCalls.find(
      (c) => c.values.popfeedMigrationStatus === 'failed'
    );
    expect(failedUpdate?.values.popfeedMigrationError).toContain(
      'PDS unavailable'
    );
  });
});
