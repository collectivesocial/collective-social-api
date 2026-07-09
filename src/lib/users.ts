import type { Logger } from 'pino';
import { publicAgent } from './publicAgent';

/**
 * Fetch user handles for a list of DIDs. Uses the public AppView agent —
 * profile handles are public data, so no OAuth scope is needed for this.
 * @param dids - Array of DIDs to fetch handles for
 * @param logger - Optional logger for warnings
 * @returns Map of DID to handle
 */
export async function fetchUserHandles(
  dids: string[],
  logger?: Logger
): Promise<Map<string, string>> {
  const userHandles = new Map<string, string>();

  await Promise.all(
    dids.map(async (did) => {
      try {
        const profile = await publicAgent.getProfile({ actor: did });
        userHandles.set(did, profile.data.handle);
      } catch (err) {
        logger?.warn({ did, err }, 'Failed to lookup user handle');
      }
    })
  );

  return userHandles;
}
