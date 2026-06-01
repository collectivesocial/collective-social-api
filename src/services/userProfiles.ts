import { Agent } from '@atproto/api';

export interface UserProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

// Shared agent for public API calls (reused across requests)
const publicAgent = new Agent({ service: 'https://public.api.bsky.app' });

/**
 * Fetch user profiles for multiple DIDs using batch API.
 * Uses getProfiles (max 25 per call) instead of individual getProfile calls
 * to eliminate N+1 network overhead.
 */
export async function enrichWithUserProfiles(
  dids: string[]
): Promise<Record<string, UserProfile>> {
  const uniqueDids = [...new Set(dids)];
  const profiles: Record<string, UserProfile> = {};

  // getProfiles accepts max 25 actors per call
  const BATCH_SIZE = 25;
  const batches: string[][] = [];
  for (let i = 0; i < uniqueDids.length; i += BATCH_SIZE) {
    batches.push(uniqueDids.slice(i, i + BATCH_SIZE));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await publicAgent.app.bsky.actor.getProfiles({
          actors: batch,
        });
        for (const profile of response.data.profiles) {
          profiles[profile.did] = {
            did: profile.did,
            handle: profile.handle,
            displayName: profile.displayName || undefined,
            avatar: profile.avatar || undefined,
          };
        }
      } catch (err) {
        console.warn(`Failed to batch fetch profiles:`, err);
        // Fall back to individual lookups for this batch
        for (const did of batch) {
          if (!profiles[did]) {
            profiles[did] = {
              did,
              handle: did.slice(0, 20) + '…',
            };
          }
        }
      }
    })
  );

  // Ensure all DIDs have at least a fallback entry
  for (const did of uniqueDids) {
    if (!profiles[did]) {
      profiles[did] = {
        did,
        handle: did.slice(0, 20) + '…',
      };
    }
  }

  return profiles;
}

/**
 * Extract all unique DIDs from a nested post tree
 */
export function extractDidsFromPosts(posts: any[]): string[] {
  const dids = new Set<string>();

  const addDids = (posts: any[]) => {
    for (const post of posts) {
      if (post.authorDid) dids.add(post.authorDid);
      if (post.replies) addDids(post.replies);
    }
  };

  addDids(posts);
  return Array.from(dids);
}

/**
 * Build threaded post tree with enriched user profiles
 */
export function buildThreadsWithProfiles(
  posts: any[],
  userProfiles: Record<string, UserProfile>
): any[] {
  const sorted = posts.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const topLevel = sorted.filter((p) => !p.parentPostUri);
  const replies = sorted.filter((p) => p.parentPostUri);

  const buildThread = (post: any): any => ({
    ...post,
    author: userProfiles[post.authorDid] || {
      did: post.authorDid,
      handle: post.authorDid.slice(0, 20) + '…',
    },
    replies: replies
      .filter((r) => r.parentPostUri === post.uri)
      .map(buildThread),
  });

  return topLevel.map(buildThread);
}
