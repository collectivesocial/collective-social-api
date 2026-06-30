import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import {
  requireGroupMember,
  requireGroupAdmin,
  type GroupAuthRequest,
} from '../src/middleware/groupAuth';

// Mock the entire opensocial service so no real HTTP calls are made.
vi.mock('../src/services/opensocial', () => ({
  checkMembership: vi.fn(),
}));

// Mock getSessionAgent so tests don't need a real database / cookie session.
vi.mock('../src/auth/agent', () => ({
  getSessionAgent: vi.fn(),
}));

import * as opensocial from '../src/services/opensocial';
import { getSessionAgent } from '../src/auth/agent';

const mockCheckMembership = vi.mocked(opensocial.checkMembership);
const mockGetSessionAgent = vi.mocked(getSessionAgent);

// Minimal AppContext — the middleware only uses it to pass to getSessionAgent.
const ctx = {} as any;

function makeReqRes(params: Record<string, string> = {}) {
  const req: Partial<GroupAuthRequest> = { params };
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req: req as GroupAuthRequest, res, next, json, status };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── requireGroupMember ────────────────────────────────────────────

describe('requireGroupMember', () => {
  it('returns 401 when there is no active session', async () => {
    mockGetSessionAgent.mockResolvedValue(null as any);
    const { req, res, next, status, json } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupMember(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('authenticated'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when communityDid param is missing', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:user1' } as any);
    const { req, res, next, status, json } = makeReqRes({}); // no communityDid

    await requireGroupMember(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('communityDid'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when checkMembership returns isMember: false', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:user1' } as any);
    mockCheckMembership.mockResolvedValue({ isMember: false, isAdmin: false });
    const { req, res, next, status } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupMember(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches groupAuth when user is a member', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:user1' } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: false });
    const { req, res, next } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupMember(ctx)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.groupAuth).toMatchObject({
      userDid: 'did:plc:user1',
      communityDid: 'did:plc:community1',
      isMember: true,
      isAdmin: false,
    });
  });

  it('calls next() and marks isAdmin when user is an admin', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:admin1' } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: true });
    const { req, res, next } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupMember(ctx)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.groupAuth?.isAdmin).toBe(true);
  });
});

// ── requireGroupAdmin ─────────────────────────────────────────────

describe('requireGroupAdmin', () => {
  it('returns 403 when groupAuth is already set but isAdmin is false', async () => {
    const { req, res, next, status } = makeReqRes({
      communityDid: 'did:plc:community1',
    });
    // Pre-populate groupAuth as requireGroupMember would
    req.groupAuth = {
      userDid: 'did:plc:user1',
      communityDid: 'did:plc:community1',
      isMember: true,
      isAdmin: false,
    };

    await requireGroupAdmin(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    // Must NOT call checkMembership again — groupAuth is already populated
    expect(mockCheckMembership).not.toHaveBeenCalled();
  });

  it('calls next() when groupAuth is already set and isAdmin is true', async () => {
    const { req, res, next } = makeReqRes({
      communityDid: 'did:plc:community1',
    });
    req.groupAuth = {
      userDid: 'did:plc:admin1',
      communityDid: 'did:plc:community1',
      isMember: true,
      isAdmin: true,
    };

    await requireGroupAdmin(ctx)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockCheckMembership).not.toHaveBeenCalled();
  });

  it('performs full membership check when groupAuth is not pre-set', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:admin1' } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: true });
    const { req, res, next } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupAdmin(ctx)(req, res, next);

    expect(mockCheckMembership).toHaveBeenCalledWith(
      'did:plc:community1',
      'did:plc:admin1'
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.groupAuth?.isAdmin).toBe(true);
  });

  it('returns 403 when full check finds user is a member but not admin', async () => {
    mockGetSessionAgent.mockResolvedValue({ did: 'did:plc:user1' } as any);
    mockCheckMembership.mockResolvedValue({ isMember: true, isAdmin: false });
    const { req, res, next, status } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupAdmin(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no session even in standalone admin check', async () => {
    mockGetSessionAgent.mockResolvedValue(null as any);
    const { req, res, next, status } = makeReqRes({
      communityDid: 'did:plc:community1',
    });

    await requireGroupAdmin(ctx)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
