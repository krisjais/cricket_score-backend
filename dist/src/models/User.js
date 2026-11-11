"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const UserSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    mobile: { type: String, default: null, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['PLAYER', 'ADMIN'], default: 'PLAYER' },
    emailVerified: { type: Boolean, default: false },
    mobileVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    playerId: { type: String, default: null, ref: 'Player' },
    lastLoginAt: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('users', { timestamps: true }));
// Partial unique indexes so null values never collide while enforcing strict uniqueness on real credentials
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
UserSchema.index({ mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } });
UserSchema.index({ playerId: 1 }, { unique: true, partialFilterExpression: { playerId: { $type: 'string' } } });
UserSchema.virtual('id').get(function () {
    return this._id;
});
exports.User = (0, mongoose_1.model)('User', UserSchema);
