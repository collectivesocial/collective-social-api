"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichWithUserProfiles = enrichWithUserProfiles;
exports.extractDidsFromPosts = extractDidsFromPosts;
exports.buildThreadsWithProfiles = buildThreadsWithProfiles;
const api_1 = require("@atproto/api");
/**
 * Fetch user profiles for multiple DIDs in parallel
 * Uses public Bluesky API (no auth needed)
 */
async function enrichWithUserProfiles(dids) {
    const uniqueDids = [...new Set(dids)];
    const profiles = {};
    await Promise.all(uniqueDids.map(async (did) => {
        try {
            const agent = new api_1.Agent({ service: 'https://public.api.bsky.app' });
            const profile = await agent.getProfile({ actor: did });
            profiles[did] = {
                did: profile.data.did,
                handle: profile.data.handle,
                displayName: profile.data.displayName || undefined,
                avatar: profile.data.avatar || undefined,
            };
        }
        catch (err) {
            console.warn(`Failed to fetch profile for ${did}:`, err);
            // Fallback to truncated DID if profile fetch fails
            profiles[did] = {
                did,
                handle: did.slice(0, 20) + '…',
            };
        }
    }));
    return profiles;
}
/**
 * Extract all unique DIDs from a nested post tree
 */
function extractDidsFromPosts(posts) {
    const dids = new Set();
    const addDids = (posts) => {
        for (const post of posts) {
            if (post.authorDid)
                dids.add(post.authorDid);
            if (post.replies)
                addDids(post.replies);
        }
    };
    addDids(posts);
    return Array.from(dids);
}
/**
 * Build threaded post tree with enriched user profiles
 */
function buildThreadsWithProfiles(posts, userProfiles) {
    const sorted = posts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const topLevel = sorted.filter((p) => !p.parentPostUri);
    const replies = sorted.filter((p) => p.parentPostUri);
    const buildThread = (post) => ({
        ...post,
        author: userProfiles[post.authorDid] || {
            did: post.authorDid,
            handle: post.authorDid.slice(0, 20) + '…',
        },
        replies: replies.filter((r) => r.parentPostUri === post.uri).map(buildThread),
    });
    return topLevel.map(buildThread);
}
