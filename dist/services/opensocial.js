"use strict";
/**
 * OpenSocial API client for Collective Social.
 *
 * Uses an API key registered through the OpenSocial developer UI
 * (stored in OPENSOCIAL_API_KEY env var) to talk to the OpenSocial backend.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rkeyFromUri = rkeyFromUri;
exports.listAllCommunityRecords = listAllCommunityRecords;
exports.listCommunities = listCommunities;
exports.getCommunity = getCommunity;
exports.createCommunity = createCommunity;
exports.deleteCommunity = deleteCommunity;
exports.joinCommunity = joinCommunity;
exports.verifyCredentials = verifyCredentials;
exports.createCommunityRecord = createCommunityRecord;
exports.updateCommunityRecord = updateCommunityRecord;
exports.deleteCommunityRecord = deleteCommunityRecord;
exports.listCommunityRecords = listCommunityRecords;
exports.getCommunityRecord = getCommunityRecord;
exports.checkMembership = checkMembership;
exports.listMembers = listMembers;
exports.getCommunityPermissions = getCommunityPermissions;
exports.resolveUserPermissions = resolveUserPermissions;
const config_1 = require("../config");
const OPENSOCIAL_API_URL = config_1.config.openSocialApiUrl;
const OPENSOCIAL_API_KEY = config_1.config.openSocialApiKey;
class OpenSocialClientError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'OpenSocialClientError';
        this.status = status;
    }
}
async function request(path, options = {}) {
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
        throw new OpenSocialClientError(body.error || `OpenSocial API error: ${response.status}`, response.status);
    }
    return response.json();
}
/**
 * Extract the rkey from an AT-URI.
 * e.g. "at://did:plc:xxx/app.collectivesocial.group.list/abc123" → "abc123"
 */
function rkeyFromUri(uri) {
    return uri.split('/').pop();
}
/**
 * List ALL records in a community PDS collection (handles pagination).
 */
async function listAllCommunityRecords(communityDid, collection) {
    const all = [];
    let cursor;
    do {
        const page = await listCommunityRecords(communityDid, collection, {
            limit: 100,
            cursor,
        });
        all.push(...page.records);
        cursor = page.cursor;
    } while (cursor);
    return all;
}
/**
 * List all communities visible to this app.
 * Optionally pass a user DID to include is_admin flags.
 */
async function listCommunities(userDid, query) {
    const params = new URLSearchParams();
    if (userDid)
        params.set('userDid', userDid);
    if (query)
        params.set('query', query);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await request(`/api/v1/communities${qs}`);
    return data.communities;
}
/**
 * Get full community details including profile + admins.
 */
async function getCommunity(did, userDid) {
    const params = userDid ? `?user_did=${encodeURIComponent(userDid)}` : '';
    return request(`/api/v1/communities/${encodeURIComponent(did)}${params}`);
}
/**
 * Create a new community on the OpenSocial PDS.
 */
async function createCommunity(opts) {
    return request('/api/v1/communities', {
        method: 'POST',
        body: JSON.stringify(opts),
    });
}
/**
 * Delete a community (caller must be the sole admin).
 */
async function deleteCommunity(did, userDid) {
    await request(`/api/v1/communities/${encodeURIComponent(did)}`, {
        method: 'DELETE',
        body: JSON.stringify({ user_did: userDid }),
    });
}
/**
 * Get join information for a community.
 * Returns the record the client should write to the user's repo.
 */
async function joinCommunity(communityDid, userDid, userPdsHost) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_did: userDid, user_pds_host: userPdsHost }),
    });
}
/**
 * Verify the API key is still valid. Useful as a health-check.
 */
async function verifyCredentials() {
    return request('/api/v1/apps/verify', { method: 'POST' });
}
/**
 * Create a record in a community's PDS repo on behalf of an authenticated member.
 * The OpenSocial API will verify membership (and admin status for protected collections).
 */
async function createCommunityRecord(communityDid, userDid, collection, record, rkey) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/records`, {
        method: 'POST',
        body: JSON.stringify({ userDid, collection, record: { $type: collection, ...record }, rkey }),
    });
}
/**
 * Update (put) a record in a community's PDS repo.
 * Admin-only collections require the user to be an admin.
 */
async function updateCommunityRecord(communityDid, userDid, collection, rkey, record) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/records`, {
        method: 'PUT',
        body: JSON.stringify({ userDid, collection, rkey, record: { $type: collection, ...record } }),
    });
}
/**
 * Delete a record from a community's PDS repo.
 */
async function deleteCommunityRecord(communityDid, userDid, collection, rkey) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}/${encodeURIComponent(rkey)}?userDid=${encodeURIComponent(userDid)}`, { method: 'DELETE' });
}
/**
 * List records in a community's PDS repo collection.
 */
async function listCommunityRecords(communityDid, collection, opts) {
    const params = new URLSearchParams();
    if (opts?.limit)
        params.set('limit', String(opts.limit));
    if (opts?.cursor)
        params.set('cursor', opts.cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}${qs}`);
}
/**
 * Get a specific record from a community's PDS repo.
 */
async function getCommunityRecord(communityDid, collection, rkey) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/records/${encodeURIComponent(collection)}/${encodeURIComponent(rkey)}`);
}
/**
 * Check if a user is a member (and/or admin) of a community.
 */
async function checkMembership(communityDid, userDid) {
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/membership/check`, {
        method: 'POST',
        body: JSON.stringify({ userDid }),
    });
}
/**
 * List all members of a community (public mode — no admin auth required).
 */
async function listMembers(communityDid, search) {
    const params = new URLSearchParams({ public: 'true' });
    if (search)
        params.set('search', search);
    return request(`/api/v1/communities/${encodeURIComponent(communityDid)}/members?${params.toString()}`);
}
// In-memory permissions cache: keyed on "communityDid:userDid", TTL 60 s
const permissionsCache = new Map();
const PERMISSIONS_CACHE_TTL = 60000; // 60 seconds
/**
 * Fetch collection permissions + user roles from open-social in a single call.
 * Cached for 60 seconds keyed on communityDid + userDid.
 */
async function getCommunityPermissions(communityDid, userDid) {
    const cacheKey = `${communityDid}:${userDid ?? ''}`;
    const cached = permissionsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < PERMISSIONS_CACHE_TTL) {
        return cached.data;
    }
    const params = new URLSearchParams();
    if (userDid)
        params.set('userDid', userDid);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await request(`/api/v1/communities/${encodeURIComponent(communityDid)}/permissions${qs}`);
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
async function resolveUserPermissions(communityDid, userDid) {
    const { permissions, userRoles } = await getCommunityPermissions(communityDid, userDid);
    const resolve = (requiredRole) => {
        if (!userDid || userRoles.length === 0)
            return false;
        // Admin can do anything
        if (userRoles.includes('admin'))
            return true;
        // Built-in 'member' role
        if (requiredRole === 'member')
            return userRoles.includes('member');
        // Built-in 'admin' role
        if (requiredRole === 'admin')
            return false;
        // Custom role — exact match
        return userRoles.includes(requiredRole);
    };
    // If we got permission rows from open-social, use them
    if (permissions.length > 0) {
        const result = {};
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
    const DEFAULTS = {
        'app.collectivesocial.group.list': { c: 'admin', r: 'member', u: 'admin', d: 'admin' },
        'app.collectivesocial.group.listitem': { c: 'admin', r: 'member', u: 'admin', d: 'admin' },
        'app.collectivesocial.group.listitem.status': { c: 'admin', r: 'member', u: 'admin', d: 'admin' },
        'app.collectivesocial.group.segment': { c: 'admin', r: 'member', u: 'admin', d: 'admin' },
        'app.collectivesocial.group.segment.progress': { c: 'member', r: 'member', u: 'member', d: 'member' },
        'app.collectivesocial.group.post': { c: 'member', r: 'member', u: 'member', d: 'admin' },
        'app.collectivesocial.group.reaction': { c: 'member', r: 'member', u: 'member', d: 'member' },
    };
    const result = {};
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
