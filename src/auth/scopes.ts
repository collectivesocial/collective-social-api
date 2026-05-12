/**
 * OAuth scope string for Collective Social.
 *
 * - `transition:generic` grants broad ATProto access during the OAuth
 *   transition period; needed for app.bsky.* operations (follow/unfollow,
 *   profile reads through PDS proxy) and for compatibility with non-Bluesky
 *   PDS servers that may not yet support granular NSID scopes.
 *
 * - The `repo:` scopes grant write access to the 10 user-PDS collections
 *   the app manages. Group-PDS collections are excluded because those writes
 *   are proxied through the OpenSocial service using its own credentials.
 *
 * Original NSID scope decision: 2026-05-08 by Simon — see
 * .squad/decisions/inbox/simon-nsid-scopes.md
 */
export const COLLECTIVE_SCOPES =
  'atproto transition:generic repo:app.collectivesocial.feed.list repo:app.collectivesocial.feed.listitem repo:app.collectivesocial.feed.useritem repo:app.collectivesocial.feed.review repo:app.collectivesocial.feed.completion repo:app.collectivesocial.feed.comment repo:app.collectivesocial.feed.react repo:app.collectivesocial.feed.reviewsegment repo:app.collectivesocial.feed.goal repo:app.collectivesocial.feed.grouppost repo:community.lexicon.calendar.rsvp';
