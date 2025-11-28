import {
  Keyset,
  JoseKey,
  atprotoLoopbackClientMetadata,
  NodeOAuthClient,
  OAuthClientMetadataInput,
} from '@atproto/oauth-client-node';
import assert from 'node:assert';

import type { Database } from '../db';
import { config } from '../config';
import { SessionStore, StateStore } from './storage';

export async function createOAuthClient(db: Database) {
  // Confidential client require a keyset accessible on the internet. Non
  // internet clients (e.g. development) cannot expose a keyset on the internet
  // so they can't be private..
  const keyset =
    config.serviceUrl && config.privateKeys
      ? new Keyset(
          await Promise.all(
            config.privateKeys.map((jwk: string | Record<string, unknown>) =>
              JoseKey.fromJWK(jwk)
            )
          )
        )
      : undefined;

  assert(
    !config.serviceUrl || keyset?.size,
    'ATProto requires backend clients to be confidential. Make sure to set the PRIVATE_KEYS environment variable.'
  );

  // If a keyset is defined (meaning the client is confidential). Let's make
  // sure it has a private key for signing. Note: findPrivateKey will throw if
  // the keyset does not contain a suitable private key.
  const pk = keyset?.findPrivateKey({ usage: 'sign' });

  const clientMetadata: OAuthClientMetadataInput = config.serviceUrl
    ? {
        client_name: 'Statusphere Example App',
        client_id: `${config.serviceUrl}/oauth-client-metadata.json`,
        jwks_uri: `${config.serviceUrl}/.well-known/jwks.json`,
        redirect_uris: [`${config.serviceUrl}/oauth/callback`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: pk ? 'private_key_jwt' : 'none',
        token_endpoint_auth_signing_alg: pk ? pk.alg : undefined,
        dpop_bound_access_tokens: true,
      }
    : atprotoLoopbackClientMetadata(
        `http://localhost?${new URLSearchParams([
          ['redirect_uri', `http://127.0.0.1:${config.port}/oauth/callback`],
          ['scope', `atproto transition:generic`],
        ])}`
      );

  return new NodeOAuthClient({
    keyset,
    clientMetadata,
    stateStore: new StateStore(db),
    sessionStore: new SessionStore(db),
    plcDirectoryUrl: config.plcUrl,
    handleResolver: config.pdsUrl,
  });
}
