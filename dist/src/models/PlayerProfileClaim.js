"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerProfileClaim = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PlayerProfileClaimSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    userId: { type: String, required: true, ref: 'User', index: true },
    targetPlayerId: { type: String, required: true, ref: 'Player', index: true },
    requestedEmail: { type: String, default: null },
    requestedMobile: { type: String, default: null },
    verificationMethod: { type: String, enum: ['OTP_EMAIL', 'OTP_MOBILE', 'ADMIN'], required: true },
    otpVerified: { type: Boolean, default: false },
    evidenceNotes: { type: String, default: null },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_COMPLETED'],
        default: 'PENDING',
        index: true,
    },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('playerProfileClaims', { timestamps: true }));
PlayerProfileClaimSchema.virtual('id').get(function () {
    return this._id;
});
exports.PlayerProfileClaim = (0, mongoose_1.model)('PlayerProfileClaim', PlayerProfileClaimSchema);
