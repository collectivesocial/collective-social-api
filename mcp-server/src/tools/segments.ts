import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CollectiveClient } from '../client.js';

export function registerSegmentTools(
  server: McpServer,
  client: CollectiveClient
): void {
  server.tool(
    'list_group_memberships',
    "List the book clubs and groups the user is a member of on Collective.",
    {},
    async () => {
      const groups = await client.listGroups();

      if (groups.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'You are not a member of any groups on Collective.',
            },
          ],
        };
      }

      const formatted = groups
        .map((g) => `- **${g.name}**${g.description ? `: ${g.description}` : ''} (DID: ${g.communityDid})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Your groups:\n\n${formatted}`,
          },
        ],
      };
    }
  );

  server.tool(
    'list_upcoming_segments',
    'List upcoming reading/watching segments (assignments) for a book club group. Shows segments with future due dates to help with accountability.',
    {
      communityDid: z
        .string()
        .describe(
          'The DID of the group/book club. Use list_group_memberships to find this.'
        ),
      itemRkey: z
        .string()
        .describe(
          'The record key of the list item (book/media) in the group schedule.'
        ),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe('Whether to include already-completed segments'),
    },
    async ({ communityDid, itemRkey, includeCompleted }) => {
      const { segments } = await client.listSegments(communityDid, itemRkey);

      if (segments.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No segments found for this item.',
            },
          ],
        };
      }

      // Filter to upcoming segments (assignedDate in the future or no date)
      const now = new Date();
      let filtered = segments;

      if (!includeCompleted) {
        // Check progress for each segment
        const progressChecks = await Promise.all(
          segments.map(async (seg) => {
            const { progress } = await client.getSegmentProgress(
              communityDid,
              seg.rkey
            );
            return { segment: seg, completed: progress?.completed ?? false };
          })
        );
        filtered = progressChecks
          .filter((p) => !p.completed)
          .map((p) => p.segment);
      }

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '🎉 All segments are completed! Nice work.',
            },
          ],
        };
      }

      const formatted = filtered
        .sort((a, b) => a.order - b.order)
        .map((seg) => {
          const parts = [`- **${seg.label}**`];
          if (seg.assignedDate) {
            const due = new Date(seg.assignedDate);
            const isOverdue = due < now;
            const dateStr = due.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            parts.push(isOverdue ? `⚠️ Due: ${dateStr} (overdue)` : `📅 Due: ${dateStr}`);
          }
          if (seg.startPage && seg.endPage) {
            parts.push(`(pages ${seg.startPage}–${seg.endPage})`);
          }
          return parts.join(' ');
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Upcoming segments:\n\n${formatted}`,
          },
        ],
      };
    }
  );

  server.tool(
    'get_segment_progress',
    'Check whether a specific reading segment has been completed.',
    {
      communityDid: z.string().describe('The DID of the group/book club'),
      segmentRkey: z.string().describe('The record key of the segment'),
    },
    async ({ communityDid, segmentRkey }) => {
      const { progress } = await client.getSegmentProgress(
        communityDid,
        segmentRkey
      );

      if (!progress) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '❌ This segment has not been completed yet.',
            },
          ],
        };
      }

      if (progress.completed) {
        const date = new Date(progress.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ Segment completed on ${date}.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: '❌ This segment has not been completed yet.',
          },
        ],
      };
    }
  );

  server.tool(
    'complete_segment',
    'Mark a reading/watching segment as completed. This updates both the group roster (so others can see your progress) and your personal library progress.',
    {
      communityDid: z.string().describe('The DID of the group/book club'),
      segmentRkey: z.string().describe('The record key of the segment to complete'),
    },
    async ({ communityDid, segmentRkey }) => {
      const result = await client.completeSegment(communityDid, segmentRkey);

      if (result.alreadyExists) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '✅ This segment was already marked as completed.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: '✅ Segment marked as completed! Your progress has been updated in both the group roster and your personal library.',
          },
        ],
      };
    }
  );
}
