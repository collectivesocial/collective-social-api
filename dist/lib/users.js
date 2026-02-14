"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUserHandles = fetchUserHandles;
/**
 * Fetch user handles for a list of DIDs using an authenticated agent
 * @param agent - Authenticated ATProto agent
 * @param dids - Array of DIDs to fetch handles for
 * @param logger - Optional logger for warnings
 * @returns Map of DID to handle
 */
async function fetchUserHandles(agent, dids, logger) {
    const userHandles = new Map();
    await Promise.all(dids.map(async (did) => {
        try {
            const profile = await agent.getProfile({ actor: did });
            userHandles.set(did, profile.data.handle);
        }
        catch (err) {
            logger?.warn({ did, err }, 'Failed to lookup user handle');
        }
    }));
    return userHandles;
}
