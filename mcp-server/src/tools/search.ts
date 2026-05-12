import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CollectiveClient } from '../client.js';

export function registerSearchTools(
  server: McpServer,
  client: CollectiveClient
): void {
  server.tool(
    'search_media',
    "Search Collective's media database by title, creator, or keyword. Returns books, articles, movies, TV shows, podcasts, games, music, and videos.",
    {
      query: z.string().describe('Search query — title, author, or keyword'),
      mediaType: z
        .enum([
          'book',
          'movie',
          'tv',
          'podcast',
          'article',
          'game',
          'music',
          'video',
        ])
        .optional()
        .describe('Filter by media type'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Max results to return'),
    },
    async ({ query, mediaType, limit }) => {
      const { results, total } = await client.searchMedia(
        query,
        mediaType,
        limit
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No results found for "${query}"${mediaType ? ` (type: ${mediaType})` : ''}. Try a different search term, or use add_to_library to add it manually.`,
            },
          ],
        };
      }

      const formatted = results
        .map((item) => {
          const parts = [`**${item.title}**`];
          if (item.creator) parts.push(`by ${item.creator}`);
          parts.push(`[${item.mediaType}]`);
          if (item.publishedYear) parts.push(`(${item.publishedYear})`);
          if (item.averageRating)
            parts.push(`★ ${item.averageRating.toFixed(1)}`);
          parts.push(`ID: ${item.id}`);
          return parts.join(' — ');
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${total} result${total !== 1 ? 's' : ''} for "${query}":\n\n${formatted}`,
          },
        ],
      };
    }
  );
}
