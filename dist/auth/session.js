"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_OPTIONS = void 0;
const config_1 = require("../config");
/**
 * Iron session configuration — shared across all route handlers.
 * Single source of truth for cookie name, secret, and options.
 */
exports.SESSION_OPTIONS = {
    cookieName: 'sid',
    password: config_1.config.cookieSecret,
    cookieOptions: {
        secure: config_1.config.nodeEnv === 'production',
        sameSite: 'lax',
        httpOnly: true,
        path: '/',
    },
};
