import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface ICategoryPreferences {
  GENERAL: boolean
  PRACTICE: boolean
  MATCH_REMINDER: boolean
  MEETING: boolean
  UPDATE: boolean
  TOURNAMENT: boolean
  EMERGENCY: boolean
}

export interface INotificationPreferences {
  _id: string
  id: string
  playerId: string
  emailEnabled: boolean
  pushEnabled: boolean
  categoryPreferences: ICategoryPreferences
  createdAt: Date
  updatedAt: Date
}

const NotificationPreferencesSchema = new Schema<INotificationPreferences>(
  {
    _id: { type: String, default: () => randomUUID() },
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
  },
  baseSchemaOptions('notificationPreferences', { timestamps: true })
)

NotificationPreferencesSchema.virtual('id').get(function (this: INotificationPreferences) {
  return this._id
})

export const NotificationPreferences = model<INotificationPreferences>(
  'NotificationPreferences',
  NotificationPreferencesSchema
)

