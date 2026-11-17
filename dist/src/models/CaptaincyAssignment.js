"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptaincyAssignment = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const CaptaincyAssignmentSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    assignedBy: { type: String, required: true, trim: true },
    assignedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    status: {
        type: String,
        enum: ['active', 'completed', 'revoked'],
        default: 'active',
        index: true,
    },
    notes: { type: String, default: null, trim: true },
}, (0, schema_helpers_1.baseSchemaOptions)('captaincyAssignments', { timestamps: true }));
// Invariant: At most ONE active captain per team per season
CaptaincyAssignmentSchema.index({ seasonId: 1, teamId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
// Invariant: A player cannot be active captain for two different teams in the same season
CaptaincyAssignmentSchema.index({ seasonId: 1, playerId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
// Query index for player captaincy history
CaptaincyAssignmentSchema.index({ playerId: 1, assignedAt: -1 });
CaptaincyAssignmentSchema.virtual('id').get(function () {
    return this._id;
});
exports.CaptaincyAssignment = (0, mongoose_1.model)('CaptaincyAssignment', CaptaincyAssignmentSchema);
