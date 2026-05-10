/**
 * Unit tests for resolveUserPermissions in src/services/opensocial.ts
 *
 * Regression tests for the bug where DB permission rows were returned
 * as-is (skipping DEFAULTS), leaving app.collectivesocial.group.post
 * absent from the result — causing the frontend to treat members as
 * non-members for the discussion comment gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config so the request() guard doesn't throw in CI where
// OPENSOCIAL_API_KEY / OPENSOCIAL_SIGNING_KEY aren't set.
vi.mock('../src/config', () => ({
  config: {
    openSocialApiUrl: 'http://localhost:3001',
    openSocialApiKey: 'test-api-key',
    openSocialSigningKey: '',
    openSocialKeyId: '',
    openSocialKeyAlgorithm: '',
  },
}));

import { resolveUserPermissions } from '../src/services/opensocial';

// Mock fetch globally so no real HTTP calls are made.
// Each test provides its own mock return value via mockFetch().
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MEMBER_DID = 'did:plc:member';
const ADMIN_DID = 'did:plc:admin';

/** Helper: set up a fetch mock returning the given permissions response. */
function setupPermissionsMock(
  permissions: Array<{ collection: string; canCreate: string; canRead: string; canUpdate: string; canDelete: string }>,
  userRoles: string[],
) {
  const body = JSON.stringify({ permissions, userRoles });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ permissions, userRoles }),
    text: async () => body,
  });
}

// Use a unique community DID per test to bypass the module-level permissions cache.
let testCounter = 0;
function uniqueDid() {
  return `did:plc:testcommunity${++testCounter}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveUserPermissions', () => {
  it('includes app.collectivesocial.group.post with canCreate=true for a member even when DB rows exist for other collections', async () => {
    // Simulate a community that has DB rows for list/listitem but NOT group.post.
    // This was the bug: the early-return on permissions.length > 0 skipped DEFAULTS,
    // leaving group.post absent from the result entirely.
    setupPermissionsMock(
      [
        { collection: 'app.collectivesocial.group.list', canCreate: 'admin', canRead: 'member', canUpdate: 'admin', canDelete: 'admin' },
        { collection: 'app.collectivesocial.group.listitem', canCreate: 'admin', canRead: 'member', canUpdate: 'admin', canDelete: 'admin' },
      ],
      ['member'],
    );

    const result = await resolveUserPermissions(uniqueDid(), MEMBER_DID);

    expect(result['app.collectivesocial.group.post']).toBeDefined();
    expect(result['app.collectivesocial.group.post'].canCreate).toBe(true);
    expect(result['app.collectivesocial.group.post'].canRead).toBe(true);
  });

  it('gives an admin canCreate=true for group.post even when DB rows omit it', async () => {
    setupPermissionsMock(
      [{ collection: 'app.collectivesocial.group.list', canCreate: 'admin', canRead: 'member', canUpdate: 'admin', canDelete: 'admin' }],
      ['admin'],
    );

    const result = await resolveUserPermissions(uniqueDid(), ADMIN_DID);

    expect(result['app.collectivesocial.group.post'].canCreate).toBe(true);
  });

  it('DB rows override DEFAULTS when the same collection appears in both', async () => {
    // Community has overridden group.post to require admin to create (not the DEFAULTS member)
    setupPermissionsMock(
      [{ collection: 'app.collectivesocial.group.post', canCreate: 'admin', canRead: 'member', canUpdate: 'admin', canDelete: 'admin' }],
      ['member'],
    );

    const result = await resolveUserPermissions(uniqueDid(), MEMBER_DID);

    expect(result['app.collectivesocial.group.post'].canCreate).toBe(false);
    expect(result['app.collectivesocial.group.post'].canRead).toBe(true);
  });

  it('falls back entirely to DEFAULTS when no DB rows exist', async () => {
    setupPermissionsMock([], ['member']);

    const result = await resolveUserPermissions(uniqueDid(), MEMBER_DID);

    expect(result['app.collectivesocial.group.post'].canCreate).toBe(true);
    expect(result['app.collectivesocial.group.list'].canCreate).toBe(false); // admin-only in DEFAULTS
    expect(result['app.collectivesocial.group.list'].canRead).toBe(true);
  });

  it('returns canCreate=false for group.post when user has no roles', async () => {
    setupPermissionsMock([], []);

    const result = await resolveUserPermissions(uniqueDid(), MEMBER_DID);

    expect(result['app.collectivesocial.group.post'].canCreate).toBe(false);
  });

  it('returns all false when userDid is undefined (unauthenticated)', async () => {
    setupPermissionsMock([], []);

    const result = await resolveUserPermissions(uniqueDid(), undefined);

    expect(result['app.collectivesocial.group.post'].canCreate).toBe(false);
    expect(result['app.collectivesocial.group.post'].canRead).toBe(false);
  });

  it('includes all DEFAULTS collections even when DB has unrelated rows', async () => {
    setupPermissionsMock(
      [{ collection: 'community.lexicon.calendar.event', canCreate: 'admin', canRead: 'member', canUpdate: 'admin', canDelete: 'admin' }],
      ['member'],
    );

    const result = await resolveUserPermissions(uniqueDid(), MEMBER_DID);

    const expectedCollections = [
      'app.collectivesocial.group.list',
      'app.collectivesocial.group.listitem',
      'app.collectivesocial.group.listitem.status',
      'app.collectivesocial.group.segment',
      'app.collectivesocial.group.segment.progress',
      'app.collectivesocial.group.post',
      'app.collectivesocial.group.reaction',
      'community.lexicon.calendar.event',
    ];

    for (const col of expectedCollections) {
      expect(result[col], `Missing collection: ${col}`).toBeDefined();
    }
  });
});

