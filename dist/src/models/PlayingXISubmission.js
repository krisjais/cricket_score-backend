"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayingXISubmission = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PlayingXISubmissionSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    captainId: { type: String, required: true, ref: 'Player', index: true },
    submittedBy: { type: String, required: true, trim: true },
    playingXI: { type: [String], default: [] },
    substitutes: { type: [String], default: [] },
    notes: { type: String, default: null, trim: true, maxlength: 500 },
    status: {
        type: String,
        enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'],
        default: 'DRAFT',
        index: true,
    },
    reviewNotes: { type: String, default: null, trim: true, maxlength: 500 },
    reviewedBy: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('playingXISubmissions', { timestamps: true }));
// One submission record per team per match
PlayingXISubmissionSchema.index({ matchId: 1, teamId: 1 }, { unique: true });
PlayingXISubmissionSchema.index({ seasonId: 1, teamId: 1, status: 1 });
PlayingXISubmissionSchema.virtual('id').get(function () {
    return this._id;
});
exports.PlayingXISubmission = (0, mongoose_1.model)('PlayingXISubmission', PlayingXISubmissionSchema);
