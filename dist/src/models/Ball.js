"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ball = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const BallSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    inningsId: { type: String, required: true, ref: 'Innings', index: true },
    sequence: { type: Number, required: true },
    overNumber: { type: Number, required: true },
    strikerId: { type: String, required: true },
    nonStrikerId: { type: String, required: true },
    bowlerId: { type: String, required: true },
    runsOffBat: { type: Number, default: 0 },
    extraType: {
        type: String,
        enum: ['WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', null],
        default: null,
    },
    extraRuns: { type: Number, default: 0 },
    isLegal: { type: Boolean, default: true },
    isWicket: { type: Boolean, default: false },
    wicketType: {
        type: String,
        enum: [
            'BOWLED',
            'CAUGHT',
            'CAUGHT_AND_BOWLED',
            'LBW',
            'RUN_OUT',
            'STUMPED',
            'HIT_WICKET',
            'RETIRED_HURT',
            'RETIRED_OUT',
            'ABSENT',
            'OBSTRUCTING_FIELD',
            null,
        ],
        default: null,
    },
    dismissedId: { type: String, default: null },
    assistId: { type: String, default: null },
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
BallSchema.index({ inningsId: 1, sequence: 1 });
BallSchema.virtual('id').get(function () {
    return this._id;
});
exports.Ball = (0, mongoose_1.model)('Ball', BallSchema);
