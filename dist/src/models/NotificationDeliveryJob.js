"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationDeliveryJob = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const NotificationDeliveryJobSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    announcementId: { type: String, required: true, ref: 'TeamAnnouncement', index: true },
    recipientPlayerId: { type: String, required: true, ref: 'Player', index: true },
    recipientEmail: { type: String, default: null },
    subscriptionEndpoint: { type: String, default: null },
    channel: { type: String, enum: ['email', 'push'], required: true, index: true },
    status: {
        type: String,
        enum: ['pending', 'processing', 'sent', 'failed'],
        default: 'pending',
        index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    providerMessageId: { type: String, default: null },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('notificationDeliveryJobs', { timestamps: true }));
// Idempotency: prevent duplicate delivery job per announcement, recipient, and channel
NotificationDeliveryJobSchema.index({ announcementId: 1, recipientPlayerId: 1, channel: 1, subscriptionEndpoint: 1 }, { unique: true });
// High-speed queue worker index
NotificationDeliveryJobSchema.index({ status: 1, nextRetryAt: 1, attempts: 1 });
NotificationDeliveryJobSchema.virtual('id').get(function () {
    return this._id;
});
exports.NotificationDeliveryJob = (0, mongoose_1.model)('NotificationDeliveryJob', NotificationDeliveryJobSchema);
