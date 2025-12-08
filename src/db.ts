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
  Generated,
  sql,
} from 'kysely';

export type PublicReview = {
  id: number;
  authorDid: string;
  mediaItemId: number;
  mediaType: string;
  rating: number;
  review: string;
  listItemUri: string;
  reviewUri: string | null;
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

export type ShareLink = {
  id: Generated<number>;
  shortCode: string;
  userDid: string;
  mediaItemId: number;
  mediaType: string;
  timesClicked: Generated<number>;
  createdAt: Date;
  updatedAt: Date;
};

export type Tag = {
  id: Generated<number>;
  name: string;
  slug: string;
  createdAt: Date;
  status: string;
};

export type MediaItemTag = {
  mediaItemId: number;
  tagId: number;
  userDid: string;
  createdAt: Date;
};

export type TagReport = {
  id: Generated<number>;
  itemId: number;
  tagId: number;
  reporterDid: string;
  reason: string;
  createdAt: Date;
  status: string;
};

export type PublicComment = {
  id: Generated<number>;
  uri: string;
  cid: string;
  userDid: string;
  text: string;
  reviewUri: string | null;
  parentCommentUri: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Reaction = {
  id: Generated<number>;
  uri: string;
  cid: string;
  userDid: string;
  emoji: string;
  subjectUri: string;
  subjectType: 'review' | 'comment';
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
  share_links: ShareLink;
  tags: Tag;
  media_item_tags: MediaItemTag;
  tag_reports: TagReport;
  comments: PublicComment;
  reactions: Reaction;
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

migrations['007'] = {
  async up(db: Kysely<unknown>) {
    // Add total_saves column to media_items table
    await db.schema
      .alterTable('media_items')
      .addColumn('totalSaves', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();

    // Create index for sorting by popularity
    await db.schema
      .createIndex('media_items_total_saves_idx')
      .on('media_items')
      .column('totalSaves')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('media_items')
      .dropColumn('totalSaves')
      .execute();
  },
};

migrations['008'] = {
  async up(db: Kysely<unknown>) {
    // Add reviewUri column to reviews table to store AT-URI of review records
    await db.schema
      .alterTable('reviews')
      .addColumn('reviewUri', 'varchar')
      .execute();

    // Create index for review URI lookups
    await db.schema
      .createIndex('reviews_review_uri_idx')
      .on('reviews')
      .column('reviewUri')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('reviews').dropColumn('reviewUri').execute();
  },
};

migrations['009'] = {
  async up(db: Kysely<unknown>) {
    // Create share_links table for tracking shared media items
    await db.schema
      .createTable('share_links')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('shortCode', 'varchar', (col) => col.notNull().unique())
      .addColumn('userDid', 'varchar', (col) => col.notNull())
      .addColumn('mediaItemId', 'integer', (col) => col.notNull())
      .addColumn('mediaType', 'varchar', (col) => col.notNull())
      .addColumn('timesShared', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    // Create unique index on shortCode for fast lookups
    await db.schema
      .createIndex('share_links_short_code_idx')
      .on('share_links')
      .column('shortCode')
      .unique()
      .execute();

    // Create index for user queries
    await db.schema
      .createIndex('share_links_user_did_idx')
      .on('share_links')
      .column('userDid')
      .execute();

    // Create composite index for media item lookups
    await db.schema
      .createIndex('share_links_media_idx')
      .on('share_links')
      .columns(['mediaItemId', 'mediaType'])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('share_links').execute();
  },
};

migrations['010'] = {
  async up(db: Kysely<unknown>) {
    // Rename timesShared column to timesClicked for clarity
    await db.schema
      .alterTable('share_links')
      .renameColumn('timesShared', 'timesClicked')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    // Revert the column name back to timesShared
    await db.schema
      .alterTable('share_links')
      .renameColumn('timesClicked', 'timesShared')
      .execute();
  },
};

migrations['011'] = {
  async up(db: Kysely<unknown>) {
    // Add totalRatings column to track all ratings (separate from text reviews)
    await db.schema
      .alterTable('media_items')
      .addColumn('totalRatings', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();

    // Initialize totalRatings with current totalReviews value
    // (since all existing reviews have ratings)
    await sql`UPDATE media_items SET "totalRatings" = "totalReviews"`.execute(
      db
    );

    // Create index for sorting by rating count
    await db.schema
      .createIndex('media_items_total_ratings_idx')
      .on('media_items')
      .column('totalRatings')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('media_items')
      .dropColumn('totalRatings')
      .execute();
  },
};

migrations['012'] = {
  async up(db: Kysely<unknown>) {
    // Add rating distribution columns to track count of each rating value
    await db.schema
      .alterTable('media_items')
      .addColumn('rating0', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating0_5', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating1', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating1_5', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating2', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating2_5', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating3', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating3_5', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating4', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating4_5', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('rating5', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();

    // Populate rating distribution from existing reviews
    await sql`
      UPDATE media_items
      SET 
        rating0 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 0), 0),
        rating0_5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 0.5), 0),
        rating1 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 1), 0),
        rating1_5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 1.5), 0),
        rating2 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 2), 0),
        rating2_5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 2.5), 0),
        rating3 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 3), 0),
        rating3_5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 3.5), 0),
        rating4 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 4), 0),
        rating4_5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 4.5), 0),
        rating5 = COALESCE((SELECT COUNT(*) FROM reviews WHERE "mediaItemId" = media_items.id AND rating = 5), 0)
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('media_items')
      .dropColumn('rating0')
      .dropColumn('rating0_5')
      .dropColumn('rating1')
      .dropColumn('rating1_5')
      .dropColumn('rating2')
      .dropColumn('rating2_5')
      .dropColumn('rating3')
      .dropColumn('rating3_5')
      .dropColumn('rating4')
      .dropColumn('rating4_5')
      .dropColumn('rating5')
      .execute();
  },
};

migrations['013'] = {
  async up(db: Kysely<unknown>) {
    // Add url column for articles and videos
    await db.schema
      .alterTable('media_items')
      .addColumn('url', 'varchar', (col) => col)
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('media_items').dropColumn('url').execute();
  },
};

migrations['014'] = {
  async up(db: Kysely<unknown>) {
    // Add length column for tracking pages/minutes/episodes
    await db.schema
      .alterTable('media_items')
      .addColumn('length', 'integer', (col) => col)
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('media_items').dropColumn('length').execute();
  },
};

migrations['015'] = {
  async up(db: Kysely<unknown>) {
    // Create tags table
    await db.schema
      .createTable('tags')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('slug', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('created_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('status', 'varchar(50)', (col) =>
        col.notNull().defaultTo('active')
      )
      .execute();

    // Create index on slug for faster lookups
    await db.schema
      .createIndex('tags_slug_idx')
      .on('tags')
      .column('slug')
      .execute();

    // Create index on status for filtering
    await db.schema
      .createIndex('tags_status_idx')
      .on('tags')
      .column('status')
      .execute();

    // Create media_item_tags junction table
    await db.schema
      .createTable('media_item_tags')
      .addColumn('media_item_id', 'integer', (col) =>
        col.notNull().references('media_items.id').onDelete('cascade')
      )
      .addColumn('tag_id', 'integer', (col) =>
        col.notNull().references('tags.id').onDelete('cascade')
      )
      .addColumn('user_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addPrimaryKeyConstraint('media_item_tags_pk', [
        'media_item_id',
        'tag_id',
        'user_did',
      ])
      .execute();

    // Create indexes for junction table
    await db.schema
      .createIndex('media_item_tags_media_item_idx')
      .on('media_item_tags')
      .column('media_item_id')
      .execute();

    await db.schema
      .createIndex('media_item_tags_tag_idx')
      .on('media_item_tags')
      .column('tag_id')
      .execute();

    await db.schema
      .createIndex('media_item_tags_user_idx')
      .on('media_item_tags')
      .column('user_did')
      .execute();

    // Create tag_reports table for moderation
    await db.schema
      .createTable('tag_reports')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('item_id', 'integer', (col) =>
        col.notNull().references('media_items.id').onDelete('cascade')
      )
      .addColumn('tag_id', 'integer', (col) =>
        col.notNull().references('tags.id').onDelete('cascade')
      )
      .addColumn('reporter_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('reason', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('status', 'varchar(50)', (col) =>
        col.notNull().defaultTo('pending')
      )
      .execute();

    // Create indexes for tag_reports
    await db.schema
      .createIndex('tag_reports_status_idx')
      .on('tag_reports')
      .column('status')
      .execute();

    await db.schema
      .createIndex('tag_reports_tag_idx')
      .on('tag_reports')
      .column('tag_id')
      .execute();

    await db.schema
      .createIndex('tag_reports_item_idx')
      .on('tag_reports')
      .column('item_id')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('tag_reports').execute();
    await db.schema.dropTable('media_item_tags').execute();
    await db.schema.dropTable('tags').execute();
  },
};

migrations['016'] = {
  async up(db: Kysely<unknown>) {
    // Create comments table
    await db.schema
      .createTable('comments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('userDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('text', 'text', (col) => col.notNull())
      .addColumn('reviewUri', 'varchar(512)')
      .addColumn('parentCommentUri', 'varchar(512)')
      .addColumn('createdAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updatedAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    // Create index on reviewUri for faster lookups of comments on a review
    await db.schema
      .createIndex('comments_review_uri_idx')
      .on('comments')
      .column('reviewUri')
      .execute();

    // Create index on parentCommentUri for faster lookups of nested comments
    await db.schema
      .createIndex('comments_parent_comment_uri_idx')
      .on('comments')
      .column('parentCommentUri')
      .execute();

    // Create index on userDid for faster lookups of user's comments
    await db.schema
      .createIndex('comments_user_did_idx')
      .on('comments')
      .column('userDid')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('comments').execute();
  },
};

migrations['017'] = {
  async up(db: Kysely<unknown>) {
    // Fix comments table column names from snake_case to camelCase
    // Drop old table and recreate with correct column names
    await db.schema.dropTable('comments').ifExists().execute();

    // Create comments table with camelCase columns
    await db.schema
      .createTable('comments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('userDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('text', 'text', (col) => col.notNull())
      .addColumn('reviewUri', 'varchar(512)')
      .addColumn('parentCommentUri', 'varchar(512)')
      .addColumn('createdAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updatedAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    // Create indexes
    await db.schema
      .createIndex('comments_review_uri_idx')
      .on('comments')
      .column('reviewUri')
      .execute();

    await db.schema
      .createIndex('comments_parent_comment_uri_idx')
      .on('comments')
      .column('parentCommentUri')
      .execute();

    await db.schema
      .createIndex('comments_user_did_idx')
      .on('comments')
      .column('userDid')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    // Revert to snake_case columns
    await db.schema.dropTable('comments').ifExists().execute();

    await db.schema
      .createTable('comments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('user_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('text', 'text', (col) => col.notNull())
      .addColumn('review_uri', 'varchar(512)')
      .addColumn('parent_comment_uri', 'varchar(512)')
      .addColumn('created_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updated_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();
  },
};

migrations['018'] = {
  async up(db: Kysely<unknown>) {
    // Add profile information columns to users table
    await db.schema
      .alterTable('users')
      .addColumn('handle', 'varchar(255)')
      .addColumn('displayName', 'varchar(255)')
      .addColumn('avatar', 'text')
      .execute();

    // Create index on handle for lookups
    await db.schema
      .createIndex('users_handle_idx')
      .on('users')
      .column('handle')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('users')
      .dropColumn('handle')
      .dropColumn('displayName')
      .dropColumn('avatar')
      .execute();

    await db.schema.dropIndex('users_handle_idx').execute();
  },
};

migrations['019'] = {
  async up(db: Kysely<unknown>) {
    // Create reactions table
    await db.schema
      .createTable('reactions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('userDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('emoji', 'varchar(50)', (col) => col.notNull())
      .addColumn('subjectUri', 'varchar(512)', (col) => col.notNull())
      .addColumn('subjectType', 'varchar(50)', (col) => col.notNull()) // 'review' or 'comment'
      .addColumn('createdAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    // Create index on subjectUri for fast lookup of reactions on a review/comment
    await db.schema
      .createIndex('reactions_subject_uri_idx')
      .on('reactions')
      .column('subjectUri')
      .execute();

    // Create index on userDid for looking up user's reactions
    await db.schema
      .createIndex('reactions_user_did_idx')
      .on('reactions')
      .column('userDid')
      .execute();

    // Create unique index to prevent duplicate reactions (one emoji per user per subject)
    await db.schema
      .createIndex('reactions_user_subject_emoji_unique_idx')
      .on('reactions')
      .columns(['userDid', 'subjectUri', 'emoji'])
      .unique()
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('reactions').execute();
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
