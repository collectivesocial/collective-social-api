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
