"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Team = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = require("crypto");
const TeamSchema = new mongoose_1.Schema({
    _id: { type: String, default: () => (0, crypto_1.randomUUID)() },
    name: { type: String, required: true, unique: true, trim: true },
    shortName: { type: String, required: true, trim: true, uppercase: true },
    color: { type: String, default: '#0d3a24' },
    logoUrl: { type: String, default: null },
    captain: { type: String, default: null },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
    toObject: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
TeamSchema.virtual('id').get(function () {
    return this._id;
});
exports.Team = (0, mongoose_1.model)('Team', TeamSchema);
