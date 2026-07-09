import { Agent } from '@atproto/api';

/**
 * Shared unauthenticated agent for public reads (profiles, handle
 * resolution) against the Bluesky AppView. Profile/handle data is public,
 * so routing these lookups through the OAuth-session agent would only cost
 * extra granted scope for no benefit.
 */
export const publicAgent = new Agent({
  service: 'https://public.api.bsky.app',
});
