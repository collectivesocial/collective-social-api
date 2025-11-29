import { config } from './config';
import { Pool } from 'pg';
import { AuthSession, AuthState } from './models/auth';
import { Review, Comment, React } from './models/content';
import { Group, GroupItem } from './models/group';
import { List, ListItem } from './models/list';
import { MediaItem } from './models/media';
import { User } from './models/user';
import {
  Kysely,
  Migration,
  MigrationProvider,
  Migrator,
  PostgresDialect,
} from 'kysely';

export type PublicReview = {
  id: number;
  authorDid: string;
  mediaItemId: number;
  mediaType: string;
  rating: number;
  review: string;
  listItemUri: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Feedback = {
  id: number;
  userDid: string | null;
  email: string | null;
  message: string;
  status: string;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FeedEvent = {
  id: number;
  eventName: string;
  mediaLink: string | null;
  userDid: string;
  createdAt: Date;
};

export type DatabaseSchema = {
  auth_session: AuthSession;
  auth_state: AuthState;
  media_items: MediaItem;
  users: User;
  reviews: PublicReview;
  feedback: Feedback;
  feed_events: FeedEvent;
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

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('users')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('firstLoginAt', 'timestamptz', (col) => col.notNull())
      .addColumn('lastActivityAt', 'timestamptz', (col) => col.notNull())
      .addColumn('isAdmin', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('createdAt', 'timestamptz', (col) =>
        col.notNull().defaultTo('now()')
      )
      .addColumn('updatedAt', 'timestamptz', (col) =>
        col.notNull().defaultTo('now()')
      )
      .execute();

    // Create index for admin queries
    await db.schema
      .createIndex('users_is_admin_idx')
      .on('users')
      .column('isAdmin')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('users').execute();
  },
};

migrations['004'] = {
  async up(db: Kysely<unknown>) {
    // Remove notes column from review table (old schema)
    await db.schema.alterTable('review').dropColumn('notes').execute();

    // Create new reviews table for public reviews
    await db.schema
      .createTable('reviews')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('mediaItemId', 'integer', (col) => col.notNull())
      .addColumn('mediaType', 'varchar', (col) => col.notNull())
      .addColumn('rating', 'decimal(2, 1)', (col) => col.notNull())
      .addColumn('review', 'text', (col) => col.notNull())
      .addColumn('listItemUri', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    // Create unique index to enforce one review per user per media item
    await db.schema
      .createIndex('reviews_author_media_unique_idx')
      .on('reviews')
      .columns(['authorDid', 'mediaItemId', 'mediaType'])
      .unique()
      .execute();

    // Create index for media item queries
    await db.schema
      .createIndex('reviews_media_item_idx')
      .on('reviews')
      .columns(['mediaItemId', 'mediaType'])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('reviews').execute();

    // Re-add notes column to review table
    await db.schema.alterTable('review').addColumn('notes', 'text').execute();
  },
};

migrations['005'] = {
  async up(db: Kysely<unknown>) {
    // Create feedback table
    await db.schema
      .createTable('feedback')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('userDid', 'varchar')
      .addColumn('email', 'varchar')
      .addColumn('message', 'text', (col) => col.notNull())
      .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('new'))
      .addColumn('adminNotes', 'text')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    // Create index for status queries
    await db.schema
      .createIndex('feedback_status_idx')
      .on('feedback')
      .column('status')
      .execute();

    // Create index for userDid queries
    await db.schema
      .createIndex('feedback_user_did_idx')
      .on('feedback')
      .column('userDid')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('feedback').execute();
  },
};

migrations['006'] = {
  async up(db: Kysely<unknown>) {
    // Create feed_events table
    await db.schema
      .createTable('feed_events')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('eventName', 'varchar', (col) => col.notNull())
      .addColumn('mediaLink', 'varchar')
      .addColumn('userDid', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .execute();

    // Create index for chronological queries (most recent first)
    await db.schema
      .createIndex('feed_events_created_at_idx')
      .on('feed_events')
      .column('createdAt')
      .execute();

    // Create index for user-specific queries
    await db.schema
      .createIndex('feed_events_user_did_idx')
      .on('feed_events')
      .column('userDid')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('feed_events').execute();
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
