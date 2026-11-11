"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpVerification = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const OtpVerificationSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    channel: { type: String, enum: ['EMAIL', 'MOBILE'], required: true },
    target: { type: String, required: true, trim: true },
    purpose: {
        type: String,
        enum: ['REGISTER', 'VERIFY_EMAIL', 'VERIFY_MOBILE', 'CLAIM_PROFILE', 'RESET_PASSWORD'],
        required: true,
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    userId: { type: String, default: null, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
}, (0, schema_helpers_1.baseSchemaOptions)('otpVerifications'));
OtpVerificationSchema.index({ channel: 1, target: 1, purpose: 1, createdAt: -1 });
OtpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
OtpVerificationSchema.virtual('id').get(function () {
    return this._id;
});
exports.OtpVerification = (0, mongoose_1.model)('OtpVerification', OtpVerificationSchema);
