"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Award = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const AwardSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    scope: { type: String, enum: ['MATCH', 'TOURNAMENT', 'SEASON'], required: true, index: true },
    awardType: {
        type: String,
        enum: ['PLAYER_OF_MATCH', 'BEST_BATTER', 'BEST_BOWLER', 'BEST_FIELDER', 'PLAYER_OF_TOURNAMENT'],
        required: true,
    },
    matchId: { type: String, default: null, ref: 'Match', index: true },
    tournamentId: { type: String, default: null, ref: 'Tournament', index: true },
    seasonId: { type: String, default: null, ref: 'Season', index: true },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, default: null, ref: 'Team' },
    notes: { type: String, default: null },
    awardedBy: { type: String, default: null },
    awardedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
}, (0, schema_helpers_1.baseSchemaOptions)('awards'));
AwardSchema.index({ scope: 1, matchId: 1, awardType: 1 }, { unique: true, partialFilterExpression: { matchId: { $type: 'string' } } });
AwardSchema.virtual('id').get(function () {
    return this._id;
});
exports.Award = (0, mongoose_1.model)('Award', AwardSchema);
