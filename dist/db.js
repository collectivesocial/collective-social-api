"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDb = void 0;
const config_1 = require("./config");
const pg_1 = require("pg");
const kysely_1 = require("kysely");
// APIs
// Database connection
const createDb = (location) => {
    return new kysely_1.Kysely({
        dialect: new kysely_1.PostgresDialect({
            pool: new pg_1.Pool({
                connectionString: location,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
            }),
        }),
    });
};
exports.createDb = createDb;
const pool = new pg_1.Pool({
    connectionString: config_1.config.databaseUrl,
});
exports.default = pool;
