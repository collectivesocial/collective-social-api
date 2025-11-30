# Copilot Instructions - Collective Social API

## Project Overview

Express.js + TypeScript backend API for Collective Social, a book/media tracking and review platform with ATProto/Bluesky integration.

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL with Kysely query builder (v0.28.8)
- **Authentication**: ATProto OAuth (@atproto/oauth-client-node)
- **Session Management**: iron-session
- **Logging**: Pino

## Project Structure

```
src/
├── config.ts              # Environment configuration with envalid
├── context.ts             # App context initialization (DB, OAuth, logger)
├── db.ts                  # Database setup and migrations
├── index.ts               # Express app entry point
├── auth/
│   └── client.ts          # OAuth client setup
├── models/                # TypeScript interfaces for DB tables
│   ├── book.ts
│   ├── group.ts
│   ├── list.ts
│   ├── media.ts
│   └── user.ts
├── routes/                # Express route handlers
│   ├── admin.ts
│   ├── auth.ts
│   ├── collections.ts     # Main logic for reviews, ratings, collections
│   ├── feedback.ts
│   ├── feed.ts
│   ├── media.ts          # Media item CRUD operations
│   ├── share.ts
│   └── user.ts
└── middleware/
    └── trackUserActivity.ts
```

## Database & Migrations

### Migration System

- **Auto-run**: Migrations run automatically on server startup via `migrateToLatest(db)` in `createAppContext()`
- **Location**: All migrations defined in `src/db.ts` in the `migrations` object
- **Naming**: Sequential numbering: `migrations['001']`, `migrations['002']`, etc.
- **Structure**: Each migration has `up` and `down` functions
- **No CLI**: There's no separate migration command - just restart the server

### Creating a New Migration

```typescript
migrations['013'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('table_name')
      .addColumn('new_column', 'type', (col) => col.notNull().defaultTo(value))
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('table_name').dropColumn('new_column').execute();
  },
};
```

### Kysely Query Patterns

#### Basic Queries

```typescript
// Select with where clause
const items = await ctx.db
  .selectFrom('media_items')
  .selectAll()
  .where('id', '=', itemId)
  .execute();

// Insert with returning
const result = await ctx.db
  .insertInto('reviews')
  .values({ ... })
  .returning('id')
  .executeTakeFirstOrThrow();

// Update
await ctx.db
  .updateTable('media_items')
  .set({ totalRatings: newTotal })
  .where('id', '=', itemId)
  .execute();
```

#### Advanced Patterns

```typescript
// Upsert (INSERT ... ON CONFLICT)
await ctx.db
  .insertInto('reviews')
  .values({ ... })
  .onConflict((oc) =>
    oc.columns(['authorDid', 'mediaItemId', 'mediaType'])
      .doUpdateSet({ rating: newRating, updatedAt: new Date() })
  )
  .execute();

// Raw SQL for dynamic column names
const columnName = getRatingColumnName(rating);
await ctx.db
  .updateTable('media_items')
  .set({
    [columnName]: sql`"${sql.raw(columnName)}" + 1`
  } as any)
  .where('id', '=', itemId)
  .execute();

// Aggregation
const count = await ctx.db
  .selectFrom('reviews')
  .select(({ fn }) => [fn.countAll().as('count')])
  .where('authorDid', '=', did)
  .executeTakeFirst();
```

#### Important Kysely Notes

- Use `sql` tagged template for raw SQL: `import { sql } from 'kysely'`
- Use `sql.raw()` to escape identifiers in raw SQL
- There is NO `ctx.db.raw()` method - this doesn't exist in Kysely
- Cast dynamic objects with `as any` when using computed keys
- Use `executeTakeFirst()` for single results (returns undefined if not found)
- Use `executeTakeFirstOrThrow()` when you expect a result

## ATProto/Bluesky Integration

### Authentication Flow

1. User initiates OAuth via `/auth/login`
2. Callback handled at `/auth/callback`
3. Session stored using iron-session
4. Agent created from session: `ctx.oauthClient.restore(sessionId)`

### Common ATProto Operations

```typescript
// Get authenticated agent from session
const agent = await ctx.oauthClient.restore(req.session.sessionId);

// Get profile
const profile = await agent.getProfile({ actor: agent.did });

// List records (collections)
const response = await agent.api.com.atproto.repo.listRecords({
  repo: agent.did,
  collection: 'app.collectivesocial.feed.list',
});

// Put record (create/update)
await agent.api.com.atproto.repo.putRecord({
  repo: agent.did,
  collection: 'app.collectivesocial.feed.listitem',
  rkey: rkey,
  record: recordData,
});

// Delete record
await agent.api.com.atproto.repo.deleteRecord({
  repo: agent.did,
  collection: 'app.collectivesocial.feed.listitem',
  rkey: rkey,
});
```

### ATProto Record Structure

- **Collections**: `app.collectivesocial.feed.list` (user's reading lists)
- **List Items**: `app.collectivesocial.feed.listitem` (items in a list)
- Each record has `uri`, `cid`, and `value` (the actual data)
- `rkey` is the record key (unique identifier within a collection)

## Key Domain Logic

### Rating System

- **Range**: 0-5 stars in 0.5 increments (11 possible values: 0, 0.5, 1, 1.5, ..., 5)
- **Distribution Tracking**: Each rating value has its own column in `media_items` table
  - Columns: `rating0`, `rating0_5`, `rating1`, `rating1_5`, etc.
  - Helper function: `getRatingColumnName(rating)` converts `2.5` → `"rating2_5"`
- **Aggregates**: `totalRatings` (all ratings), `totalReviews` (text reviews), `averageRating`
- **Updates**: When rating changes, decrement old column, increment new column

### Review Logic (`routes/collections.ts`)

Three scenarios handled:

1. **New Review**: Increment `totalRatings`, `totalReviews`, rating distribution column
2. **Update Review**: Adjust rating distribution if rating changed, adjust `totalReviews` if text added/removed
3. **Delete Review**: Decrement `totalRatings`, `totalReviews`, rating distribution column

### Media Items

- **Types**: `book`, `movie`, `tv`, `music`, `game`, etc.
- **External IDs**: ISBN for books, TMDB IDs for movies/TV
- **Cover Images**: Stored as URLs (OpenLibrary for books)
- **Deduplication**: Books matched by ISBN, others by title+creator

### OpenLibrary Integration (`routes/media.ts`)

- Search: `https://openlibrary.org/search.json?q={query}&limit={limit}`
- Book details: `https://openlibrary.org/works/{workId}.json`
- Cover images: `https://covers.openlibrary.org/b/id/{coverId}-{size}.jpg`
- Description extraction handles multiple formats (string, object with value, etc.)

## API Patterns

### Error Handling

```typescript
// Use try-catch in route handlers
try {
  // ... logic
  res.json({ success: true });
} catch (err) {
  ctx.logger.error({ err }, 'Operation failed');
  res.status(500).json({ error: 'Error message' });
}
```

### Authentication Middleware

```typescript
// Routes requiring authentication should restore agent
const agent = await ctx.oauthClient.restore(req.session.sessionId);
if (!agent) {
  return res.status(401).json({ error: 'Not authenticated' });
}
```

### Response Patterns

- Success: `res.json({ data, ... })`
- Error: `res.status(code).json({ error: 'message' })`
- 401 for auth failures
- 404 for not found
- 500 for server errors

## Development Workflow

### Running the Server

```bash
npm run dev          # Start with nodemon (auto-reload)
npm start            # Production mode
npm run docker:up    # Start PostgreSQL via Docker
npm run docker:down  # Stop Docker containers
```

### Environment Variables (`.env`)

```
DATABASE_URL=postgresql://user:pass@localhost:5432/db
SERVICE_URL=http://localhost:3000
OAUTH_PUBLIC_URL=http://127.0.0.1:3000
OAUTH_CALLBACK_URL=http://127.0.0.1:3000/auth/callback
SESSION_SECRET=your-secret
PORT=3000
NODE_ENV=development
```

### Code Style

- **Formatting**: Prettier configured (see `package.json`)
- **Run formatter**: `npm run format`
- **Check formatting**: `npm run format:check`
- Use `async/await` over promises
- Prefer `const` over `let`

## Common Tasks

### Adding a New Endpoint

1. Add route handler in appropriate file in `routes/`
2. Mount router in `src/index.ts` if new router created
3. Use `handler()` wrapper for async routes (if defined)
4. Access context via `ctx` parameter: `ctx.db`, `ctx.logger`, `ctx.oauthClient`

### Adding a New Database Column

1. Add migration in `src/db.ts` with next sequential number
2. Update TypeScript interface in `src/models/`
3. Restart server to run migration
4. Update relevant queries to include new column

### Working with Sessions

```typescript
// Store data
req.session.userId = user.id;
await req.session.save();

// Read data
const userId = req.session.userId;

// Clear session
req.session.destroy();
```

## Important Gotchas

1. **Migrations**: Always create both `up` and `down` - they run on startup automatically
2. **Kysely**: Use `sql` tagged template, NOT `ctx.db.raw()`
3. **Type Casting**: Use `as any` when Kysely can't infer types for dynamic operations
4. **ATProto Records**: Always provide `collection` and `repo` (usually `agent.did`)
5. **Rating Columns**: Use `getRatingColumnName()` helper for dynamic column names
6. **Decimal Handling**: PostgreSQL `numeric` types come back as strings - use `parseFloat()`
7. **Session**: `iron-session` requires calling `save()` after modifications
8. **CORS**: Configured for `http://127.0.0.1:5173` (Vite dev server)

## Testing

Currently no automated tests. Manual testing via:

- API client (Postman, Insomnia, etc.)
- Frontend application
- Direct PostgreSQL queries

## Admin Features

- Admin status stored in `users` table (`is_admin` column)
- Set admin via script: `npm run make-admin`
- Admin routes in `routes/admin.ts`
- Check admin status: Query `users` table by `did`
