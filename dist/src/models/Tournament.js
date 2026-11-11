"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tournament = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const TournamentSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, required: true, trim: true, uppercase: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    format: { type: String, enum: ['T10', 'T20', 'ODI', 'CUSTOM'], default: 'T20' },
    status: { type: String, enum: ['UPCOMING', 'ACTIVE', 'COMPLETED'], default: 'ACTIVE', index: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    winnerTeamId: { type: String, default: null, ref: 'Team' },
}, (0, schema_helpers_1.baseSchemaOptions)('tournaments', { timestamps: true }));
TournamentSchema.index({ seasonId: 1, name: 1 }, { unique: true });
TournamentSchema.virtual('id').get(function () {
    return this._id;
});
exports.Tournament = (0, mongoose_1.model)('Tournament', TournamentSchema);
