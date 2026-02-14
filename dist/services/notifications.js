"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.notifyAllMembers = notifyAllMembers;
exports.notifyUsers = notifyUsers;
/**
 * Create a single notification.
 * Skips if actor === recipient (you don't notify yourself).
 */
async function createNotification(db, opts) {
    if (opts.actorDid === opts.recipientDid)
        return;
    await db
        .insertInto('group_notifications')
        .values({
        communityDid: opts.communityDid,
        recipientDid: opts.recipientDid,
        actorDid: opts.actorDid,
        type: opts.type,
        subjectUri: opts.subjectUri ?? null,
        subjectType: opts.subjectType ?? null,
        message: opts.message ?? null,
        read: false,
        createdAt: new Date(),
    })
        .execute();
}
/**
 * Notify all members of a community about something (e.g. new segment assignment).
 * Fetches the member list from OpenSocial and creates a notification for each.
 */
async function notifyAllMembers(db, communityDid, actorDid, type, opts = {}) {
    // Import dynamically to avoid circular dependency
    const opensocial = await Promise.resolve().then(() => __importStar(require('./opensocial')));
    const { members } = await opensocial.listMembers(communityDid);
    const notifications = members
        .filter((m) => m.did && m.did !== actorDid)
        .map((m) => ({
        communityDid,
        recipientDid: m.did,
        actorDid,
        type,
        subjectUri: opts.subjectUri ?? null,
        subjectType: opts.subjectType ?? null,
        message: opts.message ?? null,
        read: false,
        createdAt: new Date(),
    }));
    if (notifications.length === 0)
        return;
    await db
        .insertInto('group_notifications')
        .values(notifications)
        .execute();
}
/**
 * Notify specific DIDs (e.g. mentioned users).
 */
async function notifyUsers(db, communityDid, actorDid, recipientDids, type, opts = {}) {
    const notifications = recipientDids
        .filter((did) => did !== actorDid)
        .map((did) => ({
        communityDid,
        recipientDid: did,
        actorDid,
        type,
        subjectUri: opts.subjectUri ?? null,
        subjectType: opts.subjectType ?? null,
        message: opts.message ?? null,
        read: false,
        createdAt: new Date(),
    }));
    if (notifications.length === 0)
        return;
    await db
        .insertInto('group_notifications')
        .values(notifications)
        .execute();
}
