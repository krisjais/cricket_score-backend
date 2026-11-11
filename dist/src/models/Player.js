"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PlayerSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    playerCode: { type: String, default: null, uppercase: true, trim: true },
    userId: { type: String, default: null, ref: 'User' },
    name: { type: String, required: true, trim: true },
    jerseyNumber: { type: Number, default: null },
    role: {
        type: String,
        enum: ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'],
        default: 'ALL_ROUNDER',
    },
    gender: {
        type: String,
        enum: ['MALE', 'FEMALE'],
        default: 'MALE',
    },
    teamId: { type: String, default: null, ref: 'Team', index: true },
    avatarUrl: { type: String, default: null },
    dob: { type: Date, default: null },
    battingStyle: { type: String, enum: ['RIGHT_HAND', 'LEFT_HAND', null], default: null },
    bowlingStyle: {
        type: String,
        enum: [
            'RIGHT_ARM_FAST',
            'RIGHT_ARM_MEDIUM',
            'RIGHT_ARM_OFF_SPIN',
            'RIGHT_ARM_LEG_SPIN',
            'LEFT_ARM_FAST',
            'LEFT_ARM_MEDIUM',
            'LEFT_ARM_ORTHODOX',
            'LEFT_ARM_CHINAMAN',
            'NONE',
            null,
        ],
        default: null,
    },
    bio: { type: String, default: null, maxlength: 400 },
    city: { type: String, default: null, trim: true, maxlength: 80 },
    isClaimed: { type: Boolean, default: false, index: true },
    isVerified: { type: Boolean, default: false, index: true },
    status: {
        type: String,
        enum: ['ACTIVE', 'SUSPENDED', 'MERGED', 'RETIRED'],
        default: 'ACTIVE',
        index: true,
    },
    mergedIntoPlayerId: { type: String, default: null, ref: 'Player' },
    privacy: {
        showDob: { type: Boolean, default: true },
        showCity: { type: Boolean, default: true },
        showBio: { type: Boolean, default: true },
        showSeasonHistory: { type: Boolean, default: true },
        isPublic: { type: Boolean, default: true },
    },
    createdAt: { type: Date, default: Date.now },
}, (0, schema_helpers_1.baseSchemaOptions)(undefined, { timestamps: true }));
// Partial unique indexes preserve backwards compatibility with existing Atlas documents during bootstrap migration
PlayerSchema.index({ playerCode: 1 }, { unique: true, partialFilterExpression: { playerCode: { $type: 'string' } } });
PlayerSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'string' } } });
PlayerSchema.index({ name: 1 });
PlayerSchema.virtual('id').get(function () {
    return this._id;
});
exports.Player = (0, mongoose_1.model)('Player', PlayerSchema);
