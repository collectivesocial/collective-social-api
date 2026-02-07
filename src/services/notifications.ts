import type { Database } from '../db';

export type NotificationType =
  | 'new_segment'    // Admin created a new reading assignment
  | 'new_post'       // Someone posted in a discussion
  | 'reply'          // Someone replied to your post
  | 'reaction'       // Someone reacted to your post
  | 'mention'        // Someone mentioned you in a post
  | 'status_change'  // Admin changed an item's status (e.g. "in-progress")
  | 'new_item'       // Someone added an item to a list
  | 'new_list';      // Someone created a new list

interface CreateNotificationOpts {
  communityDid: string;
  recipientDid: string;
  actorDid: string;
  type: NotificationType;
  subjectUri?: string;
  subjectType?: string;
  message?: string;
}

/**
 * Create a single notification.
 * Skips if actor === recipient (you don't notify yourself).
 */
export async function createNotification(
  db: Database,
  opts: CreateNotificationOpts
): Promise<void> {
  if (opts.actorDid === opts.recipientDid) return;

  await db
    .insertInto('group_notifications')
    .values({
      communityDid: opts.communityDid,
      recipientDid: opts.recipientDid,
      actorDid: opts.actorDid,
      type: opts.type,
      subjectUri: opts.subjectUri ?? null,
      subjectType: opts.subjectType ?? null,
      message: opts.message ?? null,
      read: false,
      createdAt: new Date(),
    })
    .execute();
}

/**
 * Notify all members of a community about something (e.g. new segment assignment).
 * Fetches the member list from OpenSocial and creates a notification for each.
 */
export async function notifyAllMembers(
  db: Database,
  communityDid: string,
  actorDid: string,
  type: NotificationType,
  opts: { subjectUri?: string; subjectType?: string; message?: string } = {}
): Promise<void> {
  // Import dynamically to avoid circular dependency
  const opensocial = await import('./opensocial');
  const { members } = await opensocial.listMembers(communityDid);

  const notifications = members
    .filter((m) => m.did && m.did !== actorDid)
    .map((m) => ({
      communityDid,
      recipientDid: m.did!,
      actorDid,
      type,
      subjectUri: opts.subjectUri ?? null,
      subjectType: opts.subjectType ?? null,
      message: opts.message ?? null,
      read: false,
      createdAt: new Date(),
    }));

  if (notifications.length === 0) return;

  await db
    .insertInto('group_notifications')
    .values(notifications)
    .execute();
}

/**
 * Notify specific DIDs (e.g. mentioned users).
 */
export async function notifyUsers(
  db: Database,
  communityDid: string,
  actorDid: string,
  recipientDids: string[],
  type: NotificationType,
  opts: { subjectUri?: string; subjectType?: string; message?: string } = {}
): Promise<void> {
  const notifications = recipientDids
    .filter((did) => did !== actorDid)
    .map((did) => ({
      communityDid,
      recipientDid: did,
      actorDid,
      type,
      subjectUri: opts.subjectUri ?? null,
      subjectType: opts.subjectType ?? null,
      message: opts.message ?? null,
      read: false,
      createdAt: new Date(),
    }));

  if (notifications.length === 0) return;

  await db
    .insertInto('group_notifications')
    .values(notifications)
    .execute();
}
