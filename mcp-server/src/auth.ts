/**
 * OAuth 2.1 Authorization for the Collective MCP Server.
 *
 * Architecture:
 * - MCP clients authenticate with this server using OAuth 2.1 Bearer tokens
 * - This server authenticates with the Collective API using a service token
 * - User's ATProto credentials are never exposed to MCP clients
 *
 * For the initial implementation, we use a simpler token-based auth:
 * - The MCP server is configured with a COLLECTIVE_API_TOKEN (user's session token)
 * - MCP clients authenticate using a shared secret (MCP_AUTH_TOKEN)
 *
 * Phase 3 will implement full OAuth 2.1 with:
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Code + PKCE flow
 * - Scoped permissions (library:read, library:write, segments:read, segments:write)
 * - Token rotation and expiration
 * - Server Metadata Discovery (RFC 8414)
 */

import { IncomingMessage, ServerResponse } from 'http';

export interface AuthConfig {
  /** Shared secret for MCP client authentication. Required in production. */
  mcpAuthToken?: string;
  /** Whether auth is required (disabled in development by default) */
  requireAuth: boolean;
}

export function loadAuthConfig(): AuthConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const mcpAuthToken = process.env.MCP_AUTH_TOKEN;

  if (nodeEnv === 'production' && !mcpAuthToken) {
    throw new Error(
      'MCP_AUTH_TOKEN must be set in production. This token authenticates MCP clients.'
    );
  }

  return {
    mcpAuthToken,
    requireAuth: nodeEnv === 'production' || !!mcpAuthToken,
  };
}

/**
 * Validates the Authorization header on incoming MCP requests.
 * Returns true if authorized, false otherwise.
 */
export function validateMcpAuth(
  req: IncomingMessage,
  authConfig: AuthConfig
): boolean {
  if (!authConfig.requireAuth) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  return token === authConfig.mcpAuthToken;
}

/**
 * Middleware that rejects unauthorized requests with 401.
 */
export function authMiddleware(
  authConfig: AuthConfig
): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    // Skip auth for health checks and OPTIONS
    if (req.url === '/health' || req.method === 'OPTIONS') {
      return true;
    }

    if (!validateMcpAuth(req, authConfig)) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="collective-mcp"',
      });
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Valid Bearer token required. Set MCP_AUTH_TOKEN.',
        })
      );
      return false;
    }

    return true;
  };
}
