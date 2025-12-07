import { Express, Request, Response } from 'express';
import { AppContext } from '../context';
import { sql } from 'kysely';
import { getSessionAgent } from '../auth/agent';

export const createRouter = (ctx: AppContext, app: Express) => {
  // Normalize tag name to slug format
  const normalizeTag = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-') // Convert spaces and underscores to hyphens
      .replace(/[^\w-]/g, '') // Remove special characters except hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  };

  // Search tags with autocomplete
  app.get('/tags/search', async (req: Request, res: Response) => {
    try {
      const { q } = req.query;

      if (!q || typeof q !== 'string' || q.trim().length === 0) {
        return res.json({ tags: [] });
      }

      const searchTerm = q.trim().toLowerCase();

      // Search for tags by name or slug, include usage count
      const tags = await (ctx.db as any)
        .selectFrom('tags')
        .leftJoin('media_item_tags', 'tags.id', 'media_item_tags.tag_id')
        .select([
          'tags.id',
          'tags.name',
          'tags.slug',
          'tags.status',
          sql<number>`COUNT(DISTINCT media_item_tags.media_item_id)`.as(
            'usageCount'
          ),
        ])
        .where('tags.status', '=', 'active')
        .where((eb: any) =>
          eb.or([
            eb('tags.name', 'ilike', `%${searchTerm}%`),
            eb('tags.slug', 'ilike', `%${searchTerm}%`),
          ])
        )
        .groupBy(['tags.id', 'tags.name', 'tags.slug', 'tags.status'])
        .orderBy(sql`COUNT(DISTINCT media_item_tags.media_item_id)`, 'desc')
        .limit(10)
        .execute();

      res.json({ tags });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to search tags');
      res.status(500).json({ error: 'Failed to search tags' });
    }
  });

  // Get tags for a specific media item
  app.get('/media/:itemId/tags', async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;

      // Exclude tags that have pending reports for this item
      const tags = await (ctx.db as any)
        .selectFrom('media_item_tags')
        .innerJoin('tags', 'media_item_tags.tag_id', 'tags.id')
        .leftJoin('tag_reports', (join: any) =>
          join
            .onRef('tag_reports.tag_id', '=', 'tags.id')
            .onRef('tag_reports.item_id', '=', 'media_item_tags.media_item_id')
            .on('tag_reports.status', '=', 'pending')
        )
        .select([
          'tags.id',
          'tags.name',
          'tags.slug',
          sql<number>`COUNT(DISTINCT media_item_tags.media_item_id)`.as(
            'usageCount'
          ),
        ])
        .where('media_item_tags.media_item_id', '=', parseInt(itemId))
        .where('tags.status', '=', 'active')
        .where('tag_reports.id', 'is', null) // Exclude tags with pending reports
        .groupBy(['tags.id', 'tags.name', 'tags.slug'])
        .orderBy('tags.name', 'asc')
        .execute();

      res.json({ tags });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to fetch item tags');
      res.status(500).json({ error: 'Failed to fetch tags' });
    }
  });

  // Add tag to media item
  app.post('/media/:itemId/tags', async (req: Request, res: Response) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { itemId } = req.params;
      const { tagName } = req.body;

      if (
        !tagName ||
        typeof tagName !== 'string' ||
        tagName.trim().length === 0
      ) {
        return res.status(400).json({ error: 'Tag name is required' });
      }

      const slug = normalizeTag(tagName);

      if (slug.length === 0) {
        return res.status(400).json({ error: 'Invalid tag name' });
      }

      // Check if media item exists
      const item = await ctx.db
        .selectFrom('media_items')
        .select('id')
        .where('id', '=', parseInt(itemId))
        .executeTakeFirst();

      if (!item) {
        return res.status(404).json({ error: 'Media item not found' });
      }

      // Find or create tag
      let tag = await ctx.db
        .selectFrom('tags')
        .select(['id', 'name', 'slug'])
        .where('slug', '=', slug)
        .where('status', '=', 'active')
        .executeTakeFirst();

      if (!tag) {
        // Create new tag
        tag = await ctx.db
          .insertInto('tags')
          .values({
            name: tagName.trim(),
            slug: slug,
            status: 'active',
            created_at: new Date(),
          } as any)
          .returning(['id', 'name', 'slug'])
          .executeTakeFirstOrThrow();

        ctx.logger.info({ tagId: tag.id, slug }, 'Created new tag');
      }

      // Check if user already tagged this item with this tag
      const existing = await (ctx.db as any)
        .selectFrom('media_item_tags')
        .select('tag_id')
        .where('media_item_id', '=', parseInt(itemId))
        .where('tag_id', '=', tag.id)
        .where('user_did', '=', agent.did!)
        .executeTakeFirst();

      if (existing) {
        return res
          .status(400)
          .json({ error: 'You have already added this tag to this item' });
      }

      // Add tag to item
      await (ctx.db as any)
        .insertInto('media_item_tags')
        .values({
          media_item_id: parseInt(itemId),
          tag_id: tag.id,
          user_did: agent.did!,
          created_at: new Date(),
        })
        .execute();

      ctx.logger.info(
        { itemId, tagId: tag.id, userDid: agent.did },
        'Added tag to media item'
      );

      // Get usage count
      const usageCount = await (ctx.db as any)
        .selectFrom('media_item_tags')
        .select(sql<number>`COUNT(DISTINCT media_item_id)`.as('count'))
        .where('tag_id', '=', tag.id)
        .executeTakeFirst();

      res.json({
        tag: {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          usageCount: usageCount?.count || 1,
        },
      });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to add tag');
      res.status(500).json({ error: 'Failed to add tag' });
    }
  });

  // Remove tag from media item (admin only)
  app.delete(
    '/media/:itemId/tags/:tagId',
    async (req: Request, res: Response) => {
      try {
        const agent = await getSessionAgent(req, res, ctx);
        if (!agent) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if user is admin
        const user = await (ctx.db as any)
          .selectFrom('users')
          .select('isAdmin')
          .where('did', '=', agent.did!)
          .executeTakeFirst();

        if (!user || !user.isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { itemId, tagId } = req.params;

        // Delete all tag associations for this item and tag
        const result = await (ctx.db as any)
          .deleteFrom('media_item_tags')
          .where('media_item_id', '=', parseInt(itemId))
          .where('tag_id', '=', parseInt(tagId))
          .executeTakeFirst();

        if (result.numDeletedRows === BigInt(0)) {
          return res.status(404).json({ error: 'Tag association not found' });
        }

        ctx.logger.info(
          { itemId, tagId, userDid: agent.did },
          'Removed tag from media item'
        );

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to remove tag');
        res.status(500).json({ error: 'Failed to remove tag' });
      }
    }
  );

  // Get all tags with statistics (admin only)
  app.get('/admin/tags', async (req: Request, res: Response) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      const user = await (ctx.db as any)
        .selectFrom('users')
        .select('isAdmin')
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const tags = await (ctx.db as any)
        .selectFrom('tags')
        .leftJoin('media_item_tags', 'tags.id', 'media_item_tags.tag_id')
        .select([
          'tags.id',
          'tags.name',
          'tags.slug',
          'tags.status',
          'tags.created_at',
          sql<number>`COUNT(DISTINCT media_item_tags.media_item_id)`.as(
            'itemCount'
          ),
          sql<number>`COUNT(DISTINCT media_item_tags.user_did)`.as('userCount'),
        ])
        .groupBy([
          'tags.id',
          'tags.name',
          'tags.slug',
          'tags.status',
          'tags.created_at',
        ])
        .orderBy('itemCount', 'desc')
        .execute();

      res.json({ tags });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to fetch admin tags');
      res.status(500).json({ error: 'Failed to fetch tags' });
    }
  });

  // Get merge preview for two tags (admin only)
  app.get('/admin/tags/merge-preview', async (req: Request, res: Response) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      const user = await (ctx.db as any)
        .selectFrom('users')
        .select('isAdmin')
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { sourceTagId, targetTagId } = req.query;

      if (!sourceTagId || !targetTagId) {
        return res
          .status(400)
          .json({ error: 'Source and target tag IDs required' });
      }

      // Get affected items and users
      const affectedItems = await (ctx.db as any)
        .selectFrom('media_item_tags')
        .innerJoin(
          'media_items',
          'media_item_tags.media_item_id',
          'media_items.id'
        )
        .select([
          'media_items.id',
          'media_items.title',
          'media_items.creator',
          'media_items.media_type',
          'media_item_tags.user_did',
        ])
        .where('media_item_tags.tag_id', '=', parseInt(sourceTagId as string))
        .execute();

      // Check for duplicates (same item + user with target tag)
      const duplicates = await (ctx.db as any)
        .selectFrom('media_item_tags as source')
        .innerJoin('media_item_tags as target', (join: any) =>
          join
            .onRef('source.media_item_id', '=', 'target.media_item_id')
            .onRef('source.user_did', '=', 'target.user_did')
        )
        .select(['source.media_item_id', 'source.user_did'])
        .where('source.tag_id', '=', parseInt(sourceTagId as string))
        .where('target.tag_id', '=', parseInt(targetTagId as string))
        .execute();

      res.json({
        affectedItems,
        duplicateCount: duplicates.length,
        duplicates,
      });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to get merge preview');
      res.status(500).json({ error: 'Failed to get merge preview' });
    }
  });

  // Merge tags (admin only)
  app.post('/admin/tags/merge', async (req: Request, res: Response) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      const user = await (ctx.db as any)
        .selectFrom('users')
        .select('isAdmin')
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { sourceTagId, targetTagId } = req.body;

      if (!sourceTagId || !targetTagId) {
        return res
          .status(400)
          .json({ error: 'Source and target tag IDs required' });
      }

      if (sourceTagId === targetTagId) {
        return res
          .status(400)
          .json({ error: 'Cannot merge a tag with itself' });
      }

      // Start transaction-like operations
      // 1. Delete duplicate entries (same item + user with both tags)
      await (ctx.db as any)
        .deleteFrom('media_item_tags')
        .where((eb: any) =>
          eb.and([
            eb('tag_id', '=', sourceTagId),
            eb.exists(
              eb
                .selectFrom('media_item_tags as target')
                .select('target.tag_id')
                .whereRef(
                  'target.media_item_id',
                  '=',
                  'media_item_tags.media_item_id'
                )
                .whereRef('target.user_did', '=', 'media_item_tags.user_did')
                .where('target.tag_id', '=', targetTagId)
            ),
          ])
        )
        .execute();

      // 2. Update remaining source tag references to target tag
      const updateResult = await (ctx.db as any)
        .updateTable('media_item_tags')
        .set({ tag_id: targetTagId })
        .where('tag_id', '=', sourceTagId)
        .executeTakeFirst();

      // 3. Mark source tag as merged
      await (ctx.db as any)
        .updateTable('tags')
        .set({ status: 'merged' })
        .where('id', '=', sourceTagId)
        .execute();

      ctx.logger.info(
        {
          sourceTagId,
          targetTagId,
          rowsUpdated: updateResult.numUpdatedRows,
          userDid: agent.did,
        },
        'Merged tags'
      );

      res.json({
        success: true,
        rowsUpdated: Number(updateResult.numUpdatedRows || 0),
      });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to merge tags');
      res.status(500).json({ error: 'Failed to merge tags' });
    }
  });

  // Report a tag on a specific item
  app.post(
    '/media/:itemId/tags/:tagId/report',
    async (req: Request, res: Response) => {
      try {
        const agent = await getSessionAgent(req, res, ctx);
        if (!agent) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        const { itemId, tagId } = req.params;
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
          return res.status(400).json({ error: 'Reason is required' });
        }

        const now = new Date();

        // Check if user already reported this tag on this item
        const existingReport = await (ctx.db as any)
          .selectFrom('tag_reports')
          .select('id')
          .where('item_id', '=', parseInt(itemId))
          .where('tag_id', '=', parseInt(tagId))
          .where('reporter_did', '=', agent.did!)
          .where('status', '=', 'pending')
          .executeTakeFirst();

        if (existingReport) {
          return res
            .status(400)
            .json({ error: 'You have already reported this tag' });
        }

        await (ctx.db as any)
          .insertInto('tag_reports')
          .values({
            item_id: parseInt(itemId),
            tag_id: parseInt(tagId),
            reporter_did: agent.did!,
            reason: reason.trim(),
            created_at: now,
            status: 'pending',
          })
          .execute();

        ctx.logger.info(
          { itemId, tagId, reporterDid: agent.did, reason },
          'Tag reported'
        );

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to report tag');
        res.status(500).json({ error: 'Failed to report tag' });
      }
    }
  );

  // Get all tag reports (admin only)
  app.get('/admin/tag-reports', async (req: Request, res: Response) => {
    try {
      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      const user = await (ctx.db as any)
        .selectFrom('users')
        .select('isAdmin')
        .where('did', '=', agent.did!)
        .executeTakeFirst();

      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { status } = req.query;

      let query = (ctx.db as any)
        .selectFrom('tag_reports')
        .innerJoin('tags', 'tag_reports.tag_id', 'tags.id')
        .innerJoin('media_items', 'tag_reports.item_id', 'media_items.id')
        .select([
          'tag_reports.id',
          'tag_reports.item_id',
          'tag_reports.tag_id',
          'tag_reports.reporter_did',
          'tag_reports.reason',
          'tag_reports.created_at',
          'tag_reports.status',
          'tags.name as tag_name',
          'tags.slug as tag_slug',
          'media_items.title as item_title',
          'media_items.creator as item_creator',
          'media_items.mediaType as item_media_type',
        ]);

      if (status && status !== 'all') {
        query = query.where('tag_reports.status', '=', status);
      }

      const reports = await query
        .orderBy('tag_reports.created_at', 'desc')
        .execute();

      // Get report counts per tag per item
      const reportCounts = await (ctx.db as any)
        .selectFrom('tag_reports')
        .select([
          'tag_reports.item_id',
          'tag_reports.tag_id',
          sql<number>`COUNT(*)`.as('report_count'),
        ])
        .where('tag_reports.status', '=', 'pending')
        .groupBy(['tag_reports.item_id', 'tag_reports.tag_id'])
        .execute();

      res.json({ reports, reportCounts });
    } catch (err) {
      ctx.logger.error({ err }, 'Failed to fetch tag reports');
      res.status(500).json({ error: 'Failed to fetch tag reports' });
    }
  });

  // Remove tag from item (via report moderation)
  app.post(
    '/admin/tag-reports/:reportId/remove-tag',
    async (req: Request, res: Response) => {
      try {
        const agent = await getSessionAgent(req, res, ctx);
        if (!agent) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if user is admin
        const user = await (ctx.db as any)
          .selectFrom('users')
          .select('isAdmin')
          .where('did', '=', agent.did!)
          .executeTakeFirst();

        if (!user || !user.isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { reportId } = req.params;

        // Get the report details
        const report = await (ctx.db as any)
          .selectFrom('tag_reports')
          .select(['item_id', 'tag_id'])
          .where('id', '=', parseInt(reportId))
          .executeTakeFirst();

        if (!report) {
          return res.status(404).json({ error: 'Report not found' });
        }

        // Remove the tag from the item (all user associations)
        await (ctx.db as any)
          .deleteFrom('media_item_tags')
          .where('media_item_id', '=', report.item_id)
          .where('tag_id', '=', report.tag_id)
          .execute();

        // Mark all related reports as resolved
        await (ctx.db as any)
          .updateTable('tag_reports')
          .set({ status: 'resolved' })
          .where('item_id', '=', report.item_id)
          .where('tag_id', '=', report.tag_id)
          .execute();

        ctx.logger.info(
          {
            reportId,
            itemId: report.item_id,
            tagId: report.tag_id,
            adminDid: agent.did,
          },
          'Tag removed from item via report'
        );

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to remove tag');
        res.status(500).json({ error: 'Failed to remove tag' });
      }
    }
  );

  // Dismiss a tag report
  app.post(
    '/admin/tag-reports/:reportId/dismiss',
    async (req: Request, res: Response) => {
      try {
        const agent = await getSessionAgent(req, res, ctx);
        if (!agent) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if user is admin
        const user = await (ctx.db as any)
          .selectFrom('users')
          .select('isAdmin')
          .where('did', '=', agent.did!)
          .executeTakeFirst();

        if (!user || !user.isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { reportId } = req.params;

        await (ctx.db as any)
          .updateTable('tag_reports')
          .set({ status: 'dismissed' })
          .where('id', '=', parseInt(reportId))
          .execute();

        ctx.logger.info(
          { reportId, adminDid: agent.did },
          'Tag report dismissed'
        );

        res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to dismiss report');
        res.status(500).json({ error: 'Failed to dismiss report' });
      }
    }
  );
};
