"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchOMDB = searchOMDB;
exports.getOMDBDetails = getOMDBDetails;
exports.extractRuntime = extractRuntime;
exports.getTotalEpisodes = getTotalEpisodes;
const config_1 = require("../config");
/**
 * Search for movies or TV shows using OMDB API
 */
async function searchOMDB(query, type, limit = 10) {
    if (!config_1.config.omdbApiKey) {
        throw new Error('OMDB API key not configured');
    }
    const url = `http://www.omdbapi.com/?apikey=${config_1.config.omdbApiKey}&s=${encodeURIComponent(query)}&type=${type}`;
    const response = await fetch(url);
    const data = (await response.json());
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
async function getOMDBDetails(imdbId) {
    if (!config_1.config.omdbApiKey) {
        throw new Error('OMDB API key not configured');
    }
    const url = `http://www.omdbapi.com/?apikey=${config_1.config.omdbApiKey}&i=${imdbId}`;
    const response = await fetch(url);
    const data = (await response.json());
    if (data.Response === 'False') {
        return null;
    }
    return data;
}
/**
 * Extract runtime in minutes from OMDB runtime string (e.g., "120 min")
 */
function extractRuntime(runtime) {
    if (!runtime || runtime === 'N/A')
        return null;
    const match = runtime.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
}
/**
 * Get total episode count for a TV series by fetching all seasons
 */
async function getTotalEpisodes(imdbId) {
    if (!config_1.config.omdbApiKey) {
        throw new Error('OMDB API key not configured');
    }
    try {
        // First get series details to find total seasons
        const details = await getOMDBDetails(imdbId);
        if (!details || details.Type !== 'series' || !details.totalSeasons) {
            return null;
        }
        const totalSeasons = parseInt(details.totalSeasons);
        if (isNaN(totalSeasons))
            return null;
        let totalEpisodes = 0;
        // Fetch each season to count episodes
        for (let season = 1; season <= totalSeasons; season++) {
            const url = `http://www.omdbapi.com/?apikey=${config_1.config.omdbApiKey}&i=${imdbId}&Season=${season}`;
            const response = await fetch(url);
            const data = (await response.json());
            if (data.Response === 'True' && data.Episodes) {
                totalEpisodes += data.Episodes.length;
            }
        }
        return totalEpisodes > 0 ? totalEpisodes : null;
    }
    catch (err) {
        console.error('Failed to get total episodes:', err);
        return null;
    }
}
