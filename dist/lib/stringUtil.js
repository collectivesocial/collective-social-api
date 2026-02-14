"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ifString = ifString;
function ifString(value) {
    if (typeof value === 'string')
        return value;
    return undefined;
}
