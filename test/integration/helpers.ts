/**
 * Integration test helpers for collective-social-api.
 *
 * createTestApp()  — boots a minimal Express app wired to the real routes but
 *                    without starting a TCP listener (use supertest's request()).
 * createTestDb()   — connects to the test postgres via DATABASE_URL_TEST and
 *                    runs all Kysely migrations so the schema is up to date.
 * cleanupTables()  — truncates named tables between tests to keep state clean.
 */

import express from 'express';
import supertest from 'supertest';
import { pino } from 'pino';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../../src/db';
import { migrateToLatest } from '../../src/migrations';
import { createRouter as createGroupsRouter } from '../../src/routes/groups';
import type { AppContext } from '../../src/context';

// ── Test DB ───────────────────────────────────────────────────────────────────

export async function createTestDb(): Promise<Database> {
  const connectionString = process.env.DATABASE_URL_TEST;
  if (!connectionString) {
    throw new Error('DATABASE_URL_TEST env var is required for integration tests');
  }

  const db = new Kysely<import('../../src/db').DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: 5 }),
    }),
  }) as Database;

  await migrateToLatest(db);
  return db;
}

// ── Table cleanup ─────────────────────────────────────────────────────────────

export async function cleanupTables(
  db: Database,
  tableNames: string[]
): Promise<void> {
  for (const table of tableNames) {
    // RESTART IDENTITY resets serial PKs; CASCADE handles FK children.
    await db.executeQuery(
      // Raw SQL — Kysely doesn't have a first-class TRUNCATE builder.
      (db as any).schema
        .raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`)
        .compile()
        .catch(() => {
          // Fallback: just delete all rows if TRUNCATE isn't available via schema builder
        })
    ).catch(async () => {
      await (db as any)
        .deleteFrom(table as any)
        .execute()
        .catch(() => {
          /* table may not exist in this migration snapshot — ignore */
        });
    });
  }
}

// ── Minimal test app context ──────────────────────────────────────────────────

/**
 * Builds a fake AppContext with the real DB and no-op stubs for OAuth/logger.
 * The agent is always null (unauthenticated) unless the test monkey-patches
 * getSessionAgent via vi.mock.
 */
export function createFakeContext(db: Database): AppContext {
  return {
    db,
    logger: pino({ level: 'silent' }),
    oauthClient: {
      restore: async () => null,
    } as any,
    resolver: {} as any,
    destroy: async () => {
      await db.destroy();
    },
  };
}

// ── Express app factory ───────────────────────────────────────────────────────

export function createTestApp(ctx: AppContext): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/groups', createGroupsRouter(ctx));
  return app;
}

// ── Convenience re-export so tests can call request(app) ─────────────────────

export { supertest };
