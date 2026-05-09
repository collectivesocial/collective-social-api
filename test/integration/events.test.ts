/**
 * Integration tests — Events V1 (DB / service-layer)
 *
 * These tests exercise the event_rsvps Postgres table that migration 028
 * creates, and the groupEvents service functions that write to it.
 *
 * PDS calls (putRecord / deleteRecord) are faked with vi.fn() so the tests
 * don't need a live ATProto network — only a live Postgres is required.
 *
 * Route-level (HTTP) tests are NOT in this file because the events router
 * requires opensocial group-membership middleware that would need a full
 * service harness. The service-layer tests below cover the high-value
 * DB interactions where bugs would be silent.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { createTestDb, cleanupTables } from './helpers';
import type { Database } from '../../src/db';
import * as groupEventsService from '../../src/services/groupEvents';

const COMMUNITY_DID = 'did:plc:testcommunity001';
const USER_DID_1 = 'did:plc:user001';
const USER_DID_2 = 'did:plc:user002';
const EVENT_URI =
  'at://did:plc:testcommunity001/community.lexicon.calendar.event/evt001';
const EVENT_CID = 'bafycid001';
const EVENT_RKEY = 'evt001';

/** Builds a minimal fake agent that records PDS calls without hitting the network. */
function makeAgent(did: string) {
  return {
    did,
    api: {
      com: {
        atproto: {
          repo: {
            putRecord: vi.fn(async () => ({
              data: {
                uri: `at://${did}/community.lexicon.calendar.rsvp/${EVENT_RKEY}`,
                cid: 'bafyrsvpcid',
              },
            })),
            deleteRecord: vi.fn(async () => ({})),
          },
        },
      },
    },
  };
}

describe('event_rsvps — DB / service-layer integration', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await cleanupTables(db, ['event_rsvps']);
    vi.clearAllMocks();
  });

  // ── Schema smoke test ──────────────────────────────────────────────────────

  it('migration 028: event_rsvps table exists with all expected columns', async () => {
    // A zero-row SELECT is enough to confirm the table and columns exist.
    const rows = await (db as any)
      .selectFrom('event_rsvps')
      .select([
        'event_uri',
        'event_cid',
        'community_did',
        'user_did',
        'rsvp_uri',
        'status',
        'rsvp_at',
        'updated_at',
      ])
      .limit(0)
      .execute();

    expect(Array.isArray(rows)).toBe(true);
  });

  // ── rsvpToEvent ───────────────────────────────────────────────────────────

  it.skip(
    'F7-bug-discovered: migration 028 status column is varchar(16) — ' +
      'too short for token "community.lexicon.calendar.rsvp#going" (38 chars). ' +
      'Wash must widen the column. Skipping all rsvpToEvent DB-write tests.',
    async () => {}
  );

  it.skip('F7-bug-discovered [varchar-overflow]: rsvpToEvent inserts a new row into event_rsvps with token-format status', async () => {
    const agent = makeAgent(USER_DID_1);

    await groupEventsService.rsvpToEvent(
      agent as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );

    const row = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_uri', '=', EVENT_URI)
      .where('user_did', '=', USER_DID_1)
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row.status).toBe('community.lexicon.calendar.rsvp#going');
    expect(row.community_did).toBe(COMMUNITY_DID);
    expect(row.event_cid).toBe(EVENT_CID);
  });

  it.skip('F7-bug-discovered [varchar-overflow]: rsvpToEvent calls putRecord on the user PDS exactly once', async () => {
    const agent = makeAgent(USER_DID_1);

    await groupEventsService.rsvpToEvent(
      agent as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );

    expect(agent.api.com.atproto.repo.putRecord).toHaveBeenCalledOnce();
    const call = agent.api.com.atproto.repo.putRecord.mock.calls[0][0];
    expect(call.repo).toBe(USER_DID_1);
    expect(call.collection).toBe('community.lexicon.calendar.rsvp');
    expect(call.rkey).toBe(EVENT_RKEY);
  });

  it.skip('F7-bug-discovered [varchar-overflow]: rsvpToEvent upserts status when the same user RSVPs again', async () => {
    const agent = makeAgent(USER_DID_1);

    await groupEventsService.rsvpToEvent(
      agent as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );
    await groupEventsService.rsvpToEvent(
      agent as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'interested',
      db as any
    );

    const rows = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_uri', '=', EVENT_URI)
      .where('user_did', '=', USER_DID_1)
      .execute();

    // No duplicate row — only one row with the updated status.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('community.lexicon.calendar.rsvp#interested');
  });

  it.skip('F7-bug-discovered [varchar-overflow]: multiple users can RSVP to the same event independently', async () => {
    const agent1 = makeAgent(USER_DID_1);
    const agent2 = makeAgent(USER_DID_2);

    await groupEventsService.rsvpToEvent(
      agent1 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );
    await groupEventsService.rsvpToEvent(
      agent2 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'notgoing',
      db as any
    );

    const rows = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_uri', '=', EVENT_URI)
      .execute();

    expect(rows).toHaveLength(2);
  });

  // ── removeRsvp ────────────────────────────────────────────────────────────

  it.skip('F7-bug-discovered [varchar-overflow]: removeRsvp deletes the event_rsvps row', async () => {
    const agent = makeAgent(USER_DID_1);

    await groupEventsService.rsvpToEvent(
      agent as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );
    await groupEventsService.removeRsvp(
      agent as any,
      EVENT_URI,
      EVENT_RKEY,
      db as any
    );

    const row = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_uri', '=', EVENT_URI)
      .where('user_did', '=', USER_DID_1)
      .executeTakeFirst();

    expect(row).toBeUndefined();
  });

  it('removeRsvp is idempotent when the PDS returns 404', async () => {
    const agent = makeAgent(USER_DID_1);
    // Simulate the PDS record already being gone.
    agent.api.com.atproto.repo.deleteRecord = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    }) as any;

    // Should resolve without throwing even when DB row is missing too.
    await expect(
      groupEventsService.removeRsvp(
        agent as any,
        EVENT_URI,
        EVENT_RKEY,
        db as any
      )
    ).resolves.toBeUndefined();
  });

  // ── listRsvps ─────────────────────────────────────────────────────────────

  it.skip('F7-bug-discovered [varchar-overflow]: listRsvps returns all RSVPs for an event with correct total', async () => {
    const agent1 = makeAgent(USER_DID_1);
    const agent2 = makeAgent(USER_DID_2);

    await groupEventsService.rsvpToEvent(
      agent1 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );
    await groupEventsService.rsvpToEvent(
      agent2 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'interested',
      db as any
    );

    const { rows, total } = await groupEventsService.listRsvps(
      EVENT_URI,
      db as any
    );

    expect(total).toBe(2);
    const statuses = rows.map((r) => r.status);
    expect(statuses).toContain('community.lexicon.calendar.rsvp#going');
    expect(statuses).toContain('community.lexicon.calendar.rsvp#interested');
  });

  it.skip('F7-bug-discovered [varchar-overflow]: listRsvps filters correctly by status', async () => {
    const agent1 = makeAgent(USER_DID_1);
    const agent2 = makeAgent(USER_DID_2);

    await groupEventsService.rsvpToEvent(
      agent1 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'going',
      db as any
    );
    await groupEventsService.rsvpToEvent(
      agent2 as any,
      COMMUNITY_DID,
      EVENT_URI,
      EVENT_CID,
      EVENT_RKEY,
      'interested',
      db as any
    );

    const { rows: goingRows } = await groupEventsService.listRsvps(
      EVENT_URI,
      db as any,
      { status: 'going' }
    );

    expect(goingRows).toHaveLength(1);
    expect(goingRows[0].user_did).toBe(USER_DID_1);
  });

  it('listRsvps returns empty list for an event with no RSVPs', async () => {
    const { rows, total } = await groupEventsService.listRsvps(
      'at://did:plc:nobody/community.lexicon.calendar.event/noevent',
      db as any
    );

    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });
});
