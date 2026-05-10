/**
 * Integration tests — GET /groups/:communityDid/permissions
 *
 * These tests boot the Express app against a real test DB but mock the
 * OpenSocial service so we aren't dependent on an external network call.
 * The auth agent is also mocked to return null (unauthenticated) by default.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestDb, createFakeContext, createTestApp, supertest } from './helpers';
import type { Database } from '../../src/db';

// ── Mock the OpenSocial service module ────────────────────────────────────────
vi.mock('../../src/services/opensocial', () => ({
  listCommunities: vi.fn(),
  resolveUserPermissions: vi.fn(),
  rkeyFromUri: vi.fn((uri: string) => uri.split('/').pop()),
  getCommunityPermissions: vi.fn(),
}));

// ── Mock the auth agent (always unauthenticated in these tests) ───────────────
vi.mock('../../src/auth/agent', () => ({
  getSessionAgent: vi.fn(async () => null),
}));

import * as opensocial from '../../src/services/opensocial';

const COMMUNITY_DID = 'did:plc:testcommunity123';

const MOCK_PERMISSIONS: Record<string, {
  canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean;
}> = {
  'app.collectivesocial.group.list': {
    canCreate: false, canRead: true, canUpdate: false, canDelete: false,
  },
  'app.collectivesocial.group.listitem': {
    canCreate: false, canRead: true, canUpdate: false, canDelete: false,
  },
};

describe('GET /groups/:communityDid/permissions', () => {
  let db: Database;
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    db = await createTestDb();
    const ctx = createFakeContext(db);
    app = createTestApp(ctx);

    vi.mocked(opensocial.resolveUserPermissions).mockResolvedValue(MOCK_PERMISSIONS);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('returns 200 with a permissions object for an unauthenticated user', async () => {
    const res = await supertest(app)
      .get(`/groups/${COMMUNITY_DID}/permissions`)
      .expect(200);

    expect(res.body).toHaveProperty('permissions');
    expect(res.body.permissions).toEqual(MOCK_PERMISSIONS);
  });

  it('calls resolveUserPermissions with the community DID and no userDid', async () => {
    await supertest(app).get(`/groups/${COMMUNITY_DID}/permissions`);

    expect(opensocial.resolveUserPermissions).toHaveBeenCalledWith(
      COMMUNITY_DID,
      undefined
    );
  });

  it('returns 500 when opensocial throws', async () => {
    vi.mocked(opensocial.resolveUserPermissions).mockRejectedValueOnce(
      Object.assign(new Error('OpenSocial unavailable'), { status: 503 })
    );

    const res = await supertest(app)
      .get(`/groups/${COMMUNITY_DID}/permissions`)
      .expect(503);

    expect(res.body).toHaveProperty('error');
  });
});
