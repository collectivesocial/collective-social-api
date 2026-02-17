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
  export interface Record {
    $type?: 'app.collectivesocial.feed.listitem';
    list: string; // AT-URI of the list
    title: string;
    creator?: string;
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
      | 'course'
      | 'video';
    userItem?: string; // AT-URI of associated useritem record
    createdAt: string;
  }
}

export namespace AppCollectiveSocialFeedUseritem {
  export interface Recommendation {
    did: string;
    suggestedAt: string;
  }

  export interface Record {
    $type?: 'app.collectivesocial.feed.useritem';
    title: string;
    creator?: string;
    mediaItemId: number; // Reference to media_items table
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
    status?: 'want' | 'in-progress' | 'completed';
    rating?: number; // 0-5, supports 0.5 increments
    notes?: string; // Private notes
    completedAt?: string; // Timestamp when most recently completed
    review?: string; // AT-URI of associated review record
    recommendations?: Recommendation[];
    createdAt: string;
    updatedAt?: string;
  }
}

export namespace AppCollectiveSocialFeedCompletion {
  export interface Record {
    $type?: 'app.collectivesocial.feed.completion';
    mediaItemId: number; // Reference to media_items table
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
    completedAt: string; // When the user completed this media item
    rating?: number; // Optional per-completion rating (0-5)
    notes?: string; // Optional per-completion notes
    review?: string; // AT-URI of associated review
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

export namespace AppCollectiveSocialFeedComment {
  export interface Record {
    $type?: 'app.collectivesocial.feed.comment';
    text: string;
    reviewRef?: {
      uri: string;
      cid: string;
    };
    parentCommentRef?: {
      uri: string;
      cid: string;
    };
    createdAt: string;
    updatedAt: string;
  }
}

export namespace AppCollectiveSocialFeedGoal {
  export interface Record {
    $type?: 'app.collectivesocial.feed.goal';
    title: string;
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
    targetCount: number;
    startDate: string; // datetime
    endDate: string; // datetime
    visibility?: 'public' | 'private';
    createdAt: string;
  }
}
