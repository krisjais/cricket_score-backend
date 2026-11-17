"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerAvailability = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PlayerAvailabilitySchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    status: {
        type: String,
        enum: ['AVAILABLE', 'UNAVAILABLE', 'TENTATIVE'],
        default: 'AVAILABLE',
        index: true,
    },
    note: { type: String, default: null, trim: true, maxlength: 300 },
}, (0, schema_helpers_1.baseSchemaOptions)('playerAvailability', { timestamps: true }));
// One availability response per player per match
PlayerAvailabilitySchema.index({ matchId: 1, playerId: 1 }, { unique: true });
PlayerAvailabilitySchema.index({ matchId: 1, teamId: 1, status: 1 });
PlayerAvailabilitySchema.virtual('id').get(function () {
    return this._id;
});
exports.PlayerAvailability = (0, mongoose_1.model)('PlayerAvailability', PlayerAvailabilitySchema);
