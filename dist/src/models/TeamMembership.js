"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamMembership = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const TeamMembershipSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    status: {
        type: String,
        enum: ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'RELEASED'],
        default: 'ACTIVE',
        index: true,
    },
    designation: {
        type: String,
        enum: ['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN', 'WICKETKEEPER'],
        default: 'PLAYER',
    },
    jerseyNumber: { type: Number, default: null },
    assignedBy: { type: String, default: null },
    notes: { type: String, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('teamMemberships', { timestamps: true }));
// Core architectural invariant: one player membership per season
TeamMembershipSchema.index({ playerId: 1, seasonId: 1 }, { unique: true });
TeamMembershipSchema.index({ teamId: 1, seasonId: 1 });
TeamMembershipSchema.virtual('id').get(function () {
    return this._id;
});
exports.TeamMembership = (0, mongoose_1.model)('TeamMembership', TeamMembershipSchema);
