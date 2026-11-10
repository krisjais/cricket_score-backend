"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Match = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const MatchSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    format: {
        type: String,
        enum: ['T10', 'T20', 'ODI', 'CUSTOM'],
        default: 'T20',
    },
    totalOvers: { type: Number, default: 20 },
    venue: { type: String, default: null },
    status: {
        type: String,
        enum: ['SCHEDULED', 'TOSS_DONE', 'LIVE', 'PAUSED', 'INNINGS_BREAK', 'COMPLETED', 'ABANDONED'],
        default: 'SCHEDULED',
    },
    teamAId: { type: String, required: true, ref: 'Team' },
    teamBId: { type: String, required: true, ref: 'Team' },
    tossWinnerId: { type: String, default: null },
    tossDecision: { type: String, default: null },
    battingFirstId: { type: String, default: null },
    currentInnings: { type: Number, default: 0 },
    target: { type: Number, default: null },
    resultText: { type: String, default: null },
    winnerId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
}, {
    timestamps: true,
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
MatchSchema.virtual('id').get(function () {
    return this._id;
});
exports.Match = (0, mongoose_1.model)('Match', MatchSchema);
