"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Season = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const schema_helpers_1 = require("./schema-helpers");
const SeasonSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    year: { type: Number, required: true, index: true },
    status: { type: String, enum: ['UPCOMING', 'ACTIVE', 'COMPLETED'], default: 'ACTIVE', index: true },
    isDefault: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
}, (0, schema_helpers_1.baseSchemaOptions)('seasons', { timestamps: true }));
SeasonSchema.virtual('id').get(function () {
    return this._id;
});
exports.Season = (0, mongoose_1.model)('Season', SeasonSchema);
