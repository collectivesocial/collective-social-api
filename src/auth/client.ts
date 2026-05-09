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
import { COLLECTIVE_SCOPES } from './scopes';

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
        client_name: 'Collective Social',
        client_id: `${config.serviceUrl}/oauth-client-metadata.json`,
        jwks_uri: `${config.serviceUrl}/.well-known/jwks.json`,
        redirect_uris: [`${config.serviceUrl}/oauth/callback`],
        scope: COLLECTIVE_SCOPES,
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
          ['scope', COLLECTIVE_SCOPES],
        ])}`
      );

  return new NodeOAuthClient({
    keyset,
    clientMetadata,
    stateStore: new StateStore(db),
    sessionStore: new SessionStore(db),
    plcDirectoryUrl: config.plcUrl,
    // No handleResolver override — default AtprotoHandleResolverNode resolves
    // handles via DNS TXT records and HTTP well-known, supporting any PDS.
    allowHttp: config.nodeEnv === 'development',
  });
}
