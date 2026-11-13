import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface IPushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface IPushSubscription {
  _id: string
  id: string
  playerId: string
  endpoint: string
  keys: IPushSubscriptionKeys
  deviceInfo?: string | null
  createdAt: Date
  updatedAt: Date
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    _id: { type: String, default: () => randomUUID() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    deviceInfo: { type: String, default: null },
  },
  baseSchemaOptions('pushSubscriptions', { timestamps: true })
)

PushSubscriptionSchema.virtual('id').get(function (this: IPushSubscription) {
  return this._id
})

export const PushSubscription = model<IPushSubscription>(
  'PushSubscription',
  PushSubscriptionSchema
)

