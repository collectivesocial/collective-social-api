"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ids = exports.lexicons = exports.schemas = exports.schemaDict = void 0;
exports.validate = validate;
/**
 * GENERATED CODE - DO NOT MODIFY
 */
const lexicon_1 = require("@atproto/lexicon");
const util_js_1 = require("./util.js");
exports.schemaDict = {};
exports.schemas = Object.values(exports.schemaDict);
exports.lexicons = new lexicon_1.Lexicons(exports.schemas);
function validate(v, id, hash, requiredType) {
    return (requiredType ? util_js_1.is$typed : util_js_1.maybe$typed)(v, id, hash)
        ? exports.lexicons.validate(`${id}#${hash}`, v)
        : {
            success: false,
            error: new lexicon_1.ValidationError(`Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`),
        };
}
exports.ids = {};
