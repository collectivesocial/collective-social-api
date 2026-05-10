/**
 * Production-ready database schema for collective-social-api.
 *
 * This file consolidates the final state of migrations 001–025 into a single
 * clean initial schema. It is safe to run on a fresh database via Kysely's
 * migrateToLatest(). The legacy tables (review, comment, react, group,
 * group_item, list, list_item) from migration 001 that were never dropped
 * are intentionally excluded — they are no longer used by any route.
 *
 * Group content index tables (group_lists, group_list_items, group_segments,
 * group_posts, group_reactions) were created in 024 and dropped in 025 since
 * that data now lives exclusively on the community PDS.
 *
 * The only group table remaining is group_notifications (still in Postgres).
 */

import { Kysely, Migration, MigrationProvider, Migrator, sql } from 'kysely';

const migrations: Record<string, Migration> = {};

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Migration 001: Initial schema (clean production baseline)
// Combines tables from the original 25 incremental migrations into their
// final-state definitions. This is the target schema for a fresh deploy.
// ────────────────────────────────────────────────────────────────────────────
migrations['001'] = {
  async up(db: Kysely<unknown>) {
    // ── Auth tables ────────────────────────────────────────────────
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

    // ── Users ──────────────────────────────────────────────────────
    await db.schema
      .createTable('users')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('handle', 'varchar(255)')
      .addColumn('displayName', 'varchar(255)')
      .addColumn('avatar', 'text')
      .addColumn('firstLoginAt', 'timestamptz', (col) => col.notNull())
      .addColumn('lastActivityAt', 'timestamptz', (col) => col.notNull())
      .addColumn('isAdmin', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('createdAt', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updatedAt', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    await db.schema
      .createIndex('users_is_admin_idx')
      .on('users')
      .column('isAdmin')
      .execute();

    await db.schema
      .createIndex('users_handle_idx')
      .on('users')
      .column('handle')
      .execute();

    // ── Media items ────────────────────────────────────────────────
    await db.schema
      .createTable('media_items')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('mediaType', 'varchar', (col) => col.notNull())
      .addColumn('title', 'varchar', (col) => col.notNull())
      .addColumn('creator', 'varchar')
      .addColumn('isbn', 'varchar')
      .addColumn('externalId', 'varchar')
      .addColumn('url', 'varchar')
      .addColumn('coverImage', 'text')
      .addColumn('description', 'text')
      .addColumn('publishedYear', 'integer')
      .addColumn('length', 'integer')
      .addColumn('chapterMap', 'jsonb')
      .addColumn('totalReviews', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('totalRatings', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('totalSaves', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('averageRating', 'decimal(3, 2)')
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
      .addColumn('createdBy', 'varchar(255)')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

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

    await db.schema
      .createIndex('media_items_total_saves_idx')
      .on('media_items')
      .column('totalSaves')
      .execute();

    await db.schema
      .createIndex('media_items_total_ratings_idx')
      .on('media_items')
      .column('totalRatings')
      .execute();

    await db.schema
      .createIndex('media_items_created_by_idx')
      .on('media_items')
      .column('createdBy')
      .execute();

    // ── Reviews ────────────────────────────────────────────────────
    await db.schema
      .createTable('reviews')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('mediaItemId', 'integer', (col) => col.notNull())
      .addColumn('mediaType', 'varchar', (col) => col.notNull())
      .addColumn('rating', 'decimal(2, 1)', (col) => col.notNull())
      .addColumn('review', 'text', (col) => col.notNull())
      .addColumn('listItemUri', 'varchar', (col) => col.notNull())
      .addColumn('reviewUri', 'varchar')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('reviews_author_media_unique_idx')
      .on('reviews')
      .columns(['authorDid', 'mediaItemId', 'mediaType'])
      .unique()
      .execute();

    await db.schema
      .createIndex('reviews_media_item_idx')
      .on('reviews')
      .columns(['mediaItemId', 'mediaType'])
      .execute();

    await db.schema
      .createIndex('reviews_review_uri_idx')
      .on('reviews')
      .column('reviewUri')
      .execute();

    // ── Feedback ───────────────────────────────────────────────────
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

    await db.schema
      .createIndex('feedback_status_idx')
      .on('feedback')
      .column('status')
      .execute();

    await db.schema
      .createIndex('feedback_user_did_idx')
      .on('feedback')
      .column('userDid')
      .execute();

    // ── Feed events ────────────────────────────────────────────────
    await db.schema
      .createTable('feed_events')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('eventName', 'varchar', (col) => col.notNull())
      .addColumn('mediaLink', 'varchar')
      .addColumn('userDid', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('feed_events_created_at_idx')
      .on('feed_events')
      .column('createdAt')
      .execute();

    await db.schema
      .createIndex('feed_events_user_did_idx')
      .on('feed_events')
      .column('userDid')
      .execute();

    // ── Share links ────────────────────────────────────────────────
    await db.schema
      .createTable('share_links')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('shortCode', 'varchar', (col) => col.notNull().unique())
      .addColumn('userDid', 'varchar', (col) => col.notNull())
      .addColumn('mediaItemId', 'integer')
      .addColumn('mediaType', 'varchar')
      .addColumn('collectionUri', 'varchar')
      .addColumn('reviewId', 'integer')
      .addColumn('timesClicked', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull())
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('share_links_short_code_idx')
      .on('share_links')
      .column('shortCode')
      .unique()
      .execute();

    await db.schema
      .createIndex('share_links_user_did_idx')
      .on('share_links')
      .column('userDid')
      .execute();

    await db.schema
      .createIndex('share_links_media_idx')
      .on('share_links')
      .columns(['mediaItemId', 'mediaType'])
      .execute();

    await db.schema
      .createIndex('share_links_collection_idx')
      .on('share_links')
      .column('collectionUri')
      .execute();

    await db.schema
      .createIndex('share_links_review_idx')
      .on('share_links')
      .column('reviewId')
      .execute();

    // ── Tags ───────────────────────────────────────────────────────
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

    await db.schema
      .createIndex('tags_slug_idx')
      .on('tags')
      .column('slug')
      .execute();

    await db.schema
      .createIndex('tags_status_idx')
      .on('tags')
      .column('status')
      .execute();

    // ── Media item tags (junction) ─────────────────────────────────
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

    // ── Tag reports ────────────────────────────────────────────────
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

    // ── Comments ───────────────────────────────────────────────────
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

    // ── Reactions ──────────────────────────────────────────────────
    await db.schema
      .createTable('reactions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('userDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('emoji', 'varchar(50)', (col) => col.notNull())
      .addColumn('subjectUri', 'varchar(512)', (col) => col.notNull())
      .addColumn('subjectType', 'varchar(50)', (col) => col.notNull())
      .addColumn('createdAt', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    await db.schema
      .createIndex('reactions_subject_uri_idx')
      .on('reactions')
      .column('subjectUri')
      .execute();

    await db.schema
      .createIndex('reactions_user_did_idx')
      .on('reactions')
      .column('userDid')
      .execute();

    await db.schema
      .createIndex('reactions_user_subject_emoji_unique_idx')
      .on('reactions')
      .columns(['userDid', 'subjectUri', 'emoji'])
      .unique()
      .execute();

    // ── Group notifications (only group table remaining in Postgres) ─
    await db.schema
      .createTable('group_notifications')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('communityDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('recipientDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('actorDid', 'varchar(255)', (col) => col.notNull())
      .addColumn('type', 'varchar(50)', (col) => col.notNull())
      .addColumn('subjectUri', 'varchar(512)')
      .addColumn('subjectType', 'varchar(50)')
      .addColumn('message', 'text')
      .addColumn('read', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('createdAt', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    await db.schema
      .createIndex('group_notifications_recipient_idx')
      .on('group_notifications')
      .column('recipientDid')
      .execute();

    await db.schema
      .createIndex('group_notifications_community_idx')
      .on('group_notifications')
      .column('communityDid')
      .execute();

    await db.schema
      .createIndex('group_notifications_read_idx')
      .on('group_notifications')
      .columns(['recipientDid', 'read'])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    // Drop in reverse dependency order
    await db.schema.dropTable('group_notifications').ifExists().execute();
    await db.schema.dropTable('reactions').ifExists().execute();
    await db.schema.dropTable('comments').ifExists().execute();
    await db.schema.dropTable('tag_reports').ifExists().execute();
    await db.schema.dropTable('media_item_tags').ifExists().execute();
    await db.schema.dropTable('tags').ifExists().execute();
    await db.schema.dropTable('share_links').ifExists().execute();
    await db.schema.dropTable('feed_events').ifExists().execute();
    await db.schema.dropTable('feedback').ifExists().execute();
    await db.schema.dropTable('reviews').ifExists().execute();
    await db.schema.dropTable('media_items').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
    await db.schema.dropTable('auth_state').ifExists().execute();
    await db.schema.dropTable('auth_session').ifExists().execute();
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Migrations 002–025: No-op stubs
// The original incremental migrations have been consolidated into 001 above.
// These empty entries exist so that databases which already executed 002–025
// don't trigger Kysely's "corrupted migrations: previously executed migration
// … is missing" error.
// ────────────────────────────────────────────────────────────────────────────
for (let i = 2; i <= 25; i++) {
  const key = String(i).padStart(3, '0');
  migrations[key] = {
    async up(_db: Kysely<any>) {
      /* already applied via consolidated 001 */
    },
    async down(_db: Kysely<any>) {
      /* no-op */
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Migration 026: Analytics tables + feed_events eventType column
// ────────────────────────────────────────────────────────────────────────────
migrations['026'] = {
  async up(db: Kysely<unknown>) {
    // ── User activity log (one row per user per day for retention & WAU)
    await db.schema
      .createTable('user_activity_log')
      .addColumn('did', 'varchar', (col) => col.notNull())
      .addColumn('activity_date', 'date', (col) => col.notNull())
      .addColumn('activity_count', 'integer', (col) =>
        col.notNull().defaultTo(1)
      )
      .addUniqueConstraint('user_activity_log_did_date_unique', [
        'did',
        'activity_date',
      ])
      .execute();

    await db.schema
      .createIndex('user_activity_log_date_idx')
      .on('user_activity_log')
      .column('activity_date')
      .execute();

    await db.schema
      .createIndex('user_activity_log_did_idx')
      .on('user_activity_log')
      .column('did')
      .execute();

    // ── Bluesky share events (tracks intent-to-share clicks)
    await db.schema
      .createTable('bluesky_share_events')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('userDid', 'varchar', (col) => col.notNull())
      .addColumn('shareType', 'varchar(50)', (col) => col.notNull())
      .addColumn('shareTargetId', 'varchar')
      .addColumn('createdAt', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    await db.schema
      .createIndex('bluesky_share_events_created_at_idx')
      .on('bluesky_share_events')
      .column('createdAt')
      .execute();

    await db.schema
      .createIndex('bluesky_share_events_user_did_idx')
      .on('bluesky_share_events')
      .column('userDid')
      .execute();

    // ── Add eventType column to feed_events for structured querying
    await db.schema
      .alterTable('feed_events')
      .addColumn('eventType', 'varchar(50)')
      .execute();

    await db.schema
      .createIndex('feed_events_event_type_idx')
      .on('feed_events')
      .column('eventType')
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .dropIndex('feed_events_event_type_idx')
      .ifExists()
      .execute();
    await db.schema.alterTable('feed_events').dropColumn('eventType').execute();
    await db.schema.dropTable('bluesky_share_events').ifExists().execute();
    await db.schema.dropTable('user_activity_log').ifExists().execute();
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Migration 027: Goals table + goalUri column on share_links
// ────────────────────────────────────────────────────────────────────────────
migrations['027'] = {
  async up(db: Kysely<unknown>) {
    // ── Goals index table (caches ATProto goal records for aggregation)
    await db.schema
      .createTable('goals')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('uri', 'varchar', (col) => col.notNull().unique())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('title', 'varchar', (col) => col.notNull())
      .addColumn('mediaType', 'varchar(64)')
      .addColumn('targetCount', 'integer', (col) => col.notNull())
      .addColumn('startDate', 'timestamptz', (col) => col.notNull())
      .addColumn('endDate', 'timestamptz', (col) => col.notNull())
      .addColumn('visibility', 'varchar(32)', (col) =>
        col.notNull().defaultTo('public')
      )
      .addColumn('cachedCompletedCount', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('createdAt', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();

    await db.schema
      .createIndex('goals_author_did_idx')
      .on('goals')
      .column('authorDid')
      .execute();

    // ── Add goalUri column to share_links for goal sharing
    await db.schema
      .alterTable('share_links')
      .addColumn('goalUri', 'varchar')
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('share_links').dropColumn('goalUri').execute();
    await db.schema.dropTable('goals').ifExists().execute();
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Migration 028: event_rsvps table for Events V1
// Events live on the group PDS (community.lexicon.calendar.event).
// RSVPs live on each user's PDS (community.lexicon.calendar.rsvp).
// This table caches RSVPs for aggregation (counts, attendee lists).
// ────────────────────────────────────────────────────────────────────────────
migrations['028'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('event_rsvps')
      .addColumn('event_uri', 'text', (col) => col.notNull())
      .addColumn('event_cid', 'text', (col) => col.notNull())
      .addColumn('community_did', 'text', (col) => col.notNull())
      .addColumn('user_did', 'text', (col) => col.notNull())
      .addColumn('rsvp_uri', 'text', (col) => col.notNull())
      .addColumn('status', 'varchar(16)', (col) => col.notNull())
      .addColumn('rsvp_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`NOW()`)
      )
      .addColumn('updated_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`NOW()`)
      )
      .addPrimaryKeyConstraint('event_rsvps_pkey', ['event_uri', 'user_did'])
      .execute();

    await db.schema
      .createIndex('event_rsvps_event_uri_idx')
      .on('event_rsvps')
      .column('event_uri')
      .execute();

    await db.schema
      .createIndex('event_rsvps_community_did_idx')
      .on('event_rsvps')
      .column('community_did')
      .execute();

    await db.schema
      .createIndex('event_rsvps_user_did_idx')
      .on('event_rsvps')
      .column('user_did')
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('event_rsvps').ifExists().execute();
  },
};

// Migration 029: widen event_rsvps.status from VARCHAR(16) to TEXT
// ────────────────────────────────────────────────────────────────────────────
// Root cause: RSVP status values are full NSID tokens like
//   "community.lexicon.calendar.rsvp#going"   (38 chars)
// which overflows the original VARCHAR(16) cap, causing Postgres to throw
// "value too long for type character varying(16)" on every RSVP write.
// TEXT has no length cap in Postgres and is the correct type for this column.
//
// Down migration note: reverting to VARCHAR(16) will FAIL if any existing row
// holds a value longer than 16 characters. Treat this as a one-way migration
// in production unless the table is first truncated.
migrations['029'] = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE event_rsvps ALTER COLUMN status TYPE TEXT`.execute(
      db
    );
  },

  async down(db: Kysely<unknown>) {
    // WARNING: this will fail if any row.status is longer than 16 characters.
    await sql`ALTER TABLE event_rsvps ALTER COLUMN status TYPE VARCHAR(16)`.execute(
      db
    );
  },
};

// Migration 030: segment_completions cache table
// Similar pattern to event_rsvps — PDS is source of truth, this caches for fast roster queries.
// ────────────────────────────────────────────────────────────────────────────
migrations['030'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('segment_completions')
      .addColumn('community_did', 'text', (col) => col.notNull())
      .addColumn('segment_rkey', 'text', (col) => col.notNull())
      .addColumn('user_did', 'text', (col) => col.notNull())
      .addColumn('completed_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`NOW()`)
      )
      .addPrimaryKeyConstraint('segment_completions_pkey', [
        'community_did',
        'segment_rkey',
        'user_did',
      ])
      .execute();

    await db.schema
      .createIndex('segment_completions_segment_idx')
      .on('segment_completions')
      .columns(['community_did', 'segment_rkey'])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('segment_completions').ifExists().execute();
  },
};

export { migrations, migrationProvider };

export const migrateToLatest = async (db: Kysely<any>) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  results?.forEach((r) => {
    if (r.status === 'Success') {
      console.log(`Migration "${r.migrationName}" completed successfully`);
    } else if (r.status === 'Error') {
      console.error(`Migration "${r.migrationName}" failed`);
    }
  });
  if (error) throw error;
};
