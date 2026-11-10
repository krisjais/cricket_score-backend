"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const PlayerSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    name: { type: String, required: true, trim: true },
    jerseyNumber: { type: Number, default: null },
    role: {
        type: String,
        enum: ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'],
        default: 'ALL_ROUNDER',
    },
    teamId: { type: String, default: null, ref: 'Team', index: true },
    avatarUrl: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
}, {
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
    toObject: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
PlayerSchema.virtual('id').get(function () {
    return this._id;
});
exports.Player = (0, mongoose_1.model)('Player', PlayerSchema);
