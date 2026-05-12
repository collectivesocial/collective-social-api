import { config } from './config';
import { Pool } from 'pg';
import { AuthSession, AuthState } from './models/auth';
import { MediaItem } from './models/media';
import { User } from './models/user';
import { GroupNotification } from './models/groupContent';
import { Kysely, PostgresDialect, Generated, sql } from 'kysely';

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
  eventType: string | null;
  mediaLink: string | null;
  userDid: string;
  createdAt: Date;
};

export type UserActivityLog = {
  did: string;
  activity_date: string;
  activity_count: number;
};

export type BlueskyShareEvent = {
  id: Generated<number>;
  userDid: string;
  shareType: string;
  shareTargetId: string | null;
  createdAt: Date;
};

export type Goal = {
  id: Generated<number>;
  uri: string;
  authorDid: string;
  title: string;
  mediaType: string | null;
  targetCount: number;
  startDate: Date;
  endDate: Date;
  visibility: string;
  cachedCompletedCount: number;
  createdAt: Date;
};

export type ShareLink = {
  id: Generated<number>;
  shortCode: string;
  userDid: string;
  mediaItemId: number | null;
  mediaType: string | null;
  collectionUri: string | null;
  reviewId: number | null;
  goalUri: string | null;
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

export type SegmentCompletion = {
  community_did: string;
  segment_rkey: string;
  user_did: string;
  completed_at: Date;
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
  group_notifications: GroupNotification;
  user_activity_log: UserActivityLog;
  bluesky_share_events: BlueskyShareEvent;
  goals: Goal;
  segment_completions: SegmentCompletion;
};

// APIs

// Database connection
export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: location,
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
    }),
  });
};

export type Database = Kysely<DatabaseSchema>;

const pool = new Pool({
  connectionString: config.databaseUrl,
});

export default pool;
