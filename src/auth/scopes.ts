/**
 * OAuth scope string for Collective Social.
 *
 * Lists the 10 user-PDS collections that the OAuth client requests write
 * access to. Group-PDS collections are excluded because those writes are
 * proxied through the OpenSocial service using its own service credentials,
 * not the user's OAuth token.
 *
 * Decided: 2026-05-08 by Simon — see
 * .squad/decisions/inbox/simon-nsid-scopes.md
 */
export const COLLECTIVE_SCOPES =
  'atproto repo:app.collectivesocial.feed.list repo:app.collectivesocial.feed.listitem repo:app.collectivesocial.feed.useritem repo:app.collectivesocial.feed.review repo:app.collectivesocial.feed.completion repo:app.collectivesocial.feed.comment repo:app.collectivesocial.feed.react repo:app.collectivesocial.feed.reviewsegment repo:app.collectivesocial.feed.goal repo:app.collectivesocial.feed.grouppost repo:community.lexicon.calendar.rsvp';
