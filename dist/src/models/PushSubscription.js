"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushSubscription = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const PushSubscriptionSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
    },
    deviceInfo: { type: String, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('pushSubscriptions', { timestamps: true }));
PushSubscriptionSchema.virtual('id').get(function () {
    return this._id;
});
exports.PushSubscription = (0, mongoose_1.model)('PushSubscription', PushSubscriptionSchema);
