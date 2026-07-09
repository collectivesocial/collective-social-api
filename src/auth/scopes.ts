/**
 * OAuth scope for Collective Social.
 *
 * Deliberately granular rather than requesting `transition:generic` (the
 * broad, protocol-transition-era catch-all scope). Every `repo:` entry here
 * grants write access only — AT Protocol repos are public, so *reads*
 * (`com.atproto.repo.listRecords`/`getRecord`) never require scope
 * regardless of collection. `app.bsky.actor.getProfile` and handle
 * resolution are likewise public reads; the app performs those through the
 * unauthenticated `publicAgent` (see src/lib/publicAgent.ts) rather than
 * requesting an `rpc:` scope for them.
 *
 * Known risk of dropping `transition:generic`: it also served as a
 * compatibility fallback for self-hosted PDS implementations that hadn't
 * yet rolled out enforcement of granular scopes. Login against such a PDS
 * may behave differently now — this needs live verification across PDS
 * implementations, not just against bsky.social.
 *
 * Original NSID scope decision: 2026-05-08 by Simon — see
 * .squad/decisions/inbox/simon-nsid-scopes.md
 */

// Collections mid-migration from app.collectivesocial.feed.* to
// social.popfeed.feed.* (see src/services/popfeedMigration.ts). Both old and
// new scopes are requested during rollout: old is needed so the migration
// can delete the old-namespace record after copying it, new so it can write
// under the new NSID. Drop the app.collectivesocial.feed.{list,listitem,
// comment,react,review} scopes once all active users have migrated (see
// users.popfeedMigrationStatus).
const POPFEED_MIGRATION_SCOPES = [
  'repo:app.collectivesocial.feed.list',
  'repo:app.collectivesocial.feed.listitem',
  'repo:app.collectivesocial.feed.review',
  'repo:app.collectivesocial.feed.comment',
  'repo:app.collectivesocial.feed.react',
  'repo:social.popfeed.feed.list',
  'repo:social.popfeed.feed.listitem',
  'repo:social.popfeed.feed.review',
  'repo:social.popfeed.feed.comment',
  'repo:social.popfeed.feed.reaction',
];

// User-PDS collections not yet migrated to social.popfeed.* (deferred —
// need a different migration mechanism, see the popfeed migration PR).
const LEGACY_COLLECTIVE_SCOPES = [
  'repo:app.collectivesocial.feed.useritem',
  'repo:app.collectivesocial.feed.completion',
  'repo:app.collectivesocial.feed.reviewsegment',
  'repo:app.collectivesocial.feed.goal',
  'repo:app.collectivesocial.feed.grouppost',
];

// Non-collectivesocial lexicons this app writes to directly. Group-PDS
// collections are excluded here because those writes are proxied through
// the OpenSocial service using its own credentials, not the user's.
const EXTERNAL_LEXICON_SCOPES = [
  'repo:community.lexicon.calendar.rsvp',
  'repo:app.bsky.graph.follow',
];

export const COLLECTIVE_SCOPES = [
  'atproto',
  ...POPFEED_MIGRATION_SCOPES,
  ...LEGACY_COLLECTIVE_SCOPES,
  ...EXTERNAL_LEXICON_SCOPES,
].join(' ');
