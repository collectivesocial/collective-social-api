import { Generated } from 'kysely';

/**
 * Group content records (lists, items, segments, posts, reactions)
 * now live exclusively on the community PDS.
 * Only notifications remain in Postgres.
 */

export interface GroupNotification {
  id: Generated<number>;
  communityDid: string;
  recipientDid: string;
  actorDid: string;
  type: string; // 'new_segment' | 'new_post' | 'reply' | 'reaction' | 'mention' | 'status_change' | 'new_item'
  subjectUri: string | null;
  subjectType: string | null;
  message: string | null;
  read: boolean;
  createdAt: Date;
}
