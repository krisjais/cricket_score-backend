"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSchemaOptions = baseSchemaOptions;
/**
 * Shared Mongoose Schema options matching existing models:
 * string UUID `_id` exposed as virtual `id` and `__v` stripped.
 */
function baseSchemaOptions(collection, extra = {}) {
    const transform = (_doc, ret) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
    };
    return {
        ...(collection ? { collection } : {}),
        toJSON: { virtuals: true, transform },
        toObject: { virtuals: true, transform },
        ...extra,
    };
}
