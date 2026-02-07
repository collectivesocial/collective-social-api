import { Generated } from 'kysely';

export interface GroupList {
  id: Generated<number>;
  uri: string;
  rkey: string;
  communityDid: string;
  name: string;
  description: string | null;
  purpose: string | null; // 'book-club' | 'watchlist' | 'playlist' | 'general'
  segmentType: string | null; // 'pages' | 'percent' | 'chapters'
  createdBy: string; // DID of the member who created this list
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupListItem {
  id: Generated<number>;
  uri: string;
  rkey: string;
  communityDid: string;
  listId: number;
  listUri: string;
  title: string;
  creator: string | null; // Author/creator of the media
  mediaItemId: number | null;
  mediaType: string; // 'book' | 'movie' | etc.
  order: number;
  status: string; // 'not-started' | 'in-progress' | 'completed'
  statusUri: string | null; // AT-URI of the status record
  addedBy: string; // DID of the member who added this item
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupSegment {
  id: Generated<number>;
  uri: string;
  rkey: string;
  communityDid: string;
  listItemId: number;
  listItemUri: string;
  label: string; // e.g. "Chapters 1-3", "Act I"
  segmentType: string | null; // 'pages' | 'percent' | 'chapters'
  startPage: number | null;
  endPage: number | null;
  startPercent: number | null;
  endPercent: number | null;
  startChapter: number | null;
  endChapter: number | null;
  assignedDate: Date | null;
  order: number;
  createdBy: string;
  createdAt: Date;
}

export interface GroupPost {
  id: Generated<number>;
  uri: string;
  rkey: string;
  communityDid: string;
  text: string;
  segmentUri: string | null;
  segmentId: number | null;
  listItemUri: string | null;
  listItemId: number | null;
  parentPostUri: string | null;
  parentPostId: number | null;
  authorDid: string;
  createdAt: Date;
}

export interface GroupReaction {
  id: Generated<number>;
  uri: string;
  rkey: string;
  communityDid: string;
  postId: number;
  postUri: string;
  emoji: string;
  authorDid: string;
  createdAt: Date;
}

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
