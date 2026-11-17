"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamAnnouncement = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const TeamAnnouncementSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    authorPlayerId: { type: String, required: true, ref: 'Player', index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    priority: {
        type: String,
        enum: ['NORMAL', 'IMPORTANT', 'URGENT'],
        default: 'NORMAL',
        index: true,
    },
    category: {
        type: String,
        enum: [
            'MATCH_REMINDER',
            'MEETING',
            'PRACTICE',
            'UPDATE',
            'TOURNAMENT',
            'EMERGENCY',
            'GENERAL',
        ],
        default: 'GENERAL',
        index: true,
    },
    eventDate: { type: Date, default: null },
    eventTime: { type: String, default: null, trim: true },
    location: { type: String, default: null, trim: true },
    attachmentUrl: { type: String, default: null, trim: true },
    status: {
        type: String,
        enum: ['published', 'archived'],
        default: 'published',
        index: true,
    },
    publishedAt: { type: Date, default: Date.now },
}, (0, schema_helpers_1.baseSchemaOptions)('teamAnnouncements', { timestamps: true }));
TeamAnnouncementSchema.index({ teamId: 1, seasonId: 1, createdAt: -1 });
TeamAnnouncementSchema.virtual('id').get(function () {
    return this._id;
});
exports.TeamAnnouncement = (0, mongoose_1.model)('TeamAnnouncement', TeamAnnouncementSchema);
