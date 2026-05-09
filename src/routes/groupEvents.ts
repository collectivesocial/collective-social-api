/**
 * groupEvents.ts — routes for Events V1
 *
 * Mounted at /groups/:communityDid/events (via index.ts)
 * All routes require group membership (memberOnly) or admin (adminOnly).
 *
 * Event records live on the community PDS (community.lexicon.calendar.event).
 * RSVP records live on the user's own PDS (community.lexicon.calendar.rsvp).
 * The event_rsvps Postgres table caches RSVP state for aggregation.
 */

import express, { Response } from 'express';
import type { AppContext } from '../context';
import { handler } from '../lib/http';
import {
  requireGroupMember,
  requireGroupAdmin,
  GroupAuthRequest,
} from '../middleware/groupAuth';
import { getSessionAgent } from '../auth/agent';
import * as groupEventsService from '../services/groupEvents';
import type { RsvpStatus } from '../services/groupEvents';

const VALID_RSVP_STATUSES: RsvpStatus[] = ['going', 'interested', 'notgoing'];

export const createRouter = (ctx: AppContext) => {
  const router = express.Router({ mergeParams: true });

  const memberOnly = requireGroupMember(ctx);
  const adminOnly = requireGroupAdmin(ctx);

  // ═══════════════════════════════════════════════════════════════
  // EVENT CRUD
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /groups/:communityDid/events
   * Create an event. Admin only.
   */
  router.post(
    '/',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const {
        name,
        description,
        startsAt,
        endsAt,
        mode,
        status,
        locations,
        uris,
      } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Event name is required' });
      }

      if (mode && !['virtual', 'inperson', 'hybrid'].includes(mode)) {
        return res
          .status(400)
          .json({ error: 'Invalid mode. Use: virtual, inperson, hybrid' });
      }

      if (status && !['scheduled', 'cancelled', 'postponed'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Use: scheduled, cancelled, postponed',
        });
      }

      try {
        const event = await groupEventsService.createEvent(
          communityDid,
          userDid,
          {
            name: name.trim(),
            description,
            startsAt,
            endsAt,
            mode,
            status,
            locations,
            uris,
          }
        );
        return res.status(201).json({ event });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to create event');
        return res.status(500).json({ error: 'Failed to create event' });
      }
    })
  );

  /**
   * GET /groups/:communityDid/events
   * List all events with RSVP aggregates. Any member can read.
   */
  router.get(
    '/',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;

      try {
        const events = await groupEventsService.listEvents(
          communityDid,
          ctx.db
        );
        return res.json({ events });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to list events');
        return res.status(500).json({ error: 'Failed to list events' });
      }
    })
  );

  /**
   * GET /groups/:communityDid/events/:eventRkey
   * Single event detail with RSVP counts.
   */
  router.get(
    '/:eventRkey',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;

      try {
        const event = await groupEventsService.getEvent(
          communityDid,
          eventRkey,
          ctx.db
        );
        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }
        return res.json({ event });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to get event');
        return res.status(500).json({ error: 'Failed to get event' });
      }
    })
  );

  /**
   * PUT /groups/:communityDid/events/:eventRkey
   * Update event. Admin only.
   */
  router.put(
    '/:eventRkey',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;
      const {
        name,
        description,
        startsAt,
        endsAt,
        mode,
        status,
        locations,
        uris,
      } = req.body;

      if (
        mode !== undefined &&
        !['virtual', 'inperson', 'hybrid'].includes(mode)
      ) {
        return res
          .status(400)
          .json({ error: 'Invalid mode. Use: virtual, inperson, hybrid' });
      }

      if (
        status !== undefined &&
        !['scheduled', 'cancelled', 'postponed'].includes(status)
      ) {
        return res.status(400).json({
          error: 'Invalid status. Use: scheduled, cancelled, postponed',
        });
      }

      try {
        const event = await groupEventsService.updateEvent(
          communityDid,
          userDid,
          eventRkey,
          { name, description, startsAt, endsAt, mode, status, locations, uris }
        );
        return res.json({ event });
      } catch (err: any) {
        if (err?.status === 404) {
          return res.status(404).json({ error: 'Event not found' });
        }
        ctx.logger.error({ err }, 'Failed to update event');
        return res.status(500).json({ error: 'Failed to update event' });
      }
    })
  );

  /**
   * DELETE /groups/:communityDid/events/:eventRkey
   * Delete event. Admin only. Cascades event_rsvps rows.
   */
  router.delete(
    '/:eventRkey',
    adminOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { userDid, communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;

      // Fetch first to get the URI (needed for cascade delete)
      const existing = await groupEventsService.getEvent(
        communityDid,
        eventRkey,
        ctx.db
      );
      if (!existing) {
        return res.status(404).json({ error: 'Event not found' });
      }

      try {
        await groupEventsService.deleteEvent(
          communityDid,
          userDid,
          eventRkey,
          existing.uri,
          ctx.db
        );
        return res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to delete event');
        return res.status(500).json({ error: 'Failed to delete event' });
      }
    })
  );

  // ═══════════════════════════════════════════════════════════════
  // RSVPs
  // ═══════════════════════════════════════════════════════════════

  /**
   * PUT /groups/:communityDid/events/:eventRkey/rsvp
   * Create or update an RSVP for the current user.
   * Body: { status: 'going' | 'interested' | 'notgoing' }
   *
   * Server orchestrates:
   *   1. putRecord to user's own PDS (community.lexicon.calendar.rsvp, rkey = eventRkey)
   *   2. UPSERT into event_rsvps cache table
   */
  router.put(
    '/:eventRkey/rsvp',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;
      const { status } = req.body;

      if (!status || !VALID_RSVP_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `status must be one of: ${VALID_RSVP_STATUSES.join(', ')}`,
        });
      }

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const event = await groupEventsService.getEvent(
        communityDid,
        eventRkey,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      try {
        const { rsvpUri } = await groupEventsService.rsvpToEvent(
          agent,
          communityDid,
          event.uri,
          event.cid,
          eventRkey,
          status as RsvpStatus,
          ctx.db
        );
        return res.json({ rsvpUri, status });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to RSVP to event');
        return res.status(500).json({ error: 'Failed to RSVP to event' });
      }
    })
  );

  /**
   * DELETE /groups/:communityDid/events/:eventRkey/rsvp
   * Remove the current user's RSVP.
   *
   * Deletes the user-PDS record AND the event_rsvps row.
   */
  router.delete(
    '/:eventRkey/rsvp',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;

      const agent = await getSessionAgent(req, res, ctx);
      if (!agent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const event = await groupEventsService.getEvent(
        communityDid,
        eventRkey,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      try {
        await groupEventsService.removeRsvp(
          agent,
          event.uri,
          eventRkey,
          ctx.db
        );
        return res.json({ success: true });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to remove RSVP');
        return res.status(500).json({ error: 'Failed to remove RSVP' });
      }
    })
  );

  /**
   * GET /groups/:communityDid/events/:eventRkey/rsvps
   * Paginated attendee list, optionally filtered by status.
   *
   * Query params:
   *   status  — 'going' | 'interested' | 'notgoing' (optional)
   *   limit   — number (default 50, max 100)
   *   offset  — number (default 0)
   */
  router.get(
    '/:eventRkey/rsvps',
    memberOnly,
    handler(async (req: GroupAuthRequest, res: Response) => {
      const { communityDid } = req.groupAuth!;
      const eventRkey = req.params.eventRkey as string;
      const statusFilter = req.query.status as RsvpStatus | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      if (statusFilter && !VALID_RSVP_STATUSES.includes(statusFilter)) {
        return res.status(400).json({
          error: `status must be one of: ${VALID_RSVP_STATUSES.join(', ')}`,
        });
      }

      const event = await groupEventsService.getEvent(
        communityDid,
        eventRkey,
        ctx.db
      );
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      try {
        const { rows, total } = await groupEventsService.listRsvps(
          event.uri,
          ctx.db,
          { status: statusFilter, limit, offset }
        );

        return res.json({
          rsvps: rows.map((r) => ({
            userDid: r.user_did,
            status: r.status.split('#')[1], // short form for clients
            rsvpUri: r.rsvp_uri,
            rsvpAt: r.rsvp_at,
          })),
          total,
          limit,
          offset,
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Failed to list RSVPs');
        return res.status(500).json({ error: 'Failed to list RSVPs' });
      }
    })
  );

  return router;
};
