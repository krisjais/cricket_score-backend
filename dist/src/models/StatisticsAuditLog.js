"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatisticsAuditLog = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const StatisticsAuditLogSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    action: {
        type: String,
        enum: [
            'FINALIZE_MATCH',
            'VERIFY_MATCH',
            'CORRECT_MATCH',
            'RECALCULATE_PLAYER',
            'RECALCULATE_ALL',
            'CLAIM_PLAYER',
            'MERGE_PLAYERS',
            'ASSIGN_TEAM_MEMBERSHIP',
            'VERIFY_PLAYER',
            'UPDATE_PLAYER_STATUS',
        ],
        required: true,
        index: true,
    },
    actorType: { type: String, enum: ['ADMIN', 'PLAYER', 'SYSTEM'], required: true },
    actorId: { type: String, default: null },
    actorName: { type: String, default: null },
    matchId: { type: String, default: null, index: true },
    playerId: { type: String, default: null, index: true },
    sourcePlayerId: { type: String, default: null },
    targetPlayerId: { type: String, default: null },
    reason: { type: String, default: null },
    beforeSummary: { type: mongoose_1.Schema.Types.Mixed, default: null },
    afterSummary: { type: mongoose_1.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose_1.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
}, (0, schema_helpers_1.baseSchemaOptions)('statisticsAuditLogs'));
StatisticsAuditLogSchema.virtual('id').get(function () {
    return this._id;
});
exports.StatisticsAuditLog = (0, mongoose_1.model)('StatisticsAuditLog', StatisticsAuditLogSchema);
