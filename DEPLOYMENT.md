# Deployment Guide

## Environment Variables

All required environment variables for production deployment:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Set to `production` for deployment |
| `PORT` | No | `3000` | HTTP port the server listens on |
| `DATABASE_URL` | **Yes (prod)** | localhost in dev | PostgreSQL connection string |
| `SERVICE_URL` | **Yes (prod)** | `undefined` | Public URL of this API (e.g. `https://api.collectivesocial.app`) |
| `CLIENT_URL` | **Yes (prod)** | `http://127.0.0.1:5173` | Public URL of the web client |
| `COOKIE_SECRET` | **Yes** | insecure default (dev only) | 32+ character secret for signing session cookies |
| `PRIVATE_KEYS` | **Yes (prod)** | `[]` | JSON array of JWK private keys for ATProto OAuth |
| `PDS_URL` | No | `https://bsky.social` | ATProto PDS service URL |
| `PLC_URL` | No | `https://plc.directory` | ATProto PLC directory URL |
| `FIREHOSE_URL` | No | `wss://bsky.social/xrpc/com.atproto.sync.firehose` | ATProto firehose URL |
| `OMDB_API_KEY` | No | `''` | OMDB API key for movie/TV metadata |
| `OPENLIBRARY_USER_AGENT` | No | `CollectiveSocial.app/1.0 (...)` | User-Agent for OpenLibrary API |
| `OPENSOCIAL_API_URL` | No | `http://127.0.0.1:3001` | OpenSocial API base URL |
| `OPENSOCIAL_API_KEY` | No | `''` | OpenSocial API authentication key |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |

## First Deployment Checklist

1. **Generate JWK keys** for ATProto OAuth:
   ```bash
   node bin/gen-jwk
   ```
   Set the output as the `PRIVATE_KEYS` environment variable.

2. **Set up PostgreSQL** — ensure a database exists and `DATABASE_URL` points to it.

3. **Set secure `COOKIE_SECRET`** — at least 32 characters, random. The server will refuse to start in production with insecure defaults.

4. **Database migrations** run automatically on startup via `migrateToLatest()`.

5. **Build the application**:
   ```bash
   npm run build
   ```

6. **Start in production**:
   ```bash
   NODE_ENV=production node dist/index.js
   ```

## Health Check

The `/health` endpoint returns `200 OK` when the server is ready:
```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` signals, closing the HTTP server and database connections cleanly. Container orchestrators (Docker, Kubernetes) will send `SIGTERM` on shutdown.

## Docker

Build and run using the provided Dockerfile:
```bash
docker build -t collective-social-api .
docker run -p 3000:3000 --env-file .env collective-social-api
```

Or use docker-compose for the full stack:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Architecture

- **Express 5** HTTP server with TypeScript
- **PostgreSQL** via Kysely (type-safe query builder) for shared/aggregated data
- **ATProto PDS** repos for user-owned data (lists, items, reviews, segments)
- **OpenSocial API** for community/group management
- **Iron-session** cookies + ATProto OAuth for authentication
