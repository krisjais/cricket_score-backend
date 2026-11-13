import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type DeliveryChannel = 'email' | 'push'
export type DeliveryJobStatus = 'pending' | 'processing' | 'sent' | 'failed'

export interface INotificationDeliveryJob {
  _id: string
  id: string
  announcementId: string
  recipientPlayerId: string
  recipientEmail?: string | null
  subscriptionEndpoint?: string | null
  channel: DeliveryChannel
  status: DeliveryJobStatus
  attempts: number
  maxAttempts: number
  nextRetryAt: Date
  providerMessageId?: string | null
  lastError?: string | null
  sentAt?: Date | null
  failedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const NotificationDeliveryJobSchema = new Schema<INotificationDeliveryJob>(
  {
    _id: { type: String, default: () => randomUUID() },
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
  },
  baseSchemaOptions('notificationDeliveryJobs', { timestamps: true })
)

// Idempotency: prevent duplicate delivery job per announcement, recipient, and channel
NotificationDeliveryJobSchema.index(
  { announcementId: 1, recipientPlayerId: 1, channel: 1, subscriptionEndpoint: 1 },
  { unique: true }
)

// High-speed queue worker index
NotificationDeliveryJobSchema.index({ status: 1, nextRetryAt: 1, attempts: 1 })

NotificationDeliveryJobSchema.virtual('id').get(function (this: INotificationDeliveryJob) {
  return this._id
})

export const NotificationDeliveryJob = model<INotificationDeliveryJob>(
  'NotificationDeliveryJob',
  NotificationDeliveryJobSchema
)

