/**
 * Integration tests — Events V1 endpoints
 *
 * Written against Wash's expected API contract. These tests will be
 * INTENTIONALLY RED until Wash's branch (architecture cleanups + events backend)
 * merges into main and the events routes exist.
 *
 * Expected endpoints (from task brief):
 *   POST   /events                      — create event (admin only) → 201
 *   GET    /events                      — list events with rsvpCounts
 *   PUT    /events/:rkey/rsvp           — upsert RSVP (writes to PDS + event_rsvps)
 *   DELETE /events/:rkey/rsvp           — remove RSVP
 *   GET    /events/:rkey/rsvps          — grouped attendees
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDb, cleanupTables, supertest } from './helpers';
import express from 'express';
import type { Database } from '../../src/db';
import type { AppContext } from '../../src/context';
import { pino } from 'pino';

// ── Mock auth agent ───────────────────────────────────────────────────────────
vi.mock('../../src/auth/agent', () => ({
  getSessionAgent: vi.fn(),
}));

import { getSessionAgent } from '../../src/auth/agent';

const ADMIN_DID = 'did:plc:admin001';
const USER_DID = 'did:plc:user001';
const EVENT_RKEY = 'evt-phase2-test';

// Stub agent factory
function makeAgent(did: string) {
  return {
    did,
    putRecord: vi.fn(async () => ({ uri: `at://${did}/app.collectivesocial.event.rsvp/${EVENT_RKEY}`, cid: 'bafycid' })),
    deleteRecord: vi.fn(async () => ({})),
  };
}

// ── Attempt to import the events router (will fail until Wash's branch merges) ─

let createEventsRouter: ((ctx: AppContext) => express.Router) | null = null;
try {
  // Dynamic import so the test file can still be parsed even when the module
  // doesn't exist — the tests inside will fail with a descriptive message.
  const mod = await import('../../src/routes/events');
  createEventsRouter = mod.createRouter;
} catch {
  // Events router not yet implemented (Wash's branch pending)
}

function buildApp(ctx: AppContext): express.Express {
  const app = express();
  app.use(express.json());
  if (createEventsRouter) {
    app.use('/events', createEventsRouter(ctx));
  } else {
    // Placeholder so supertest gets 404 rather than a hard crash
    app.use('/events', (_req, res) => res.status(501).json({ error: 'Not implemented — waiting on Wash branch' }));
  }
  return app;
}

function makeFakeCtx(db: Database): AppContext {
  return {
    db,
    logger: pino({ level: 'silent' }),
    oauthClient: { restore: async () => null } as any,
    resolver: {} as any,
    destroy: async () => { await db.destroy(); },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Events V1 — integration (⚠️ intentionally red until Wash branch merges)', () => {
  let db: Database;
  let app: express.Express;
  let ctx: AppContext;

  beforeAll(async () => {
    db = await createTestDb();
    ctx = makeFakeCtx(db);
    app = buildApp(ctx);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    // Clean up event-related tables before each test.
    // Table names are expected from Wash's migration — will error until merged.
    await cleanupTables(db, ['events', 'event_rsvps']).catch(() => {
      // Tables don't exist yet — ignore, test itself will surface the failure.
    });
    vi.clearAllMocks();
  });

  // ── POST /events ────────────────────────────────────────────────────────────

  it('POST /events as admin returns 201 with event body', async () => {
    vi.mocked(getSessionAgent).mockResolvedValue(makeAgent(ADMIN_DID) as any);

    const payload = {
      title: 'Phase 2 Launch Party',
      description: 'We shipped it.',
      startsAt: '2026-06-01T18:00:00.000Z',
      endsAt: '2026-06-01T21:00:00.000Z',
      location: 'The Internet',
      communityDid: 'did:plc:community1',
    };

    const res = await supertest(app)
      .post('/events')
      .send(payload)
      .expect(201);

    expect(res.body).toMatchObject({
      rkey: expect.any(String),
      title: payload.title,
      startsAt: payload.startsAt,
    });
  });

  it('POST /events as non-admin returns 403', async () => {
    vi.mocked(getSessionAgent).mockResolvedValue(makeAgent(USER_DID) as any);

    await supertest(app)
      .post('/events')
      .send({ title: 'Sneaky event', communityDid: 'did:plc:community1' })
      .expect(403);
  });

  // ── GET /events ─────────────────────────────────────────────────────────────

  it('GET /events returns event list with rsvpCounts', async () => {
    vi.mocked(getSessionAgent).mockResolvedValue(null);

    const res = await supertest(app)
      .get('/events')
      .query({ communityDid: 'did:plc:community1' })
      .expect(200);

    expect(res.body).toHaveProperty('events');
    expect(Array.isArray(res.body.events)).toBe(true);
    // Each event must expose a rsvpCounts summary
    if (res.body.events.length > 0) {
      expect(res.body.events[0]).toHaveProperty('rsvpCounts');
    }
  });

  // ── PUT /events/:rkey/rsvp ───────────────────────────────────────────────────

  it('PUT /events/:rkey/rsvp upserts the PDS record and inserts into event_rsvps', async () => {
    const agentMock = makeAgent(USER_DID);
    vi.mocked(getSessionAgent).mockResolvedValue(agentMock as any);

    const res = await supertest(app)
      .put(`/events/${EVENT_RKEY}/rsvp`)
      .send({ status: 'going', communityDid: 'did:plc:community1' })
      .expect(200);

    expect(agentMock.putRecord).toHaveBeenCalledOnce();
    expect(res.body).toMatchObject({ status: 'going' });

    // Verify DB row was inserted
    const row = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_rkey', '=', EVENT_RKEY)
      .where('user_did', '=', USER_DID)
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row.status).toBe('going');
  });

  // ── DELETE /events/:rkey/rsvp ────────────────────────────────────────────────

  it('DELETE /events/:rkey/rsvp removes PDS record and DB row', async () => {
    const agentMock = makeAgent(USER_DID);
    vi.mocked(getSessionAgent).mockResolvedValue(agentMock as any);

    await supertest(app)
      .delete(`/events/${EVENT_RKEY}/rsvp`)
      .send({ communityDid: 'did:plc:community1' })
      .expect(200);

    expect(agentMock.deleteRecord).toHaveBeenCalledOnce();

    const row = await (db as any)
      .selectFrom('event_rsvps')
      .selectAll()
      .where('event_rkey', '=', EVENT_RKEY)
      .where('user_did', '=', USER_DID)
      .executeTakeFirst();

    expect(row).toBeUndefined();
  });

  // ── GET /events/:rkey/rsvps ──────────────────────────────────────────────────

  it('GET /events/:rkey/rsvps returns attendees grouped by status', async () => {
    vi.mocked(getSessionAgent).mockResolvedValue(null);

    const res = await supertest(app)
      .get(`/events/${EVENT_RKEY}/rsvps`)
      .expect(200);

    expect(res.body).toHaveProperty('rsvps');
    // Grouped shape: { going: [...], maybe: [...], notGoing: [...] }
    expect(res.body.rsvps).toHaveProperty('going');
    expect(res.body.rsvps).toHaveProperty('maybe');
    expect(res.body.rsvps).toHaveProperty('notGoing');
  });
});
