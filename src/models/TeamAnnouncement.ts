import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type AnnouncementPriority = 'NORMAL' | 'IMPORTANT' | 'URGENT'
export type AnnouncementCategory =
  | 'MATCH_REMINDER'
  | 'MEETING'
  | 'PRACTICE'
  | 'UPDATE'
  | 'TOURNAMENT'
  | 'EMERGENCY'
  | 'GENERAL'

export type AnnouncementStatus = 'published' | 'archived'

export interface ITeamAnnouncement {
  _id: string
  id: string
  seasonId: string
  teamId: string
  authorPlayerId: string
  title: string
  content: string
  priority: AnnouncementPriority
  category: AnnouncementCategory
  eventDate: Date | null
  eventTime: string | null
  location: string | null
  attachmentUrl: string | null
  status: AnnouncementStatus
  publishedAt: Date
  createdAt: Date
  updatedAt: Date
}

const TeamAnnouncementSchema = new Schema<ITeamAnnouncement>(
  {
    _id: { type: String, default: () => randomUUID() },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    authorPlayerId: { type: String, required: true, ref: 'Player', index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    priority: {
      type: String,
      enum: ['NORMAL', 'IMPORTANT', 'URGENT'],
      default: 'NORMAL',
      index: true,
    },
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
    eventDate: { type: Date, default: null },
    eventTime: { type: String, default: null, trim: true },
    location: { type: String, default: null, trim: true },
    attachmentUrl: { type: String, default: null, trim: true },
    status: {
      type: String,
      enum: ['published', 'archived'],
      default: 'published',
      index: true,
    },
    publishedAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions('teamAnnouncements', { timestamps: true })
)

TeamAnnouncementSchema.index({ teamId: 1, seasonId: 1, createdAt: -1 })

TeamAnnouncementSchema.virtual('id').get(function (this: ITeamAnnouncement) {
  return this._id
})

export const TeamAnnouncement = model<ITeamAnnouncement>(
  'TeamAnnouncement',
  TeamAnnouncementSchema
)

