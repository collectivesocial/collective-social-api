"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
exports.createServer = createServer;
/**
 * GENERATED CODE - DO NOT MODIFY
 */
const xrpc_server_1 = require("@atproto/xrpc-server");
const lexicons_js_1 = require("./lexicons.js");
function createServer(options) {
    return new Server(options);
}
class Server {
    constructor(options) {
        this.xrpc = (0, xrpc_server_1.createServer)(lexicons_js_1.schemas, options);
    }
}
exports.Server = Server;
