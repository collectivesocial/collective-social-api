"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserByHandle = getUserByHandle;
const api_1 = require("@atproto/api");
const config_1 = require("../config");
async function getUserByHandle(handle) {
    const agent = new api_1.AtpAgent({ service: config_1.config.pdsUrl });
    const response = await agent.getProfile({ actor: handle });
    return response.data;
}
