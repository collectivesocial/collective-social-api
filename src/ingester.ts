// import type { Database } from './db';
// import * as List from './lexicon/types/app/collectivesocial/list';
// import { IdResolver, MemoryCache } from '@atproto/identity';
// import { Event, Firehose } from '@atproto/sync';
// import pino from 'pino';
// import { config } from './config';

// const HOUR = 60e3 * 60;
// const DAY = HOUR * 24;

// export function createIngester(db: Database) {
//   const logger = pino({ name: 'firehose', level: config.logLevel });
//   return new Firehose({
//     filterCollections: ['xyz.statusphere.status'],
//     handleEvent: async (evt: Event) => {
//       // Watch for write events
//       if (evt.event === 'create' || evt.event === 'update') {
//         const now = new Date();
//         const record = evt.record;

//         // If the write is a valid status update
//         if (
//           evt.collection === 'xyz.statusphere.status' &&
//           List.isRecord(record) &&
//           List.validateRecord(record).success
//         ) {
//           logger.debug(
//             { uri: evt.uri.toString(), list: record.list },
//             'ingesting list'
//           );

//           // Store the list in our DB
//           await db
//             .insertInto('list')
//             .values({
//               uri: evt.uri.toString(),
//               authorDid: evt.did,
//               list: record.list,
//               createdAt: record.createdAt,
//               indexedAt: now.toISOString(),
//             })
//             .onConflict((oc) =>
//               oc.column('uri').doUpdateSet({
//                 list: record.list,
//                 indexedAt: now.toISOString(),
//               })
//             )
//             .execute();
//         }
//       } else if (
//         evt.event === 'delete' &&
//         evt.collection === 'app.collectivesocial.list'
//       ) {
//         logger.debug(
//           { uri: evt.uri.toString(), did: evt.did },
//           'deleting list'
//         );

//         // Remove the list from our DB
//         await db
//           .deleteFrom('list')
//           .where('uri', '=', evt.uri.toString())
//           .execute();
//       }
//     },
//     onError: (err: unknown) => {
//       logger.error({ err }, 'error on firehose ingestion');
//     },
//     excludeIdentity: true,
//     excludeAccount: true,
//     service: config.firehoseUrl,
//     idResolver: new IdResolver({
//       plcUrl: config.plcUrl,
//       didCache: new MemoryCache(HOUR, DAY),
//     }),
//   });
// }
