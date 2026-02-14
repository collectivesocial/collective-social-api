"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppContext = createAppContext;
const pino_1 = require("pino");
const client_1 = require("./auth/client");
const db_1 = require("./db");
const migrations_1 = require("./migrations");
const config_1 = require("./config");
const id_resolver_1 = require("./id-resolver");
async function createAppContext() {
    const db = (0, db_1.createDb)(config_1.config.databaseUrl);
    await (0, migrations_1.migrateToLatest)(db);
    const oauthClient = await (0, client_1.createOAuthClient)(db);
    const logger = (0, pino_1.pino)({ name: 'server', level: config_1.config.logLevel });
    const resolver = (0, id_resolver_1.createBidirectionalResolver)(oauthClient);
    return {
        db,
        logger,
        oauthClient,
        resolver,
        async destroy() {
            await db.destroy();
        },
    };
}
