import { config } from './config';
import { Pool } from 'pg';
import { AuthSession, AuthState } from './models/auth';
import { Review, Comment, React } from './models/content';
import { Group, GroupItem } from './models/group';
import { List, ListItem } from './models/list';
import { MediaItem } from './models/media';
import {
  Kysely,
  Migration,
  MigrationProvider,
  Migrator,
  PostgresDialect,
} from 'kysely';

export type DatabaseSchema = {
  auth_session: AuthSession;
  auth_state: AuthState;
  media_items: MediaItem;
};

// Migrations

const migrations: Record<string, Migration> = {};

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('auth_session')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('session', 'varchar', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('auth_state')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('state', 'varchar', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('review')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('stars', 'integer', (col) => col.notNull())
      .addColumn('percentComplete', 'integer', (col) => col.notNull())
      .addColumn('review', 'text')
      .addColumn('notes', 'text')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('comment')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('reviewUri', 'varchar', (col) => col.notNull())
      .addColumn('parentUri', 'varchar')
      .addColumn('comment', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('react')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('reaction', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('group')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('ownerDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('isPublic', 'boolean', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('group_item')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('groupUri', 'varchar', (col) => col.notNull())
      .addColumn('identifier', 'varchar', (col) => col.notNull())
      .addColumn('addedAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('list')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('isPublic', 'boolean', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
    await db.schema
      .createTable('list_item')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('listUri', 'varchar', (col) => col.notNull())
      .addColumn('itemUri', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('addedAt', 'timestamptz', (col) => col.notNull())
      .addColumn('indexedAt', 'timestamptz', (col) => col.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('react').execute();
    await db.schema.dropTable('comment').execute();
    await db.schema.dropTable('review').execute();
    await db.schema.dropTable('auth_state').execute();
    await db.schema.dropTable('auth_session').execute();
  },
};

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('media_items')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('mediaType', 'varchar', (col) => col.notNull())
      .addColumn('title', 'varchar', (col) => col.notNull())
      .addColumn('creator', 'varchar')
      .addColumn('isbn', 'varchar')
      .addColumn('externalId', 'varchar')
      .addColumn('coverImage', 'text')
      .addColumn('description', 'text')
      .addColumn('publishedYear', 'integer')
      .addColumn('totalReviews', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('averageRating', 'decimal(3, 2)')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    // Create indexes for common queries
    await db.schema
      .createIndex('media_items_isbn_idx')
      .on('media_items')
      .column('isbn')
      .execute();

    await db.schema
      .createIndex('media_items_type_idx')
      .on('media_items')
      .columns(['mediaType'])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('media_items').execute();
  },
};

// APIs

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: location,
      }),
    }),
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

export type Database = Kysely<DatabaseSchema>;

const pool = new Pool({
  connectionString: config.databaseUrl,
});

export default pool;
