"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
exports.startServer = startServer;
const http_terminator_1 = require("http-terminator");
const node_events_1 = require("node:events");
const node_http_1 = require("node:http");
/**
 * Wraps a request handler middleware to ensure that `next` is called if it
 * throws or returns a promise that rejects.
 */
function handler(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res);
        }
        catch (err) {
            next(err);
        }
    };
}
/**
 * Create an HTTP server with the provided request listener, ensuring that it
 * can bind the listening port, and returns a termination function that allows
 * graceful termination of HTTP connections.
 */
async function startServer(requestListener, { port, gracefulTerminationTimeout, } = {}) {
    const server = (0, node_http_1.createServer)(requestListener);
    const { terminate } = (0, http_terminator_1.createHttpTerminator)({
        gracefulTerminationTimeout,
        server,
    });
    server.listen(port);
    await (0, node_events_1.once)(server, 'listening');
    return { server, terminate };
}
