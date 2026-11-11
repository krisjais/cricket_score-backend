"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Match = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PlayerStatusEntrySchema = new mongoose_1.Schema({
    playerId: { type: String, required: true, ref: 'Player' },
    status: { type: String, enum: ['PLAYED', 'RETIRED_HURT', 'RETIRED_OUT', 'ABSENT'], default: 'PLAYED' },
    notes: { type: String, default: null },
}, { _id: false });
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
    seasonId: { type: String, default: null, ref: 'Season', index: true },
    tournamentId: { type: String, default: null, ref: 'Tournament', index: true },
    matchDate: { type: Date, default: null },
    playingXIA: { type: [String], default: [] },
    playingXIB: { type: [String], default: [] },
    playerStatuses: { type: [PlayerStatusEntrySchema], default: [] },
    playerOfMatchId: { type: String, default: null, ref: 'Player' },
    scorecardStatus: {
        type: String,
        enum: ['DRAFT', 'FINALIZED', 'VERIFIED', 'CORRECTION_REQUIRED'],
        default: 'DRAFT',
        index: true,
    },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: null },
    statsProcessedVersion: { type: Number, default: 0 },
    statsSnapshotHash: { type: String, default: null },
    tossWinnerId: { type: String, default: null },
    tossDecision: { type: String, default: null },
    battingFirstId: { type: String, default: null },
    currentInnings: { type: Number, default: 0 },
    target: { type: Number, default: null },
    resultText: { type: String, default: null },
    winnerId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)(undefined, { timestamps: true }));
MatchSchema.virtual('id').get(function () {
    return this._id;
});
exports.Match = (0, mongoose_1.model)('Match', MatchSchema);
