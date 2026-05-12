import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { IncomingMessage, ServerResponse, createServer } from 'http';
import { registerLibraryTools } from './tools/library.js';
import { registerSegmentTools } from './tools/segments.js';
import { registerSearchTools } from './tools/search.js';
import { CollectiveClient } from './client.js';
import { loadConfig } from './config.js';
import { authMiddleware, loadAuthConfig } from './auth.js';

const config = loadConfig();
const authConfig = loadAuthConfig();
const checkAuth = authMiddleware(authConfig);

const client = new CollectiveClient({
  baseUrl: config.collectiveApiUrl,
  token: config.collectiveApiToken,
});

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'collective-social', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  registerSearchTools(server, client);
  registerLibraryTools(server, client);
  registerSegmentTools(server, client);

  return server;
}

// Track active SSE sessions for message routing
const activeSessions = new Map<string, SSEServerTransport>();

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const httpServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth check (skips /health and OPTIONS)
  if (!checkAuth(req, res)) return;

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'collective-mcp' }));
    return;
  }

  // SSE endpoint — client connects here to establish stream
  if (req.method === 'GET' && req.url === '/sse') {
    const mcpServer = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);

    activeSessions.set(transport.sessionId, transport);

    transport.onclose = () => {
      activeSessions.delete(transport.sessionId);
    };

    await mcpServer.connect(transport);
    await transport.start();
    return;
  }

  // Message endpoint — client POSTs JSON-RPC messages here
  if (req.method === 'POST' && req.url?.startsWith('/messages')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
      return;
    }

    const transport = activeSessions.get(sessionId);
    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const body = await parseBody(req);
    await transport.handlePostMessage(req, res, body);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const port = config.port;
httpServer.listen(port, () => {
  console.log(`Collective MCP server listening on port ${port}`);
  console.log(`  API URL: ${config.collectiveApiUrl}`);
  console.log(`  SSE endpoint: GET /sse`);
  console.log(`  Message endpoint: POST /messages?sessionId=...`);
  console.log(
    `  Auth: ${authConfig.requireAuth ? 'enabled' : 'disabled (dev mode)'}`
  );
});
