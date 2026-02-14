"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.envalidJsonWebKeys = void 0;
const oauth_client_node_1 = require("@atproto/oauth-client-node");
const envalid_1 = require("envalid");
const zod_1 = require("zod");
const jsonWebKeySchema = zod_1.z.intersection(oauth_client_node_1.jwkValidator, zod_1.z.object({ kid: zod_1.z.string().nonempty() }));
const jsonWebKeysSchema = zod_1.z.array(jsonWebKeySchema).nonempty();
exports.envalidJsonWebKeys = (0, envalid_1.makeValidator)((input) => {
    const value = JSON.parse(input);
    return jsonWebKeysSchema.parse(value);
});
