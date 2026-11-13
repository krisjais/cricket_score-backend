import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'
import type { AnnouncementCategory, AnnouncementPriority } from './TeamAnnouncement'

export interface IInAppNotification {
  _id: string
  id: string
  recipientPlayerId: string
  announcementId: string
  teamId: string
  seasonId: string
  type: 'team_announcement'
  title: string
  content: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  eventDate?: Date | null
  eventTime?: string | null
  location?: string | null
  attachmentUrl?: string | null
  isRead: boolean
  readAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const InAppNotificationSchema = new Schema<IInAppNotification>(
  {
    _id: { type: String, default: () => randomUUID() },
    recipientPlayerId: { type: String, required: true, ref: 'Player', index: true },
    announcementId: { type: String, required: true, ref: 'TeamAnnouncement', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    type: { type: String, enum: ['team_announcement'], default: 'team_announcement' },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        'MATCH_REMINDER',
        'MEETING',
        'PRACTICE',
        'UPDATE',
        'TOURNAMENT',
        'EMERGENCY',
        'GENERAL',
      ],
      default: 'GENERAL',
      index: true,
    },
    priority: {
      type: String,
      enum: ['NORMAL', 'IMPORTANT', 'URGENT'],
      default: 'NORMAL',
      index: true,
    },
    eventDate: { type: Date, default: null },
    eventTime: { type: String, default: null },
    location: { type: String, default: null },
    attachmentUrl: { type: String, default: null },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  baseSchemaOptions('notifications', { timestamps: true })
)

// Compound index for player notification feed with read status and sort
InAppNotificationSchema.index({ recipientPlayerId: 1, isRead: 1, createdAt: -1 })

// Guarantee uniqueness: one in-app notification per player per announcement
InAppNotificationSchema.index({ recipientPlayerId: 1, announcementId: 1 }, { unique: true })

InAppNotificationSchema.virtual('id').get(function (this: IInAppNotification) {
  return this._id
})

export const InAppNotification = model<IInAppNotification>(
  'InAppNotification',
  InAppNotificationSchema
)

