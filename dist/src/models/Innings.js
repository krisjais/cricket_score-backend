"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Innings = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const InningsSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    number: { type: Number, required: true },
    battingTeamId: { type: String, required: true, ref: 'Team' },
    bowlingTeamId: { type: String, required: true, ref: 'Team' },
    status: {
        type: String,
        enum: ['IN_PROGRESS', 'COMPLETED'],
        default: 'IN_PROGRESS',
    },
    currentStrikerId: { type: String, default: null },
    currentNonStrikerId: { type: String, default: null },
    currentBowlerId: { type: String, default: null },
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
InningsSchema.index({ matchId: 1, number: 1 }, { unique: true });
InningsSchema.virtual('id').get(function () {
    return this._id;
});
exports.Innings = (0, mongoose_1.model)('Innings', InningsSchema);
