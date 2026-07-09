/**
 * OAuth scope string for Collective Social.
 *
 * - `transition:generic` grants broad ATProto access during the OAuth
 *   transition period; needed for app.bsky.* operations (follow/unfollow,
 *   profile reads through PDS proxy) and for compatibility with non-Bluesky
 *   PDS servers that may not yet support granular NSID scopes.
 *
 * - The `repo:` scopes grant write access to the user-PDS collections the
 *   app manages. Group-PDS collections are excluded because those writes
 *   are proxied through the OpenSocial service using its own credentials.
 *
 * - list/listitem/comment/react(ion)/review are being migrated from
 *   app.collectivesocial.feed.* to social.popfeed.feed.* (see
 *   src/services/popfeedMigration.ts). Both the old and new `repo:` scopes
 *   are requested during the rollout: old scope is needed so the migration
 *   can delete the old-namespace record after copying it, new scope so it
 *   can write under the new NSID. Drop the app.collectivesocial.feed.{list,
 *   listitem,comment,react,review} scopes once all active users have
 *   migrated (see users.popfeedMigrationStatus).
 *
 * Original NSID scope decision: 2026-05-08 by Simon — see
 * .squad/decisions/inbox/simon-nsid-scopes.md
 */
export const COLLECTIVE_SCOPES =
  'atproto transition:generic repo:app.collectivesocial.feed.list repo:app.collectivesocial.feed.listitem repo:app.collectivesocial.feed.review repo:app.collectivesocial.feed.comment repo:app.collectivesocial.feed.react repo:social.popfeed.feed.list repo:social.popfeed.feed.listitem repo:social.popfeed.feed.review repo:social.popfeed.feed.comment repo:social.popfeed.feed.reaction repo:app.collectivesocial.feed.useritem repo:app.collectivesocial.feed.completion repo:app.collectivesocial.feed.reviewsegment repo:app.collectivesocial.feed.goal repo:app.collectivesocial.feed.grouppost repo:community.lexicon.calendar.rsvp';
