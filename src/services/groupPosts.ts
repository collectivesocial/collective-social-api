import { Agent } from '@atproto/api';
import { TID } from '@atproto/common';
import * as opensocial from './opensocial';
import { config } from '../config';

const COL_GROUP_POST_PERSONAL = 'app.collectivesocial.feed.grouppost';
const COL_POST_INDEX = 'app.collectivesocial.group.postindex';
const COL_GROUP_POST_LEGACY = 'app.collectivesocial.group.post';

export interface GroupPost {
  uri: string;
  rkey: string;
  text: string;
  groupDid?: string;
  segmentUri?: string;
  listItemUri?: string;
  parentPostUri?: string;
  authorDid: string;
  mentionedDids?: string[];
  createdAt: string;
  replies?: GroupPost[];
  isLegacy?: boolean;
}

/**
 * Resolve the PDS endpoint for a DID by fetching its DID document.
 * Handles did:plc (via PLC directory) and did:web (via .well-known).
 */
export async function resolvePdsUrl(did: string): Promise<string> {
  let docUrl: string;
  if (did.startsWith('did:web:')) {
    const host = did.replace('did:web:', '');
    docUrl = `https://${host}/.well-known/did.json`;
  } else {
    docUrl = `${config.plcUrl}/${did}`;
  }

  const res = await fetch(docUrl);
  if (!res.ok) {
    throw new Error(`Failed to resolve DID document for ${did}: ${res.status}`);
  }
  const doc = (await res.json()) as any;

  const pdsService = doc.service?.find(
    (s: any) =>
      s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  if (!pdsService?.serviceEndpoint) {
    throw new Error(`No PDS service endpoint found in DID document for ${did}`);
  }
  return pdsService.serviceEndpoint;
}

/**
 * Extract rkey from AT-URI
 */
function rkeyFromUri(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1];
}

/**
 * Create a new group post using dual-storage pattern
 */
export async function createGroupPost(
  agent: Agent,
  userDid: string,
  communityDid: string,
  data: {
    text: string;
    segmentUri?: string;
    listItemUri?: string;
    parentPostUri?: string;
    mentionedDids?: string[];
  }
): Promise<{ postUri: string; indexUri: string }> {
  const now = new Date().toISOString();
  const rkey = TID.nextStr();

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
    repo: agent.did!,
    collection: COL_GROUP_POST_PERSONAL,
    rkey: rkey,
    record: postRecord as any,
  });

  // 2. Create index entry in community repo with a strongRef (post.uri + post.cid)
  const indexRecord = {
    post: {
      uri: postResponse.data.uri,
      cid: postResponse.data.cid,
    },
    authorDid: userDid,
    segmentUri: data.segmentUri || undefined,
    listItemUri: data.listItemUri || undefined,
    parentPostUri: data.parentPostUri || undefined,
    deletedByAdmin: false,
    createdAt: now,
  };

  const indexResponse = await opensocial.createCommunityRecord(
    communityDid,
    userDid,
    COL_POST_INDEX,
    indexRecord
  );

  return {
    postUri: postResponse.data.uri,
    indexUri: indexResponse.uri,
  };
}

/**
 * Fetch posts for a segment/item from user repos via index
 */
export async function fetchGroupPosts(
  agent: Agent,
  communityDid: string,
  filter: { segmentUri?: string; listItemUri?: string }
): Promise<GroupPost[]> {
  // 1. Query index from community repo
  const allIndexes = await opensocial.listAllCommunityRecords(
    communityDid,
    COL_POST_INDEX
  );

  // 2. Filter by segment/item and non-deleted
  const relevantIndexes = allIndexes.filter((idx: any) => {
    const val = idx.value;
    if (val.deletedByAdmin) return false;
    if (filter.segmentUri && val.segmentUri !== filter.segmentUri) return false;
    if (filter.listItemUri && val.listItemUri !== filter.listItemUri)
      return false;
    return true;
  });

  // 3. Fetch actual posts from author PDS endpoints in parallel
  const posts: GroupPost[] = [];
  await Promise.all(
    relevantIndexes.map(async (idx: any) => {
      try {
        const postUri = idx.value.post.uri;
        const match = postUri.match(/at:\/\/([^\/]+)\/([^\/]+)\/(.+)/);
        if (!match) return;

        const [, ownerDid, collection, rkey] = match;

        // Resolve the author's PDS and fetch the record directly.
        // Group posts are public, so no auth is needed. This works
        // regardless of which PDS the requesting user is on.
        const pdsUrl = await resolvePdsUrl(ownerDid);
        const getRecordUrl = new URL(
          '/xrpc/com.atproto.repo.getRecord',
          pdsUrl
        );
        getRecordUrl.searchParams.set('repo', ownerDid);
        getRecordUrl.searchParams.set('collection', collection);
        getRecordUrl.searchParams.set('rkey', rkey);

        const postRes = await fetch(getRecordUrl.toString());
        if (!postRes.ok) {
          console.warn(`PDS returned ${postRes.status} for ${postUri}`);
          return;
        }
        const postData = (await postRes.json()) as any;

        posts.push({
          uri: postUri,
          rkey: rkey,
          ...(postData.value as any),
          authorDid: ownerDid,
        });
      } catch (err) {
        console.warn(`Failed to fetch post ${idx.value.post?.uri}:`, err);
        // Post may be deleted or repo unavailable - skip it
      }
    })
  );

  return posts;
}

/**
 * Fetch posts with backward compatibility for legacy posts
 */
export async function fetchGroupPostsWithLegacy(
  agent: Agent,
  communityDid: string,
  filter: { segmentUri?: string; listItemUri?: string }
): Promise<GroupPost[]> {
  // Fetch new-style posts (from user repos via index)
  const newPosts = await fetchGroupPosts(agent, communityDid, filter);

  // Fetch old-style posts (from community repo directly)
  let oldPosts: GroupPost[] = [];
  try {
    const allOldPosts = await opensocial.listAllCommunityRecords(
      communityDid,
      COL_GROUP_POST_LEGACY
    );

    oldPosts = allOldPosts
      .filter((r: any) => {
        if (filter.segmentUri && r.value.segmentUri !== filter.segmentUri)
          return false;
        if (filter.listItemUri && r.value.listItemUri !== filter.listItemUri)
          return false;
        return true;
      })
      .map((r: any) => ({
        uri: r.uri,
        rkey: rkeyFromUri(r.uri),
        ...r.value,
        isLegacy: true,
      }));
  } catch (err) {
    console.warn('Failed to fetch legacy posts:', err);
    // If legacy collection doesn't exist yet, that's okay
  }

  // Combine and sort by date
  return [...newPosts, ...oldPosts].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Build threaded post tree
 */
export function buildThreads(posts: GroupPost[]): GroupPost[] {
  const sorted = posts.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const topLevel = sorted.filter((p) => !p.parentPostUri);
  const replies = sorted.filter((p) => p.parentPostUri);

  const buildThread = (post: GroupPost): GroupPost => ({
    ...post,
    replies: replies
      .filter((r) => r.parentPostUri === post.uri)
      .map(buildThread),
  });

  return topLevel.map(buildThread);
}

/**
 * Delete a post (user-initiated).
 * Removes the post from the user's personal repo and cleans up the orphaned
 * postindex pointer in the community repo (A.4).
 */
export async function deleteGroupPost(
  agent: Agent,
  postUri: string,
  communityDid: string,
  userDid: string
): Promise<void> {
  const match = postUri.match(/at:\/\/([^\/]+)\/([^\/]+)\/(.+)/);
  if (!match) throw new Error('Invalid post URI');

  const [, ownerDid, collection, rkey] = match;

  if (agent.did !== ownerDid) {
    throw new Error('You can only delete your own posts');
  }

  // 1. Delete from user's personal PDS
  await agent.api.com.atproto.repo.deleteRecord({
    repo: agent.did!,
    collection: collection,
    rkey: rkey,
  });

  // 2. Find and delete the postindex pointer from the community repo
  try {
    const allIndexes = await opensocial.listAllCommunityRecords(
      communityDid,
      COL_POST_INDEX
    );
    const indexEntry = allIndexes.find(
      (idx: any) => idx.value.post?.uri === postUri
    );
    if (indexEntry) {
      const indexRkey = indexEntry.uri.split('/').pop()!;
      await opensocial.deleteCommunityRecord(
        communityDid,
        userDid,
        COL_POST_INDEX,
        indexRkey
      );
    }
  } catch (err) {
    // Pass postUri as structured data rather than interpolating into the message
    // to avoid CodeQL CWE-134 (externally-controlled format string).
    console.warn(
      'Failed to clean up postindex — pointer may be orphaned:',
      { postUri },
      err
    );
    // Non-fatal: the user-PDS record is already gone; the stale pointer will
    // be silently skipped by fetchGroupPosts (getRecord will 404 and be dropped).
  }
}

/**
 * Mark post as deleted by admin (moderation)
 */
export async function adminDeleteGroupPost(
  communityDid: string,
  userDid: string,
  postUri: string
): Promise<void> {
  // Find the index entry for this post
  const allIndexes = await opensocial.listAllCommunityRecords(
    communityDid,
    COL_POST_INDEX
  );

  const indexEntry = allIndexes.find(
    (idx: any) => idx.value.post?.uri === postUri
  );
  if (!indexEntry) {
    throw new Error('Post index not found');
  }

  // Update index to mark as deleted
  const updatedRecord = {
    ...indexEntry.value,
    deletedByAdmin: true,
  };

  const rkey = indexEntry.uri.split('/').pop();
  await opensocial.updateCommunityRecord(
    communityDid,
    userDid,
    COL_POST_INDEX,
    rkey!,
    updatedRecord
  );
}
