/**
 * Custom lexicon types for Collective Social
 * These correspond to the lexicon definitions in /lexicons
 */

export namespace AppCollectiveSocialList {
  export interface Record {
    $type?: 'app.collectivesocial.list';
    name: string;
    description?: string;
    visibility?: 'public' | 'private';
    isDefault?: boolean;
    purpose: string;
    avatar?: {
      cid: string;
      mimeType: string;
    };
    createdAt: string;
  }
}

export namespace AppCollectiveSocialListitem {
  export interface Recommendation {
    did: string;
    suggestedAt: string;
  }

  export interface Record {
    $type?: 'app.collectivesocial.listitem';
    list: string; // AT-URI of the list
    title: string;
    creator?: string;
    mediaItemId?: number; // Reference to media_items table
    mediaType?:
      | 'book'
      | 'movie'
      | 'tv'
      | 'podcast'
      | 'article'
      | 'game'
      | 'music';
    status?: 'want' | 'in-progress' | 'completed';
    rating?: number; // 0-5, supports 0.5 increments
    review?: string;
    recommendations?: Recommendation[];
    createdAt: string;
  }
}
