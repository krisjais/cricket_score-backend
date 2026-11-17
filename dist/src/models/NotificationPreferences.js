"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationPreferences = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const NotificationPreferencesSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    playerId: { type: String, required: true, ref: 'Player', unique: true, index: true },
    emailEnabled: { type: Boolean, default: true },
    pushEnabled: { type: Boolean, default: true },
    categoryPreferences: {
        GENERAL: { type: Boolean, default: true },
        PRACTICE: { type: Boolean, default: true },
        MATCH_REMINDER: { type: Boolean, default: true },
        MEETING: { type: Boolean, default: true },
        UPDATE: { type: Boolean, default: true },
        TOURNAMENT: { type: Boolean, default: true },
        EMERGENCY: { type: Boolean, default: true },
    },
}, (0, schema_helpers_1.baseSchemaOptions)('notificationPreferences', { timestamps: true }));
NotificationPreferencesSchema.virtual('id').get(function () {
    return this._id;
});
exports.NotificationPreferences = (0, mongoose_1.model)('NotificationPreferences', NotificationPreferencesSchema);
