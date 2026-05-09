/**
 * groupEvents.ts — service layer for Events V1
 *
 * Events are group-owned records stored on the community PDS:
 *   collection: 'community.lexicon.calendar.event'
 *
 * RSVPs are user-owned records stored on the user's own PDS:
 *   collection: 'community.lexicon.calendar.rsvp'
 *
 * The `event_rsvps` Postgres table caches RSVP state for aggregation
 * (counts, attendee lists, community-level queries).
 *
 * Token format (per Simon's canonical shapes — simon-event-lexicon-shapes.md):
 *   mode:   "community.lexicon.calendar.event#virtual"   ← full NSID + fragment
 *   status: "community.lexicon.calendar.event#scheduled"
 *   rsvp:   "community.lexicon.calendar.rsvp#going"
 */

import { Agent } from '@atproto/api';
import { TID } from '@atproto/common';
import type { Kysely } from 'kysely';
import * as opensocial from './opensocial';

const COL_EVENT = 'community.lexicon.calendar.event';
const COL_RSVP = 'community.lexicon.calendar.rsvp';

export type RsvpStatus = 'going' | 'interested' | 'notgoing';

export interface EventRecord {
  uri: string;
  cid: string;
  rkey: string;
  name: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  mode?: string;
  status?: string;
  locations?: Array<{
    name?: string;
    locality?: string;
    region?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
  uris?: Array<{ uri: string; name?: string }>;
  createdAt: string;
}

export interface RsvpRow {
  event_uri: string;
  event_cid: string;
  community_did: string;
  user_did: string;
  rsvp_uri: string;
  status: string;
  rsvp_at: Date;
  updated_at: Date;
}

/** Map the raw RSVP status string to the full token. */
function rsvpStatusToken(status: RsvpStatus): string {
  return `${COL_RSVP}#${status}`;
}

/** Parse a stored token back to the short status. */
function parseRsvpStatus(token: string): RsvpStatus {
  const fragment = token.split('#')[1];
  return fragment as RsvpStatus;
}

// ─── Events ────────────────────────────────────────────────────────────────

export async function createEvent(
  communityDid: string,
  userDid: string,
  data: {
    name: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    mode?: 'virtual' | 'inperson' | 'hybrid';
    status?: 'scheduled' | 'cancelled' | 'postponed';
    locations?: EventRecord['locations'];
    uris?: EventRecord['uris'];
  }
): Promise<EventRecord> {
  const rkey = TID.nextStr();
  const now = new Date().toISOString();

  const record: Record<string, unknown> = {
    name: data.name,
    createdAt: now,
  };
  if (data.description) record.description = data.description;
  if (data.startsAt) record.startsAt = data.startsAt;
  if (data.endsAt) record.endsAt = data.endsAt;
  if (data.mode) record.mode = `${COL_EVENT}#${data.mode}`;
  if (data.status) record.status = `${COL_EVENT}#${data.status}`;
  else record.status = `${COL_EVENT}#scheduled`;
  if (data.locations?.length) record.locations = data.locations;
  if (data.uris?.length) record.uris = data.uris;

  const response = await opensocial.createCommunityRecord(
    communityDid,
    userDid,
    COL_EVENT,
    record,
    rkey
  );

  return {
    uri: response.uri,
    cid: response.cid,
    rkey,
    name: data.name,
    description: data.description,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    mode: data.mode ? `${COL_EVENT}#${data.mode}` : undefined,
    status: data.status
      ? `${COL_EVENT}#${data.status}`
      : `${COL_EVENT}#scheduled`,
    locations: data.locations,
    uris: data.uris,
    createdAt: now,
  };
}

export async function listEvents(
  communityDid: string,
  db: Kysely<any>
): Promise<Array<EventRecord & { rsvpCounts: Record<RsvpStatus, number> }>> {
  const rawEvents = await opensocial.listAllCommunityRecords(
    communityDid,
    COL_EVENT
  );

  // Batch fetch RSVP counts for all events
  const eventUris = rawEvents.map((e: any) => e.uri);
  const rsvpRows = eventUris.length
    ? await db
        .selectFrom('event_rsvps')
        .select(['event_uri', 'status'])
        .where('event_uri', 'in', eventUris)
        .execute()
    : [];

  const countsByEvent: Record<string, Record<string, number>> = {};
  for (const row of rsvpRows) {
    const shortStatus = parseRsvpStatus(row.status);
    if (!countsByEvent[row.event_uri]) {
      countsByEvent[row.event_uri] = { going: 0, interested: 0, notgoing: 0 };
    }
    countsByEvent[row.event_uri][shortStatus] =
      (countsByEvent[row.event_uri][shortStatus] ?? 0) + 1;
  }

  return rawEvents.map((e: any) => {
    const rkey = e.uri.split('/').at(-1)!;
    const counts = countsByEvent[e.uri] ?? {
      going: 0,
      interested: 0,
      notgoing: 0,
    };
    return {
      uri: e.uri,
      cid: e.cid,
      rkey,
      ...e.value,
      rsvpCounts: counts as Record<RsvpStatus, number>,
    };
  });
}

export async function getEvent(
  communityDid: string,
  eventRkey: string,
  db: Kysely<any>
): Promise<(EventRecord & { rsvpCounts: Record<RsvpStatus, number> }) | null> {
  let record: any;
  try {
    record = await opensocial.getCommunityRecord(
      communityDid,
      COL_EVENT,
      eventRkey
    );
  } catch {
    return null;
  }

  const rsvpRows = await db
    .selectFrom('event_rsvps')
    .select(['status'])
    .where('event_uri', '=', record.uri)
    .execute();

  const counts: Record<string, number> = {
    going: 0,
    interested: 0,
    notgoing: 0,
  };
  for (const row of rsvpRows) {
    const shortStatus = parseRsvpStatus(row.status);
    counts[shortStatus] = (counts[shortStatus] ?? 0) + 1;
  }

  return {
    uri: record.uri,
    cid: record.cid,
    rkey: eventRkey,
    ...record.value,
    rsvpCounts: counts as Record<RsvpStatus, number>,
  };
}

export async function updateEvent(
  communityDid: string,
  userDid: string,
  eventRkey: string,
  data: Partial<{
    name: string;
    description: string;
    startsAt: string;
    endsAt: string;
    mode: 'virtual' | 'inperson' | 'hybrid';
    status: 'scheduled' | 'cancelled' | 'postponed';
    locations: EventRecord['locations'];
    uris: EventRecord['uris'];
  }>
): Promise<EventRecord> {
  const existing = await opensocial.getCommunityRecord(
    communityDid,
    COL_EVENT,
    eventRkey
  );
  const merged: Record<string, unknown> = { ...(existing.value as object) };

  if (data.name !== undefined) merged.name = data.name;
  if (data.description !== undefined) merged.description = data.description;
  if (data.startsAt !== undefined) merged.startsAt = data.startsAt;
  if (data.endsAt !== undefined) merged.endsAt = data.endsAt;
  if (data.mode !== undefined) merged.mode = `${COL_EVENT}#${data.mode}`;
  if (data.status !== undefined) merged.status = `${COL_EVENT}#${data.status}`;
  if (data.locations !== undefined) merged.locations = data.locations;
  if (data.uris !== undefined) merged.uris = data.uris;

  await opensocial.updateCommunityRecord(
    communityDid,
    userDid,
    COL_EVENT,
    eventRkey,
    merged
  );

  return {
    uri: existing.uri,
    cid: existing.cid,
    rkey: eventRkey,
    ...(merged as Omit<EventRecord, 'uri' | 'cid' | 'rkey'>),
  };
}

export async function deleteEvent(
  communityDid: string,
  userDid: string,
  eventRkey: string,
  eventUri: string,
  db: Kysely<any>
): Promise<void> {
  // 1. Delete community PDS record
  await opensocial.deleteCommunityRecord(
    communityDid,
    userDid,
    COL_EVENT,
    eventRkey
  );

  // 2. Cascade-delete RSVP cache rows
  await db
    .deleteFrom('event_rsvps')
    .where('event_uri', '=', eventUri)
    .execute();
}

// ─── RSVPs ─────────────────────────────────────────────────────────────────

export async function rsvpToEvent(
  agent: Agent,
  communityDid: string,
  eventUri: string,
  eventCid: string,
  eventRkey: string,
  status: RsvpStatus,
  db: Kysely<any>
): Promise<{ rsvpUri: string }> {
  const rsvpRecord = {
    $type: COL_RSVP,
    subject: {
      uri: eventUri,
      cid: eventCid,
    },
    status: rsvpStatusToken(status),
  };

  // 1. Write RSVP to user's own PDS (idempotent putRecord; rkey = eventRkey)
  const response = await agent.api.com.atproto.repo.putRecord({
    repo: agent.did!,
    collection: COL_RSVP,
    rkey: eventRkey,
    record: rsvpRecord as any,
  });

  // 2. Upsert into event_rsvps cache
  const now = new Date();
  await (db as any)
    .insertInto('event_rsvps')
    .values({
      event_uri: eventUri,
      event_cid: eventCid,
      community_did: communityDid,
      user_did: agent.did!,
      rsvp_uri: response.data.uri,
      status: rsvpStatusToken(status),
      rsvp_at: now,
      updated_at: now,
    })
    .onConflict((oc: any) =>
      oc.columns(['event_uri', 'user_did']).doUpdateSet({
        status: rsvpStatusToken(status),
        rsvp_uri: response.data.uri,
        updated_at: now,
      })
    )
    .execute();

  return { rsvpUri: response.data.uri };
}

export async function removeRsvp(
  agent: Agent,
  eventUri: string,
  eventRkey: string,
  db: Kysely<any>
): Promise<void> {
  // 1. Delete from user's own PDS
  try {
    await agent.api.com.atproto.repo.deleteRecord({
      repo: agent.did!,
      collection: COL_RSVP,
      rkey: eventRkey,
    });
  } catch (err: any) {
    // If already deleted from PDS, still clean up the DB row
    if (!err?.status || err.status !== 404) throw err;
  }

  // 2. Remove from cache
  await db
    .deleteFrom('event_rsvps')
    .where('event_uri', '=', eventUri)
    .where('user_did', '=', agent.did!)
    .execute();
}

export async function listRsvps(
  eventUri: string,
  db: Kysely<any>,
  opts: {
    status?: RsvpStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ rows: RsvpRow[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let query = db
    .selectFrom('event_rsvps')
    .selectAll()
    .where('event_uri', '=', eventUri);
  let countQuery = db
    .selectFrom('event_rsvps')
    .select(({ fn }: any) => [fn.countAll().as('count')])
    .where('event_uri', '=', eventUri);

  if (opts.status) {
    const token = rsvpStatusToken(opts.status);
    query = query.where('status', '=', token);
    countQuery = countQuery.where('status', '=', token);
  }

  const [rows, countRow] = await Promise.all([
    query.orderBy('rsvp_at', 'asc').limit(limit).offset(offset).execute(),
    countQuery.executeTakeFirst(),
  ]);

  return {
    rows: rows as RsvpRow[],
    total: parseInt((countRow as any)?.count ?? '0', 10),
  };
}
