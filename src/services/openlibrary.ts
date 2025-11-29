/**
 * OpenLibrary API integration for book search
 * Docs: https://openlibrary.org/developers/api
 */

export interface OpenLibrarySearchResult {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
}

export interface OpenLibraryBook {
  title: string;
  authors?: Array<{ name: string }>;
  publish_date?: string;
  publishers?: string[];
  isbn_13?: string[];
  isbn_10?: string[];
  covers?: number[];
  description?: string | { value: string };
  number_of_pages?: number;
}

interface OpenLibrarySearchResponse {
  docs: OpenLibrarySearchResult[];
}

/**
 * Search for books by title or author
 */
export async function searchBooks(
  query: string,
  limit: number = 10
): Promise<OpenLibrarySearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params}`);

  if (!response.ok) {
    throw new Error('Failed to search OpenLibrary');
  }

  const data = (await response.json()) as OpenLibrarySearchResponse;
  return data.docs || [];
}

/**
 * Get book details by ISBN
 */
export async function getBookByISBN(
  isbn: string
): Promise<OpenLibraryBook | null> {
  const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error('Failed to fetch book from OpenLibrary');
  }

  return (await response.json()) as OpenLibraryBook;
}

/**
 * Get book details by OpenLibrary work key (e.g., /works/OL45883W)
 */
export async function getBookByKey(
  key: string
): Promise<OpenLibraryBook | null> {
  const response = await fetch(`https://openlibrary.org${key}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error('Failed to fetch book from OpenLibrary');
  }

  return (await response.json()) as OpenLibraryBook;
}

/**
 * Get cover image URL for a cover ID
 */
export function getCoverUrl(
  coverId: number,
  size: 'S' | 'M' | 'L' = 'M'
): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

/**
 * Extract primary ISBN from search result or book data
 */
export function extractISBN(
  result: OpenLibrarySearchResult | OpenLibraryBook
): string | undefined {
  // Check ia array for ISBN entries (e.g., 'isbn_9780439064866')
  if ('ia' in result && Array.isArray(result.ia)) {
    const isbnEntry = result.ia.find((entry) => entry.startsWith('isbn_'));
    if (isbnEntry) {
      const isbn = isbnEntry.replace('isbn_', '');
      return isbn;
    }
  }

  if ('isbn' in result && result.isbn && result.isbn.length > 0) {
    // Prefer ISBN-13
    const isbn13 = result.isbn.find((isbn) => isbn.length === 13);
    return isbn13 || result.isbn[0];
  }

  if ('isbn_13' in result && result.isbn_13 && result.isbn_13.length > 0) {
    return result.isbn_13[0];
  }

  if ('isbn_10' in result && result.isbn_10 && result.isbn_10.length > 0) {
    return result.isbn_10[0];
  }

  return undefined;
}

/**
 * Extract description text from book data
 */
export function extractDescription(book: OpenLibraryBook): string | undefined {
  if (!book.description) return undefined;

  if (typeof book.description === 'string') {
    return book.description;
  }

  if (typeof book.description === 'object' && 'value' in book.description) {
    return book.description.value;
  }

  return undefined;
}
