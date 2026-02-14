"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBidirectionalResolver = createBidirectionalResolver;
function createBidirectionalResolver({ identityResolver, }) {
    return {
        async resolveDidToHandle(did) {
            try {
                const { handle } = await identityResolver.resolve(did);
                if (handle)
                    return handle;
            }
            catch {
                // Ignore
            }
        },
        async resolveDidsToHandles(dids) {
            const uniqueDids = [...new Set(dids)];
            return Object.fromEntries(await Promise.all(uniqueDids.map((did) => this.resolveDidToHandle(did).then((handle) => [did, handle]))));
        },
    };
}
