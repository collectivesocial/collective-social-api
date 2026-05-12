import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CollectiveClient } from '../client.js';

export function registerLibraryTools(
  server: McpServer,
  client: CollectiveClient
): void {
  server.tool(
    'list_library',
    "List items in the user's Collective library. Returns books, articles, and other media the user is tracking, with their current status.",
    {
      status: z
        .enum(['want', 'in-progress', 'completed'])
        .optional()
        .describe('Filter by reading/watching status'),
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
    },
    async ({ status, mediaType }) => {
      let items = await client.listLibrary();

      if (status) {
        items = items.filter((item) => item.status === status);
      }
      if (mediaType) {
        items = items.filter((item) => item.mediaType === mediaType);
      }

      if (items.length === 0) {
        const filters = [status, mediaType].filter(Boolean).join(', ');
        return {
          content: [
            {
              type: 'text' as const,
              text: `No items found${filters ? ` matching: ${filters}` : ''}.`,
            },
          ],
        };
      }

      const grouped = items.reduce(
        (acc, item) => {
          const key = item.status;
          if (!acc[key]) acc[key] = [];
          acc[key].push(item);
          return acc;
        },
        {} as Record<string, typeof items>
      );

      let output = `Library: ${items.length} item${items.length !== 1 ? 's' : ''}\n\n`;

      for (const [groupStatus, groupItems] of Object.entries(grouped)) {
        const label =
          groupStatus === 'want'
            ? '📚 Want to read/watch'
            : groupStatus === 'in-progress'
              ? '📖 In progress'
              : '✅ Completed';
        output += `### ${label}\n`;
        for (const item of groupItems) {
          const parts = [`- **${item.title}**`];
          if (item.creator) parts.push(`by ${item.creator}`);
          parts.push(`[${item.mediaType}]`);
          if (item.rating) parts.push(`★ ${item.rating}`);
          output += parts.join(' ') + '\n';
        }
        output += '\n';
      }

      return {
        content: [{ type: 'text' as const, text: output.trim() }],
      };
    }
  );

  server.tool(
    'add_to_library',
    "Add a book, article, or other media item to the user's Collective library. If the item already exists in Collective's database, provide the mediaItemId. Otherwise, provide title and type to create it.",
    {
      title: z.string().describe('Title of the book, article, or media item'),
      creator: z
        .string()
        .optional()
        .describe('Author, director, or creator name'),
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
        .default('book')
        .describe('Type of media'),
      mediaItemId: z
        .number()
        .optional()
        .describe(
          'Existing media item ID from search_media. If provided, skips media creation.'
        ),
      status: z
        .enum(['want', 'in-progress', 'completed'])
        .default('want')
        .describe('Initial status — defaults to "want" (want to read/watch)'),
      isbn: z.string().optional().describe('ISBN for books'),
      url: z.string().optional().describe('URL for articles or videos'),
      notes: z.string().optional().describe('Private notes about this item'),
    },
    async ({
      title,
      creator,
      mediaType,
      mediaItemId,
      status,
      isbn,
      url,
      notes,
    }) => {
      // Step 1: Ensure media item exists in Collective's database
      let itemId = mediaItemId;

      if (!itemId) {
        const { mediaItemId: newId, existed } = await client.addMedia({
          title,
          creator,
          mediaType,
          isbn,
          url,
        });
        itemId = newId;
      }

      // Step 2: Create the useritem (adds to user's library on their PDS)
      const result = await client.addToLibrary({
        title,
        creator,
        mediaItemId: itemId,
        mediaType,
        status,
        notes,
      });

      if (result.existing) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `"${title}" is already in your library. Use update_item_status to change its status.`,
            },
          ],
        };
      }

      const statusEmoji =
        status === 'want' ? '📚' : status === 'in-progress' ? '📖' : '✅';
      return {
        content: [
          {
            type: 'text' as const,
            text: `${statusEmoji} Added "${title}"${creator ? ` by ${creator}` : ''} to your library with status: ${status}.`,
          },
        ],
      };
    }
  );

  server.tool(
    'update_item_status',
    "Update the status, rating, or notes for an item in the user's library. Use this to mark items as in-progress or completed.",
    {
      title: z
        .string()
        .describe(
          'Title of the item to update — used to find it in the library'
        ),
      status: z
        .enum(['want', 'in-progress', 'completed'])
        .optional()
        .describe('New status'),
      rating: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe('Rating from 0 to 5 (half-stars supported, e.g. 3.5)'),
      notes: z.string().optional().describe('Private notes to add or update'),
    },
    async ({ title, status, rating, notes }) => {
      // Find the item in the library by title
      const items = await client.listLibrary();
      const match = items.find(
        (item) => item.title.toLowerCase() === title.toLowerCase()
      );

      if (!match) {
        // Try fuzzy match
        const fuzzy = items.find((item) =>
          item.title.toLowerCase().includes(title.toLowerCase())
        );
        if (fuzzy) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Couldn't find exact match for "${title}". Did you mean "${fuzzy.title}"? Try again with the exact title.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `"${title}" not found in your library. Use add_to_library to add it first.`,
            },
          ],
        };
      }

      const update: Record<string, unknown> = {};
      if (status) update.status = status;
      if (rating !== undefined) update.rating = rating;
      if (notes) update.notes = notes;
      if (status === 'completed') update.completedAt = new Date().toISOString();

      await client.updateItemStatus(match.uri, update);

      const parts: string[] = [];
      if (status) {
        const emoji =
          status === 'want' ? '📚' : status === 'in-progress' ? '📖' : '✅';
        parts.push(`${emoji} Status → ${status}`);
      }
      if (rating !== undefined) parts.push(`★ ${rating}/5`);
      if (notes) parts.push(`Notes updated`);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated "${match.title}": ${parts.join(', ')}`,
          },
        ],
      };
    }
  );
}
