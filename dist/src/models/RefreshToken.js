"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshToken = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const RefreshTokenSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    userId: { type: String, required: true, ref: 'User', index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
}, (0, schema_helpers_1.baseSchemaOptions)('refreshTokens'));
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
RefreshTokenSchema.virtual('id').get(function () {
    return this._id;
});
exports.RefreshToken = (0, mongoose_1.model)('RefreshToken', RefreshTokenSchema);
