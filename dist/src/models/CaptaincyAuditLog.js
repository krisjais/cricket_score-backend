"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptaincyAuditLog = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const CaptaincyAuditLogSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    assignmentId: { type: String, required: true, ref: 'CaptaincyAssignment', index: true },
    action: {
        type: String,
        enum: ['ASSIGN', 'REPLACE', 'REMOVE', 'AUTO_EXPIRE'],
        required: true,
        index: true,
    },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    previousCaptainId: { type: String, default: null, ref: 'Player' },
    newCaptainId: { type: String, default: null, ref: 'Player' },
    performedBy: { type: String, required: true, trim: true },
    performedAt: { type: Date, default: Date.now },
    reason: { type: String, default: null, trim: true },
}, (0, schema_helpers_1.baseSchemaOptions)('captaincyAuditLogs', { timestamps: true }));
CaptaincyAuditLogSchema.index({ performedAt: -1 });
CaptaincyAuditLogSchema.index({ seasonId: 1, teamId: 1, performedAt: -1 });
CaptaincyAuditLogSchema.virtual('id').get(function () {
    return this._id;
});
exports.CaptaincyAuditLog = (0, mongoose_1.model)('CaptaincyAuditLog', CaptaincyAuditLogSchema);
