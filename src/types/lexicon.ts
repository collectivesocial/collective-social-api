/**
 * Custom lexicon types for Collective Social
 * These correspond to the lexicon definitions in /lexicons
 */

export namespace AppCollectiveSocialFeedList {
  export interface Record {
    $type?: 'app.collectivesocial.feed.list';
    name: string;
    description?: string;
    parentListUri?: string;
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

export namespace AppCollectiveSocialFeedListitem {
  export interface Recommendation {
    did: string;
    suggestedAt: string;
  }

  export interface Record {
    $type?: 'app.collectivesocial.feed.listitem';
    list: string; // AT-URI of the list
    title: string;
    creator?: string;
    description?: string;
    order?: number; // Display order - higher numbers appear first
    mediaItemId?: number; // Reference to media_items table
    mediaType?:
      | 'book'
      | 'movie'
      | 'tv'
      | 'podcast'
      | 'article'
      | 'game'
      | 'music'
      | 'course';
    status?: 'want' | 'in-progress' | 'completed';
    recommendations?: Recommendation[];
    completedAt?: string; // Timestamp when completed
    review?: string; // AT-URI of associated review record
    createdAt: string;
  }
}

export namespace AppCollectiveSocialFeedReview {
  export interface Record {
    $type?: 'app.collectivesocial.feed.review';
    title?: string;
    text: string;
    rating?: number; // 0-5, supports 0.5 increments
    notes?: string; // Private notes
    mediaItemId?: number; // Reference to media_items table
    mediaType?:
      | 'book'
      | 'movie'
      | 'tv'
      | 'podcast'
      | 'article'
      | 'game'
      | 'music';
    listItem?: string; // AT-URI of the associated list item
    createdAt: string;
    updatedAt?: string;
  }
}

export namespace AppCollectiveSocialFeedReviewsegment {
  export interface Record {
    $type?: 'app.collectivesocial.feed.reviewsegment';
    title?: string;
    text?: string;
    percentage: number; // 0-100, progress when segment was written
    mediaItemId?: number; // Reference to media_items table
    mediaType?:
      | 'book'
      | 'movie'
      | 'tv'
      | 'podcast'
      | 'article'
      | 'game'
      | 'music'
      | 'course'
      | 'video';
    listItem?: string; // AT-URI of the associated list item
    createdAt: string;
  }
}
