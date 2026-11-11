import type { SchemaOptions } from 'mongoose'

/**
 * Shared Mongoose Schema options matching existing models:
 * string UUID `_id` exposed as virtual `id` and `__v` stripped.
 */
export function baseSchemaOptions(
  collection?: string,
  extra: Partial<SchemaOptions<any>> = {}
): SchemaOptions<any> {
  const transform = (_doc: unknown, ret: Record<string, any>) => {
    ret.id = ret._id
    delete ret.__v
    return ret
  }

  return {
    ...(collection ? { collection } : {}),
    toJSON: { virtuals: true, transform },
    toObject: { virtuals: true, transform },
    ...extra,
  }
}

