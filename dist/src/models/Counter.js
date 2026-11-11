"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = void 0;
const mongoose_1 = require("mongoose");
const schema_helpers_1 = require("./schema-helpers");
const CounterSchema = new mongoose_1.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
}, (0, schema_helpers_1.baseSchemaOptions)('counters', { timestamps: { createdAt: false, updatedAt: true } }));
CounterSchema.virtual('id').get(function () {
    return this._id;
});
exports.Counter = (0, mongoose_1.model)('Counter', CounterSchema);
