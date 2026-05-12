/**
 * Regression tests for the group segment progress route.
 *
 * Bug 1 (missing-createdAt): progress records must include a createdAt timestamp.
 *   Originally tested against createCommunityRecord (community PDS path).
 *   Updated for A.1 refactoring: progress now writes to the user's own PDS
 *   via agent.api.com.atproto.repo.putRecord.
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
  it('writes to user PDS with createdAt (regression: missing-createdAt bug)', async () => {
    // The putRecord and getRecord spies on the mock agent
    const mockPutRecord = vi.fn().mockResolvedValue({
      data: {
        uri: `at://${USER_DID}/app.collectivesocial.feed.segmentprogress/${SEGMENT_RKEY}`,
        cid: 'bafynewcid',
      },
    });
    const mockGetRecord = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 })
      );

    mockGetSessionAgent.mockResolvedValue({
      did: USER_DID,
      api: {
        com: {
          atproto: {
            repo: {
              getRecord: mockGetRecord,
              putRecord: mockPutRecord,
            },
          },
        },
      },
    } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: false });
    mockGetCommunityRecord.mockResolvedValue(segmentRecord as any);

    const app = buildApp();

    const res = await request(app)
      .post(
        `/groups/${encodeURIComponent(COMMUNITY_DID)}/segments/${SEGMENT_RKEY}/progress`
      )
      .set('Cookie', 'session=fake');

    expect(res.status).toBe(200);
    expect(res.body.progress).toBeDefined();

    // Assert: putRecord was called with createdAt in the record
    expect(mockPutRecord).toHaveBeenCalledTimes(1);
    const callArgs = mockPutRecord.mock.calls[0][0];
    expect(callArgs.collection).toBe(
      'app.collectivesocial.feed.segmentprogress'
    );
    expect(callArgs.rkey).toBe(SEGMENT_RKEY);
    expect(callArgs.record).toHaveProperty('createdAt');
    expect(typeof callArgs.record.createdAt).toBe('string');
    expect(callArgs.record).toHaveProperty('segmentUri', SEGMENT_URI);
    expect(callArgs.record).toHaveProperty('completed', true);
    expect(callArgs.record).toHaveProperty('communityDid', COMMUNITY_DID);
  });

  it('returns 403 when the user is not a member of the community', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: USER_DID } as any);
    mockCheckMembership.mockResolvedValue({ isMember: false, isAdmin: false });

    const app = buildApp();

    const res = await request(app)
      .post(
        `/groups/${encodeURIComponent(COMMUNITY_DID)}/segments/${SEGMENT_RKEY}/progress`
      )
      .set('Cookie', 'session=fake');

    expect(res.status).toBe(403);
  });
});
