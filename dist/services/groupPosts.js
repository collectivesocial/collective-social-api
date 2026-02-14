"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGroupPost = createGroupPost;
exports.fetchGroupPosts = fetchGroupPosts;
exports.fetchGroupPostsWithLegacy = fetchGroupPostsWithLegacy;
exports.buildThreads = buildThreads;
exports.deleteGroupPost = deleteGroupPost;
exports.adminDeleteGroupPost = adminDeleteGroupPost;
const common_1 = require("@atproto/common");
const opensocial = __importStar(require("./opensocial"));
const COL_GROUP_POST_PERSONAL = 'app.collectivesocial.feed.grouppost';
const COL_POST_INDEX = 'app.collectivesocial.group.postindex';
const COL_GROUP_POST_LEGACY = 'app.collectivesocial.group.post';
/**
 * Extract rkey from AT-URI
 */
function rkeyFromUri(uri) {
    const parts = uri.split('/');
    return parts[parts.length - 1];
}
/**
 * Create a new group post using dual-storage pattern
 */
async function createGroupPost(agent, userDid, communityDid, data) {
    const now = new Date().toISOString();
    const rkey = common_1.TID.nextStr();
    // 1. Store post in user's personal repo
    const postRecord = {
        text: data.text,
        groupDid: communityDid,
        segmentUri: data.segmentUri || undefined,
        listItemUri: data.listItemUri || undefined,
        parentPostUri: data.parentPostUri || undefined,
        mentionedDids: data.mentionedDids || [],
        createdAt: now,
    };
    const postResponse = await agent.api.com.atproto.repo.putRecord({
        repo: agent.did,
        collection: COL_GROUP_POST_PERSONAL,
        rkey: rkey,
        record: postRecord,
    });
    // 2. Create index entry in community repo
    const indexRecord = {
        postUri: postResponse.data.uri,
        authorDid: userDid,
        segmentUri: data.segmentUri || undefined,
        listItemUri: data.listItemUri || undefined,
        parentPostUri: data.parentPostUri || undefined,
        deletedByAdmin: false,
        createdAt: now,
    };
    const indexResponse = await opensocial.createCommunityRecord(communityDid, userDid, COL_POST_INDEX, indexRecord);
    return {
        postUri: postResponse.data.uri,
        indexUri: indexResponse.uri,
    };
}
/**
 * Fetch posts for a segment/item from user repos via index
 */
async function fetchGroupPosts(agent, communityDid, filter) {
    // 1. Query index from community repo
    const allIndexes = await opensocial.listAllCommunityRecords(communityDid, COL_POST_INDEX);
    // 2. Filter by segment/item and non-deleted
    const relevantIndexes = allIndexes.filter((idx) => {
        const val = idx.value;
        if (val.deletedByAdmin)
            return false;
        if (filter.segmentUri && val.segmentUri !== filter.segmentUri)
            return false;
        if (filter.listItemUri && val.listItemUri !== filter.listItemUri)
            return false;
        return true;
    });
    // 3. Fetch actual posts from user repos in parallel
    const posts = [];
    await Promise.all(relevantIndexes.map(async (idx) => {
        try {
            const postUri = idx.value.postUri;
            const match = postUri.match(/at:\/\/([^\/]+)\/([^\/]+)\/(.+)/);
            if (!match)
                return;
            const [, ownerDid, collection, rkey] = match;
            const postResponse = await agent.api.com.atproto.repo.getRecord({
                repo: ownerDid,
                collection: collection,
                rkey: rkey,
            });
            posts.push({
                uri: postUri,
                rkey: rkey,
                ...postResponse.data.value,
                authorDid: ownerDid,
            });
        }
        catch (err) {
            console.warn(`Failed to fetch post ${idx.value.postUri}:`, err);
            // Post may be deleted or repo unavailable - skip it
        }
    }));
    return posts;
}
/**
 * Fetch posts with backward compatibility for legacy posts
 */
async function fetchGroupPostsWithLegacy(agent, communityDid, filter) {
    // Fetch new-style posts (from user repos via index)
    const newPosts = await fetchGroupPosts(agent, communityDid, filter);
    // Fetch old-style posts (from community repo directly)
    let oldPosts = [];
    try {
        const allOldPosts = await opensocial.listAllCommunityRecords(communityDid, COL_GROUP_POST_LEGACY);
        oldPosts = allOldPosts
            .filter((r) => {
            if (filter.segmentUri && r.value.segmentUri !== filter.segmentUri)
                return false;
            if (filter.listItemUri && r.value.listItemUri !== filter.listItemUri)
                return false;
            return true;
        })
            .map((r) => ({
            uri: r.uri,
            rkey: rkeyFromUri(r.uri),
            ...r.value,
            isLegacy: true,
        }));
    }
    catch (err) {
        console.warn('Failed to fetch legacy posts:', err);
        // If legacy collection doesn't exist yet, that's okay
    }
    // Combine and sort by date
    return [...newPosts, ...oldPosts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
/**
 * Build threaded post tree
 */
function buildThreads(posts) {
    const sorted = posts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const topLevel = sorted.filter((p) => !p.parentPostUri);
    const replies = sorted.filter((p) => p.parentPostUri);
    const buildThread = (post) => ({
        ...post,
        replies: replies
            .filter((r) => r.parentPostUri === post.uri)
            .map(buildThread),
    });
    return topLevel.map(buildThread);
}
/**
 * Delete a post (user-initiated)
 */
async function deleteGroupPost(agent, postUri) {
    const match = postUri.match(/at:\/\/([^\/]+)\/([^\/]+)\/(.+)/);
    if (!match)
        throw new Error('Invalid post URI');
    const [, ownerDid, collection, rkey] = match;
    if (agent.did !== ownerDid) {
        throw new Error('You can only delete your own posts');
    }
    await agent.api.com.atproto.repo.deleteRecord({
        repo: agent.did,
        collection: collection,
        rkey: rkey,
    });
}
/**
 * Mark post as deleted by admin (moderation)
 */
async function adminDeleteGroupPost(communityDid, userDid, postUri) {
    // Find the index entry for this post
    const allIndexes = await opensocial.listAllCommunityRecords(communityDid, COL_POST_INDEX);
    const indexEntry = allIndexes.find((idx) => idx.value.postUri === postUri);
    if (!indexEntry) {
        throw new Error('Post index not found');
    }
    // Update index to mark as deleted
    const updatedRecord = {
        ...indexEntry.value,
        deletedByAdmin: true,
    };
    const rkey = indexEntry.uri.split('/').pop();
    await opensocial.updateCommunityRecord(communityDid, userDid, COL_POST_INDEX, rkey, updatedRecord);
}
