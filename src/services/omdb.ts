import { config } from '../config';

interface OMDBSearchResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string; // "movie" or "series"
  Poster: string;
}

interface OMDBSearchResponse {
  Search?: OMDBSearchResult[];
  totalResults?: string;
  Response: string;
  Error?: string;
}

interface OMDBDetailResponse {
  Title: string;
  Year: string;
  Rated: string;
  Released: string;
  Runtime: string;
  Genre: string;
  Director: string;
  Writer: string;
  Actors: string;
  Plot: string;
  Language: string;
  Country: string;
  Awards: string;
  Poster: string;
  imdbRating: string;
  imdbID: string;
  Type: string;
  totalSeasons?: string; // Only for TV series
  Response: string;
  Error?: string;
}

interface OMDBSeasonResponse {
  Title: string;
  Season: string;
  totalSeasons: string;
  Episodes: Array<{
    Title: string;
    Released: string;
    Episode: string;
    imdbRating: string;
    imdbID: string;
  }>;
  Response: string;
  Error?: string;
}

export interface MovieSearchResult {
  title: string;
  year: number | null;
  imdbId: string;
  coverImage: string | null;
  director: string | null;
  plot: string | null;
}

/**
 * Search for movies or TV shows using OMDB API
 */
export async function searchOMDB(
  query: string,
  type: 'movie' | 'series',
  limit: number = 10
): Promise<{ results: MovieSearchResult[]; total: number }> {
  if (!config.omdbApiKey) {
    throw new Error('OMDB API key not configured');
  }

  const url = `http://www.omdbapi.com/?apikey=${config.omdbApiKey}&s=${encodeURIComponent(query)}&type=${type}`;

  const response = await fetch(url);
  const data = (await response.json()) as OMDBSearchResponse;

  if (data.Response === 'False') {
    return { results: [], total: 0 };
  }

  if (!data.Search) {
    return { results: [], total: 0 };
  }

  // Take only the requested limit
  const results = data.Search.slice(0, limit).map((item) => ({
    title: item.Title,
    year: item.Year ? parseInt(item.Year) : null,
    imdbId: item.imdbID,
    coverImage: item.Poster && item.Poster !== 'N/A' ? item.Poster : null,
    director: null, // Not available in search results
    plot: null, // Not available in search results
  }));

  return {
    results,
    total: data.totalResults ? parseInt(data.totalResults) : results.length,
  };
}

/**
 * Get detailed information about a movie/TV show by IMDB ID
 */
export async function getOMDBDetails(
  imdbId: string
): Promise<OMDBDetailResponse | null> {
  if (!config.omdbApiKey) {
    throw new Error('OMDB API key not configured');
  }

  const url = `http://www.omdbapi.com/?apikey=${config.omdbApiKey}&i=${imdbId}`;

  const response = await fetch(url);
  const data = (await response.json()) as OMDBDetailResponse;

  if (data.Response === 'False') {
    return null;
  }

  return data;
}

/**
 * Extract runtime in minutes from OMDB runtime string (e.g., "120 min")
 */
export function extractRuntime(runtime: string): number | null {
  if (!runtime || runtime === 'N/A') return null;

  const match = runtime.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Get total episode count for a TV series by fetching all seasons
 */
export async function getTotalEpisodes(imdbId: string): Promise<number | null> {
  if (!config.omdbApiKey) {
    throw new Error('OMDB API key not configured');
  }

  try {
    // First get series details to find total seasons
    const details = await getOMDBDetails(imdbId);
    if (!details || details.Type !== 'series' || !details.totalSeasons) {
      return null;
    }

    const totalSeasons = parseInt(details.totalSeasons);
    if (isNaN(totalSeasons)) return null;

    let totalEpisodes = 0;

    // Fetch each season to count episodes
    for (let season = 1; season <= totalSeasons; season++) {
      const url = `http://www.omdbapi.com/?apikey=${config.omdbApiKey}&i=${imdbId}&Season=${season}`;
      const response = await fetch(url);
      const data = (await response.json()) as OMDBSeasonResponse;

      if (data.Response === 'True' && data.Episodes) {
        totalEpisodes += data.Episodes.length;
      }
    }

    return totalEpisodes > 0 ? totalEpisodes : null;
  } catch (err) {
    console.error('Failed to get total episodes:', err);
    return null;
  }
}
