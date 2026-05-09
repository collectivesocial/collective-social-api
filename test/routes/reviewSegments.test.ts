/**
 * Regression tests for the group segment progress route.
 *
 * Bug 1 (missing-createdAt): createCommunityRecord must include a `createdAt`
 *   timestamp so PDS records have a stable created_at field.
 *
 * Bug 2: unauthenticated / non-member requests must receive 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter as createGroupContentRouter } from '../../src/routes/groupContent';

// ── Module mocks ──────────────────────────────────────────────────
// vi.mock() is hoisted so these run before imports.

vi.mock('../../src/auth/agent', () => ({
  getSessionAgent: vi.fn(),
}));

vi.mock('../../src/services/opensocial', () => ({
  checkMembership: vi.fn(),
  getCommunityRecord: vi.fn(),
  listAllCommunityRecords: vi.fn(),
  createCommunityRecord: vi.fn(),
  listAllCommunityRecordsByMember: vi.fn(),
  rkeyFromUri: vi.fn((uri: string) => uri.split('/').pop() ?? ''),
}));

// Notifications & group-post service — not under test, silence them
vi.mock('../../src/services/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyAllMembers: vi.fn().mockResolvedValue(undefined),
  notifyUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/groupPosts', () => ({
  getPostsForSegment: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/userProfiles', () => ({
  getUserProfile: vi.fn().mockResolvedValue(null),
}));

import { getSessionAgent } from '../../src/auth/agent';
import * as opensocial from '../../src/services/opensocial';

const mockGetSessionAgent = vi.mocked(getSessionAgent);
const mockCheckMembership = vi.mocked(opensocial.checkMembership);
const mockGetCommunityRecord = vi.mocked(opensocial.getCommunityRecord);
const mockListAllCommunityRecords = vi.mocked(opensocial.listAllCommunityRecords);
const mockCreateCommunityRecord = vi.mocked(opensocial.createCommunityRecord);

// ── Fixtures ──────────────────────────────────────────────────────

const COMMUNITY_DID = 'did:plc:community1';
const USER_DID = 'did:plc:user1';
const SEGMENT_RKEY = 'seg123';
const SEGMENT_URI = `at://${COMMUNITY_DID}/app.collectivesocial.group.segment/${SEGMENT_RKEY}`;

const segmentRecord = {
  uri: SEGMENT_URI,
  cid: 'bafycid',
  value: {
    label: 'Chapters 1-5',
    listItemUri: `at://${COMMUNITY_DID}/app.collectivesocial.group.listitem/item1`,
  },
};

const progressRecord = {
  uri: `at://${COMMUNITY_DID}/app.collectivesocial.group.segment.progress/prog1`,
  cid: 'bafycid2',
  value: {
    segmentUri: SEGMENT_URI,
    memberDid: USER_DID,
    completed: true,
    completedAt: '2026-05-08T21:23:32.000Z',
    createdAt: '2026-05-08T21:23:32.000Z',
  },
};

// Minimal AppContext — db, config, logger all unused by these routes in tests.
function makeCtx() {
  return {
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    db: {},
    cfg: {},
  } as any;
}

function buildApp() {
  const ctx = makeCtx();
  const app = express();
  app.use(express.json());
  // Mount with mergeParams to mirror real app: app.use('/groups/:communityDid', router)
  const router = express.Router({ mergeParams: true });
  router.use(createGroupContentRouter(ctx));
  app.use('/groups/:communityDid', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────

describe('POST /groups/:communityDid/segments/:segmentRkey/progress', () => {
  it('includes createdAt in the record sent to createCommunityRecord (regression: missing-createdAt bug)', async () => {
    // Arrange: authenticated member
    mockGetSessionAgent.mockResolvedValue({ did: USER_DID } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: false });
    mockGetCommunityRecord.mockResolvedValue(segmentRecord as any);
    mockListAllCommunityRecords.mockResolvedValue([]);
    mockCreateCommunityRecord.mockResolvedValue(progressRecord as any);

    const app = buildApp();

    // Act
    const res = await request(app)
      .post(`/groups/${encodeURIComponent(COMMUNITY_DID)}/segments/${SEGMENT_RKEY}/progress`)
      .set('Cookie', 'session=fake');

    // Assert: endpoint succeeded
    expect(res.status).toBe(200);
    expect(res.body.progress).toBeDefined();

    // Assert: createdAt was forwarded to createCommunityRecord
    expect(mockCreateCommunityRecord).toHaveBeenCalledTimes(1);
    const [, , , record] = mockCreateCommunityRecord.mock.calls[0];
    expect(record).toHaveProperty('createdAt');
    expect(typeof (record as any).createdAt).toBe('string');
    // Sanity check: completedAt is also present
    expect(record).toHaveProperty('completedAt');
  });

  it('returns 403 when the user is not a member of the community', async () => {
    // Arrange: authenticated but not a member
    mockGetSessionAgent.mockResolvedValue({ did: USER_DID } as any);
    mockCheckMembership.mockResolvedValue({ isMember: false, isAdmin: false });

    const app = buildApp();

    // Act
    const res = await request(app)
      .post(`/groups/${encodeURIComponent(COMMUNITY_DID)}/segments/${SEGMENT_RKEY}/progress`)
      .set('Cookie', 'session=fake');

    // Assert: membership gate is enforced
    expect(res.status).toBe(403);
    expect(mockCreateCommunityRecord).not.toHaveBeenCalled();
  });
});
