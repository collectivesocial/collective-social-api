/**
 * OpenSocial API client for Collective Social.
 *
 * Uses an API key registered through the OpenSocial developer UI
 * (stored in OPENSOCIAL_API_KEY env var) to talk to the OpenSocial backend.
 */

import { config } from '../config';

const OPENSOCIAL_API_URL = config.openSocialApiUrl;
const OPENSOCIAL_API_KEY = config.openSocialApiKey;

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
    throw new OpenSocialClientError('OPENSOCIAL_API_URL is not configured', 500);
  }
  if (!OPENSOCIAL_API_KEY) {
    throw new OpenSocialClientError('OPENSOCIAL_API_KEY is not configured', 500);
  }

  const url = `${OPENSOCIAL_API_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': OPENSOCIAL_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
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
export async function listCommunities(userDid?: string): Promise<Community[]> {
  const params = userDid ? `?user_did=${encodeURIComponent(userDid)}` : '';
  const data = await request<{ communities: Community[] }>(
    `/api/v1/communities${params}`
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
export async function deleteCommunity(did: string, userDid: string): Promise<void> {
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
  return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_did: userDid, user_pds_host: userPdsHost }),
  });
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
  is_member: boolean;
  is_admin: boolean;
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
      body: JSON.stringify({ user_did: userDid, collection, record, rkey }),
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
      body: JSON.stringify({ user_did: userDid, collection, rkey, record }),
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
    `/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}/${encodeURIComponent(rkey)}?user_did=${encodeURIComponent(userDid)}`,
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
      body: JSON.stringify({ user_did: userDid }),
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
