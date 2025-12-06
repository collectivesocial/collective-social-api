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

      const tags = await (ctx.db as any)
        .selectFrom('media_item_tags')
        .innerJoin('tags', 'media_item_tags.tag_id', 'tags.id')
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
          .select('is_admin')
          .where('did', '=', agent.did!)
          .executeTakeFirst();

        if (!user || !user.is_admin) {
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
};
