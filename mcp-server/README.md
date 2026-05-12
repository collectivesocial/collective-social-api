# Collective MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes Collective Social's library and group features as tools for AI assistants.

## What it does

Enables AI assistants to manage a user's reading/watching library and track book club progress:

- **Search** Collective's media database (books, articles, videos, etc.)
- **Add items** to your library with a status (want, in-progress, completed)
- **Update status** — mark items as in-progress or completed
- **Track book club segments** — see upcoming due dates, mark segments as done
- **List your library** — filtered by type or status

## Architecture

```
┌─────────────┐     Bearer token    ┌─────────────────┐    Session cookie    ┌──────────────┐
│  MCP Client │ ◄──────────────►    │  MCP Server     │ ◄───────────────►    │ Collective   │
│  (AI Agent) │                     │  (this service)  │                     │ API + PDS    │
└─────────────┘                     └─────────────────┘                     └──────────────┘
```

The MCP server is a thin stateless layer that translates MCP tool calls into Collective API requests. It never accesses the database directly — all operations go through the Collective API, which handles ATProto writes, validation, and business logic.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Collective API URL and auth token

# Development
npm run dev

# Production
npm run build
npm start
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `COLLECTIVE_API_URL` | Yes | Base URL of the Collective API (e.g., `https://api.collectivesocial.app`) |
| `COLLECTIVE_API_TOKEN` | Yes | Bearer token for authenticating with the Collective API |
| `MCP_PORT` | No | Port to listen on (default: 3100) |
| `MCP_AUTH_TOKEN` | Prod | Token that MCP clients must provide to authenticate |
| `MCP_ALLOWED_ORIGINS` | No | CORS allowed origins (default: `*`) |

## Available Tools

### Library Management

| Tool | Description |
|------|-------------|
| `search_media` | Search by title, creator, keyword. Filter by media type. |
| `add_to_library` | Add an item to your library (creates media record if needed) |
| `update_item_status` | Change status to want/in-progress/completed, add rating or notes |
| `list_library` | List your library items, filterable by status and type |

### Book Club / Segments

| Tool | Description |
|------|-------------|
| `list_group_memberships` | See your book clubs and groups |
| `list_upcoming_segments` | Upcoming reading assignments with due dates |
| `get_segment_progress` | Check if a segment is completed |
| `complete_segment` | Mark a segment as done (updates group roster + personal progress) |

## Authentication

### Current (Phase 1)

Simple Bearer token auth. The MCP server authenticates with the Collective API using a configured session token, and MCP clients authenticate with the MCP server using `MCP_AUTH_TOKEN`.

### Planned (Phase 3)

Full OAuth 2.1 per the [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization):

- Authorization Code + PKCE for user consent
- Dynamic Client Registration (RFC 7591)
- Scoped permissions (`library:read`, `library:write`, `segments:read`, `segments:write`)
- Server Metadata Discovery (RFC 8414)
- Token rotation and expiration

## Connecting to an AI Assistant

### Claude Desktop / Copilot / etc.

Add to your MCP client config:

```json
{
  "mcpServers": {
    "collective": {
      "url": "http://localhost:3100/mcp",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

## Development

```bash
# Run in watch mode
npm run dev

# Build
npm run build

# The server exposes:
# - GET  /health     — health check
# - GET  /mcp        — SSE transport endpoint
# - POST /mcp/messages — message endpoint for SSE transport
```

## Related

- [Issue #57](https://github.com/collectivesocial/collective-social-api/issues/57) — Original feature request
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26)
- [Collective Social](https://collectivesocial.app)
