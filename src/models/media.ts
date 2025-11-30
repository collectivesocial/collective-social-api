import { Generated } from 'kysely';

export interface MediaItem {
  id: Generated<number>;
  mediaType: 'book' | 'movie' | 'tv' | 'podcast' | 'article' | 'game' | 'music';
  title: string;
  creator?: string; // Author, director, artist, etc.
  isbn?: string; // For books
  externalId?: string; // IMDB ID, etc.
  coverImage?: string;
  description?: string;
  publishedYear?: number;
  totalReviews: number;
  totalSaves: number;
  averageRating?: number;
  createdAt: Date;
  updatedAt: Date;
}
