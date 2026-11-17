"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InAppNotification = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const InAppNotificationSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    recipientPlayerId: { type: String, required: true, ref: 'Player', index: true },
    announcementId: { type: String, required: true, ref: 'TeamAnnouncement', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    type: { type: String, enum: ['team_announcement'], default: 'team_announcement' },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
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
    priority: {
        type: String,
        enum: ['NORMAL', 'IMPORTANT', 'URGENT'],
        default: 'NORMAL',
        index: true,
    },
    eventDate: { type: Date, default: null },
    eventTime: { type: String, default: null },
    location: { type: String, default: null },
    attachmentUrl: { type: String, default: null },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('notifications', { timestamps: true }));
// Compound index for player notification feed with read status and sort
InAppNotificationSchema.index({ recipientPlayerId: 1, isRead: 1, createdAt: -1 });
// Guarantee uniqueness: one in-app notification per player per announcement
InAppNotificationSchema.index({ recipientPlayerId: 1, announcementId: 1 }, { unique: true });
InAppNotificationSchema.virtual('id').get(function () {
    return this._id;
});
exports.InAppNotification = (0, mongoose_1.model)('InAppNotification', InAppNotificationSchema);
