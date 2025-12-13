import { Agent } from '@atproto/api';
import type { Logger } from 'pino';

/**
 * Fetch user handles for a list of DIDs using an authenticated agent
 * @param agent - Authenticated ATProto agent
 * @param dids - Array of DIDs to fetch handles for
 * @param logger - Optional logger for warnings
 * @returns Map of DID to handle
 */
export async function fetchUserHandles(
  agent: Agent,
  dids: string[],
  logger?: Logger
): Promise<Map<string, string>> {
  const userHandles = new Map<string, string>();

  await Promise.all(
    dids.map(async (did) => {
      try {
        const profile = await agent.getProfile({ actor: did });
        userHandles.set(did, profile.data.handle);
      } catch (err) {
        logger?.warn({ did, err }, 'Failed to lookup user handle');
      }
    })
  );

  return userHandles;
}
