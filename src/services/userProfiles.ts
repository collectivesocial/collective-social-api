import { Agent } from '@atproto/api';

export interface UserProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Fetch user profiles for multiple DIDs in parallel
 * Uses public Bluesky API (no auth needed)
 */
export async function enrichWithUserProfiles(
  dids: string[]
): Promise<Record<string, UserProfile>> {
  const uniqueDids = [...new Set(dids)];
  const profiles: Record<string, UserProfile> = {};

  await Promise.all(
    uniqueDids.map(async (did) => {
      try {
        const agent = new Agent({ service: 'https://public.api.bsky.app' });
        const profile = await agent.getProfile({ actor: did });
        profiles[did] = {
          did: profile.data.did,
          handle: profile.data.handle,
          displayName: profile.data.displayName || undefined,
          avatar: profile.data.avatar || undefined,
        };
      } catch (err) {
        console.warn(`Failed to fetch profile for ${did}:`, err);
        // Fallback to truncated DID if profile fetch fails
        profiles[did] = {
          did,
          handle: did.slice(0, 20) + '…',
        };
      }
    })
  );

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
