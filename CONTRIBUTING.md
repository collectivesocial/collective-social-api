# Contributing to Collective Social API

## Architecture Overview

Collective Social uses a dual-storage architecture:

| Data Type | Storage | Why |
|-----------|---------|-----|
| Media items, reviews, tags, share links, notifications | **PostgreSQL** | Shared/aggregated data |
| Lists, list items, user items, review segments, completions | **User's ATProto PDS** | User-owned data |
| Group lists, items, segments, posts, reactions | **Community PDS** (via OpenSocial) | Community-owned data |

### Directory Structure

```
src/
├── auth/          # Authentication (OAuth client, session config, agent helper)
├── lib/           # Shared utilities (HTTP helpers, string utils, user lookups)
├── middleware/     # Express middleware (activity tracker, error handler, request logger)
├── models/        # TypeScript type definitions for database tables
├── routes/        # Express route handlers (one file per resource)
├── services/      # External API clients (OpenSocial, OpenLibrary, OMDB)
├── lexicon/       # Auto-generated ATProto lexicon types (do not edit manually)
├── config.ts      # Environment variable configuration
├── context.ts     # Application context (DB, logger, OAuth client)
├── db.ts          # Database schema types and connection
├── migrations.ts  # Kysely database migrations
└── index.ts       # Entry point — Express app setup
```

## Adding a New Endpoint

1. **Create or update a route file** in `src/routes/`:
   - Export a `createRouter(ctx: AppContext)` function that returns an Express Router
   - Use the shared `getSessionAgent` from `src/auth/agent.ts` for authentication
   - Use the `handler()` wrapper from `src/lib/http.ts` for async route handlers
   - Use the shared `SESSION_OPTIONS` from `src/auth/session.ts` — never inline cookie config

2. **Mount the router** in `src/index.ts`

3. **Add database changes** as a new migration in `src/migrations.ts`:
   - Add a new numbered migration (e.g., `migrations['002']`)
   - Always include both `up` and `down` functions
   - Test the migration locally before committing

4. **Add types** to `src/db.ts` (`DatabaseSchema`) and the appropriate model file

5. **Write tests** in `test/` — at minimum, unit test any new utility functions

## Agent Update Guide

When using an AI coding agent to make changes to this codebase, provide this context:

### Key Patterns
- **Session handling**: Always use `SESSION_OPTIONS` from `src/auth/session.ts` — never create inline iron-session configs
- **Authentication**: Call `getSessionAgent(req, res, ctx)` from `src/auth/agent.ts` to get the authenticated user
- **Error handling**: Wrap async route handlers with `handler()` from `src/lib/http.ts`
- **Logging**: Use `ctx.logger` (Pino) — never use `console.log` or `console.error`
- **Database**: Use Kysely typed queries via `ctx.db` — avoid raw SQL unless necessary

### Common Pitfalls
- Don't duplicate `getSessionAgent` — import it from `src/auth/agent.ts`
- Don't hardcode URLs — use `config.clientUrl` and `config.serviceUrl`
- Don't add `console.log` — use `ctx.logger.info/warn/error` instead
- Don't cast with `as any` on Kysely queries — fix the types in `DatabaseSchema`
- Don't create new `Pool` or `Agent` instances per request — reuse from context

### Migration Numbering
Migrations in `src/migrations.ts` use zero-padded string keys: `'001'`, `'002'`, etc. Check the latest migration number before adding a new one.

### Testing
Run tests with `npm test`. Write tests in the `test/` directory. Use Vitest. The CI pipeline runs tests on push and PR.

## Code Style

- **TypeScript** with strict mode
- **Prettier** for formatting (`npm run format`)
- Use named exports, not default exports
- Use `camelCase` for functions/variables, `PascalCase` for types/classes
- Prefer `const` over `let`; avoid `var`
