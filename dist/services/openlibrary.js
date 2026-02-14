"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchBooks = searchBooks;
exports.getBookByISBN = getBookByISBN;
exports.getBookByKey = getBookByKey;
exports.getCoverUrl = getCoverUrl;
exports.extractISBN = extractISBN;
exports.extractDescription = extractDescription;
const config_1 = require("../config");
/**
 * OpenLibrary API integration for book search
 * Docs: https://openlibrary.org/developers/api
 *
 * All requests include a User-Agent header to identify our application.
 * Configurable via OPENLIBRARY_USER_AGENT environment variable.
 */
const getOpenLibraryHeaders = () => ({
    'User-Agent': config_1.config.openLibraryUserAgent,
});
/**
 * Search for books by title or author
 */
async function searchBooks(query, limit = 10, offset = 0) {
    const params = new URLSearchParams({
        q: query,
        limit: limit.toString(),
        offset: offset.toString(),
    });
    const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
        headers: getOpenLibraryHeaders(),
    });
    if (!response.ok) {
        throw new Error('Failed to search OpenLibrary');
    }
    const data = (await response.json());
    return {
        results: data.docs || [],
        total: data.numFound || 0,
    };
}
/**
 * Get book details by ISBN
 */
async function getBookByISBN(isbn) {
    const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
        headers: getOpenLibraryHeaders(),
    });
    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        throw new Error('Failed to fetch book from OpenLibrary');
    }
    return (await response.json());
}
/**
 * Get book details by OpenLibrary work key (e.g., /works/OL45883W)
 */
async function getBookByKey(key) {
    const response = await fetch(`https://openlibrary.org${key}.json`, {
        headers: getOpenLibraryHeaders(),
    });
    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        throw new Error('Failed to fetch book from OpenLibrary');
    }
    return (await response.json());
}
/**
 * Get cover image URL for a cover ID
 */
function getCoverUrl(coverId, size = 'M') {
    return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}
/**
 * Extract primary ISBN from search result or book data
 */
function extractISBN(result) {
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
function extractDescription(book) {
    if (!book.description)
        return undefined;
    if (typeof book.description === 'string') {
        return book.description;
    }
    if (typeof book.description === 'object' && 'value' in book.description) {
        return book.description.value;
    }
    return undefined;
}
