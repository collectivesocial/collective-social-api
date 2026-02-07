import { Generated } from 'kysely';

export interface ChapterEntry {
  chapter: number;
  title?: string;
  startPage: number;
  endPage: number;
}

export interface ChapterMap {
  totalChapters: number;
  chapters: ChapterEntry[];
}

export interface MediaItem {
  id: Generated<number>;
  mediaType:
    | 'book'
    | 'movie'
    | 'tv'
    | 'podcast'
    | 'article'
    | 'game'
    | 'music'
    | 'video';
  title: string;
  creator?: string; // Author, director, artist, etc.
  isbn?: string; // For books
  externalId?: string; // IMDB ID, etc.
  url?: string; // For articles and videos
  coverImage?: string;
  description?: string;
  publishedYear?: number;
  length?: number; // Pages for books, minutes for movies/videos, episodes for TV
  chapterMap?: ChapterMap | null; // Page-to-chapter mapping for books (stored as JSONB)
  totalRatings: number;
  totalReviews: number;
  totalSaves: number;
  averageRating?: number;
  rating0: number;
  rating0_5: number;
  rating1: number;
  rating1_5: number;
  rating2: number;
  rating2_5: number;
  rating3: number;
  rating3_5: number;
  rating4: number;
  rating4_5: number;
  rating5: number;
  createdBy?: string; // User DID of who created this item manually
  createdAt: Date;
  updatedAt: Date;
}
