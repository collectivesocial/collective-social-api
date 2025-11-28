// Reviews
// Comments
// Reacts

export type Review = {
  uri: string;
  authorDid: string;
  stars: number;
  percentComplete: number;
  review: string | null;
  notes: string | null;
  createdAt: string;
  indexedAt: string;
};

export type Comment = {
  uri: string;
  authorDid: string;
  reviewUri: string;
  parentUri: string | null;
  comment: string;
  createdAt: string;
  indexedAt: string;
};

export type React = {
  uri: string;
  authorDid: string;
  reaction: string;
  createdAt: string;
  indexedAt: string;
};
