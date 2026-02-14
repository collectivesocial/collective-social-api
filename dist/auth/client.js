"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOAuthClient = createOAuthClient;
const oauth_client_node_1 = require("@atproto/oauth-client-node");
const node_assert_1 = __importDefault(require("node:assert"));
const config_1 = require("../config");
const storage_1 = require("./storage");
async function createOAuthClient(db) {
    // Confidential client require a keyset accessible on the internet. Non
    // internet clients (e.g. development) cannot expose a keyset on the internet
    // so they can't be private..
    const keyset = config_1.config.serviceUrl && config_1.config.privateKeys
        ? new oauth_client_node_1.Keyset(await Promise.all(config_1.config.privateKeys.map((jwk) => oauth_client_node_1.JoseKey.fromJWK(jwk))))
        : undefined;
    (0, node_assert_1.default)(!config_1.config.serviceUrl || keyset?.size, 'ATProto requires backend clients to be confidential. Make sure to set the PRIVATE_KEYS environment variable.');
    // If a keyset is defined (meaning the client is confidential). Let's make
    // sure it has a private key for signing. Note: findPrivateKey will throw if
    // the keyset does not contain a suitable private key.
    const pk = keyset?.findPrivateKey({ usage: 'sign' });
    const clientMetadata = config_1.config.serviceUrl
        ? {
            client_name: 'Collective Social',
            client_id: `${config_1.config.serviceUrl}/oauth-client-metadata.json`,
            jwks_uri: `${config_1.config.serviceUrl}/.well-known/jwks.json`,
            redirect_uris: [`${config_1.config.serviceUrl}/oauth/callback`],
            scope: 'atproto transition:generic',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            application_type: 'web',
            token_endpoint_auth_method: pk ? 'private_key_jwt' : 'none',
            token_endpoint_auth_signing_alg: pk ? pk.alg : undefined,
            dpop_bound_access_tokens: true,
        }
        : (0, oauth_client_node_1.atprotoLoopbackClientMetadata)(`http://localhost?${new URLSearchParams([
            ['redirect_uri', `http://127.0.0.1:${config_1.config.port}/oauth/callback`],
            ['scope', `atproto transition:generic`],
        ])}`);
    return new oauth_client_node_1.NodeOAuthClient({
        keyset,
        clientMetadata,
        stateStore: new storage_1.StateStore(db),
        sessionStore: new storage_1.SessionStore(db),
        plcDirectoryUrl: config_1.config.plcUrl,
        handleResolver: config_1.config.pdsUrl,
    });
}
