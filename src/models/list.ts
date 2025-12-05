export type List = {
  uri: string;
  authorDid: string;
  name: string;
  description: string | null;
  parentListUri: string | null;
  isPublic: boolean;
  createdAt: string;
  indexedAt: string;
};

export type ListItem = {
  uri: string;
  listUri: string;
  // Maps to a Review item
  itemUri: string;
  name: string;
  description: string | null;
  addedAt: string;
  indexedAt: string;
};
