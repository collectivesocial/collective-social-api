export type Group = {
  uri: string;
  ownerDid: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  indexedAt: string;
};

export type GroupItem = {
  uri: string;
  groupUri: string;
  // Maps to a user did
  identifier: string;
  addedAt: string;
  indexedAt: string;
};
