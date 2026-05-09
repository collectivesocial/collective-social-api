/**
 * OpenSocial API client for Collective Social.
 *
 * Supports two authentication modes:
 * - API key (X-Api-Key header) — legacy, used when OPENSOCIAL_API_KEY is set
 * - CIMD + HTTP Message Signatures — used when OPENSOCIAL_SIGNING_KEY is set
 *
 * When both are configured, HTTP Message Signatures take priority.
 */

import { config } from '../config';
import { signRequest, type SigningConfig } from '../lib/httpSigning';

const OPENSOCIAL_API_URL = config.openSocialApiUrl;
const OPENSOCIAL_API_KEY = config.openSocialApiKey;

// Build signing config from env if available
let signingConfig: SigningConfig | null = null;
if (config.openSocialSigningKey) {
  signingConfig = {
    privateKey: config.openSocialSigningKey,
    keyId: config.openSocialKeyId || 'collective-social-key-1',
    algorithm: (config.openSocialKeyAlgorithm ||
      'ed25519') as SigningConfig['algorithm'],
  };
}

interface Community {
  did: string;
  handle: string;
  display_name: string;
  pds_host: string;
  created_at: string;
  is_admin: boolean;
}

interface CommunityDetail {
  did: string;
  handle: string;
  pds_host: string;
  display_name: string;
  description?: string;
  guidelines?: string;
  admins: Array<{
    did: string;
    permissions: string[];
    addedAt: string;
  }>;
  created_at: string;
}

interface JoinInfo {
  action: string;
  instructions: string;
  record: {
    $type: string;
    community: string;
    joinedAt: string;
  };
  collection: string;
  community: {
    handle: string;
    did: string;
  };
}

class OpenSocialClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenSocialClientError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!OPENSOCIAL_API_URL) {
    throw new OpenSocialClientError(
      'OPENSOCIAL_API_URL is not configured',
      500
    );
  }
  if (!signingConfig && !OPENSOCIAL_API_KEY) {
    throw new OpenSocialClientError(
      'Neither OPENSOCIAL_SIGNING_KEY nor OPENSOCIAL_API_KEY is configured',
      500
    );
  }

  const url = `${OPENSOCIAL_API_URL}${path}`;
  const body = options.body as string | undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Prefer HTTP Message Signatures when signing key is configured
  if (signingConfig) {
    const sigHeaders = signRequest(
      {
        method: options.method || 'GET',
        url,
        headers,
        body,
      },
      signingConfig
    );
    Object.assign(headers, sigHeaders);
  } else {
    headers['X-Api-Key'] = OPENSOCIAL_API_KEY;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new OpenSocialClientError(
      (body as any).error || `OpenSocial API error: ${response.status}`,
      response.status
    );
  }

  return response.json() as Promise<T>;
}

// ── PDS record types ─────────────────────────────────────────────

/** A PDS record with its AT-URI, CID, and value. */
export interface PdsRecord<T = Record<string, unknown>> {
  uri: string;
  cid: string;
  value: T;
}

/**
 * Extract the rkey from an AT-URI.
 * e.g. "at://did:plc:xxx/app.collectivesocial.group.list/abc123" → "abc123"
 */
export function rkeyFromUri(uri: string): string {
  return uri.split('/').pop()!;
}

/**
 * List ALL records in a community PDS collection (handles pagination).
 */
export async function listAllCommunityRecords<T = Record<string, unknown>>(
  communityDid: string,
  collection: string
): Promise<PdsRecord<T>[]> {
  const all: PdsRecord<T>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listCommunityRecords(communityDid, collection, {
      limit: 100,
      cursor,
    });
    all.push(...(page.records as PdsRecord<T>[]));
    cursor = page.cursor;
  } while (cursor);
  return all;
}

/**
 * List all communities visible to this app.
 * Optionally pass a user DID to include is_admin flags.
 */
export async function listCommunities(
  userDid?: string,
  query?: string
): Promise<Community[]> {
  const params = new URLSearchParams();
  if (userDid) params.set('userDid', userDid);
  if (query) params.set('query', query);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await request<{ communities: Community[] }>(
    `/api/v1/communities${qs}`
  );
  return data.communities;
}

/**
 * Get full community details including profile + admins.
 */
export async function getCommunity(
  did: string,
  userDid?: string
): Promise<{ community: CommunityDetail; is_admin: boolean }> {
  const params = userDid ? `?user_did=${encodeURIComponent(userDid)}` : '';
  return request(`/api/v1/communities/${encodeURIComponent(did)}${params}`);
}

/**
 * Create a new community on the OpenSocial PDS.
 */
export async function createCommunity(opts: {
  handle: string;
  display_name: string;
  description?: string;
  creator_did: string;
}): Promise<{ community: Community; is_admin: boolean }> {
  return request('/api/v1/communities', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/**
 * Delete a community (caller must be the sole admin).
 */
export async function deleteCommunity(
  did: string,
  userDid: string
): Promise<void> {
  await request(`/api/v1/communities/${encodeURIComponent(did)}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_did: userDid }),
  });
}

/**
 * Get join information for a community.
 * Returns the record the client should write to the user's repo.
 */
export async function joinCommunity(
  communityDid: string,
  userDid: string,
  userPdsHost: string
): Promise<JoinInfo> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/members`,
    {
      method: 'POST',
      body: JSON.stringify({ user_did: userDid, user_pds_host: userPdsHost }),
    }
  );
}

/**
 * Verify the API key is still valid. Useful as a health-check.
 */
export async function verifyCredentials(): Promise<{
  valid: boolean;
  app: { app_id: string; name: string; domain: string };
}> {
  return request('/api/v1/apps/verify', { method: 'POST' });
}

// ── Community record proxy methods ────────────────────────────────

interface RecordResponse {
  uri: string;
  cid: string;
}

interface RecordValue {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

interface ListRecordsResponse {
  records: Array<{ uri: string; cid: string; value: Record<string, unknown> }>;
  cursor?: string;
}

interface MembershipCheckResponse {
  isMember: boolean;
  isAdmin: boolean;
  isPending?: boolean;
}

interface MemberInfo {
  uri: string;
  did: string | null;
  confirmedAt: string | null;
  isAdmin: boolean;
}

interface MembersResponse {
  members: MemberInfo[];
  total: number;
}

/**
 * Create a record in a community's PDS repo on behalf of an authenticated member.
 * The OpenSocial API will verify membership (and admin status for protected collections).
 */
export async function createCommunityRecord(
  communityDid: string,
  userDid: string,
  collection: string,
  record: Record<string, unknown>,
  rkey?: string
): Promise<RecordResponse> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records`,
    {
      method: 'POST',
      body: JSON.stringify({
        userDid,
        collection,
        record: { $type: collection, ...record },
        rkey,
      }),
    }
  );
}

/**
 * Update (put) a record in a community's PDS repo.
 * Admin-only collections require the user to be an admin.
 */
export async function updateCommunityRecord(
  communityDid: string,
  userDid: string,
  collection: string,
  rkey: string,
  record: Record<string, unknown>
): Promise<RecordResponse> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records`,
    {
      method: 'PUT',
      body: JSON.stringify({
        userDid,
        collection,
        rkey,
        record: { $type: collection, ...record },
      }),
    }
  );
}

/**
 * Delete a record from a community's PDS repo.
 */
export async function deleteCommunityRecord(
  communityDid: string,
  userDid: string,
  collection: string,
  rkey: string
): Promise<{ success: boolean }> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}/${encodeURIComponent(rkey)}?userDid=${encodeURIComponent(userDid)}`,
    { method: 'DELETE' }
  );
}

/**
 * List records in a community's PDS repo collection.
 */
export async function listCommunityRecords(
  communityDid: string,
  collection: string,
  opts?: { limit?: number; cursor?: string }
): Promise<ListRecordsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}${qs}`
  );
}

/**
 * Get a specific record from a community's PDS repo.
 */
export async function getCommunityRecord(
  communityDid: string,
  collection: string,
  rkey: string
): Promise<RecordValue> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}/${encodeURIComponent(rkey)}`
  );
}

/**
 * Check if a user is a member (and/or admin) of a community.
 */
export async function checkMembership(
  communityDid: string,
  userDid: string
): Promise<MembershipCheckResponse> {
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/membership/check`,
    {
      method: 'POST',
      body: JSON.stringify({ userDid }),
    }
  );
}

/**
 * List all members of a community (public mode — no admin auth required).
 */
export async function listMembers(
  communityDid: string,
  search?: string
): Promise<MembersResponse> {
  const params = new URLSearchParams({ public: 'true' });
  if (search) params.set('search', search);
  return request(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/members?${params.toString()}`
  );
}

// ── Permissions ───────────────────────────────────────────────────

/** A single collection's permission row (role names like 'member', 'admin', or a custom role). */
export interface CollectionPermission {
  collection: string;
  canCreate: string;
  canRead: string;
  canUpdate: string;
  canDelete: string;
}

/** Resolved boolean permissions for one collection based on the user's roles. */
export interface ResolvedCollectionPermission {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

interface PermissionsResponse {
  permissions: CollectionPermission[];
  userRoles: string[];
}

// In-memory permissions cache: keyed on "communityDid:userDid", TTL 60 s
const permissionsCache = new Map<
  string,
  { data: PermissionsResponse; fetchedAt: number }
>();
const PERMISSIONS_CACHE_TTL = 60_000; // 60 seconds

/**
 * Fetch collection permissions + user roles from open-social in a single call.
 * Cached for 60 seconds keyed on communityDid + userDid.
 */
export async function getCommunityPermissions(
  communityDid: string,
  userDid?: string
): Promise<PermissionsResponse> {
  const cacheKey = `${communityDid}:${userDid ?? ''}`;
  const cached = permissionsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PERMISSIONS_CACHE_TTL) {
    return cached.data;
  }

  const params = new URLSearchParams();
  if (userDid) params.set('userDid', userDid);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const data = await request<PermissionsResponse>(
    `/api/v1/communities/${encodeURIComponent(communityDid)}/permissions${qs}`
  );

  permissionsCache.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}

/**
 * Resolve a user's effective boolean permissions for each collection.
 *
 * Matches the open-social `satisfiesRole` logic:
 * - 'admin' role satisfies any required role
 * - 'member' satisfies 'member'
 * - custom roles require exact match or admin
 *
 * Returns a map like: { 'app.collectivesocial.group.list': { canCreate: true, ... }, ... }
 *
 * When no permission rows exist (app not enabled), falls back to hardcoded defaults.
 */
export async function resolveUserPermissions(
  communityDid: string,
  userDid?: string
): Promise<Record<string, ResolvedCollectionPermission>> {
  const { permissions, userRoles } = await getCommunityPermissions(
    communityDid,
    userDid
  );

  const resolve = (requiredRole: string): boolean => {
    if (!userDid || userRoles.length === 0) return false;
    // Admin can do anything
    if (userRoles.includes('admin')) return true;
    // Built-in 'member' role
    if (requiredRole === 'member') return userRoles.includes('member');
    // Built-in 'admin' role
    if (requiredRole === 'admin') return false;
    // Custom role — exact match
    return userRoles.includes(requiredRole);
  };

  // If we got permission rows from open-social, use them
  if (permissions.length > 0) {
    const result: Record<string, ResolvedCollectionPermission> = {};
    for (const perm of permissions) {
      result[perm.collection] = {
        canCreate: resolve(perm.canCreate),
        canRead: resolve(perm.canRead),
        canUpdate: resolve(perm.canUpdate),
        canDelete: resolve(perm.canDelete),
      };
    }
    return result;
  }

  // Fallback: no permission rows (app not enabled yet).
  // Use hardcoded defaults matching the original middleware behavior.
  const DEFAULTS: Record<
    string,
    { c: string; r: string; u: string; d: string }
  > = {
    'app.collectivesocial.group.list': {
      c: 'admin',
      r: 'member',
      u: 'admin',
      d: 'admin',
    },
    'app.collectivesocial.group.listitem': {
      c: 'admin',
      r: 'member',
      u: 'admin',
      d: 'admin',
    },
    'app.collectivesocial.group.listitem.status': {
      c: 'admin',
      r: 'member',
      u: 'admin',
      d: 'admin',
    },
    'app.collectivesocial.group.segment': {
      c: 'admin',
      r: 'member',
      u: 'admin',
      d: 'admin',
    },
    'app.collectivesocial.group.segment.progress': {
      c: 'member',
      r: 'member',
      u: 'member',
      d: 'member',
    },
    'app.collectivesocial.group.post': {
      c: 'member',
      r: 'member',
      u: 'member',
      d: 'admin',
    },
    'app.collectivesocial.group.reaction': {
      c: 'member',
      r: 'member',
      u: 'member',
      d: 'member',
    },
  };

  const result: Record<string, ResolvedCollectionPermission> = {};
  for (const [col, def] of Object.entries(DEFAULTS)) {
    result[col] = {
      canCreate: resolve(def.c),
      canRead: resolve(def.r),
      canUpdate: resolve(def.u),
      canDelete: resolve(def.d),
    };
  }
  return result;
}
