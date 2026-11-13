import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'TENTATIVE'

export interface IPlayerAvailability {
  _id: string
  id: string
  matchId: string
  teamId: string
  seasonId: string
  playerId: string
  status: AvailabilityStatus
  note: string | null
  createdAt: Date
  updatedAt: Date
}

const PlayerAvailabilitySchema = new Schema<IPlayerAvailability>(
  {
    _id: { type: String, default: () => randomUUID() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    status: {
      type: String,
      enum: ['AVAILABLE', 'UNAVAILABLE', 'TENTATIVE'],
      default: 'AVAILABLE',
      index: true,
    },
    note: { type: String, default: null, trim: true, maxlength: 300 },
  },
  baseSchemaOptions('playerAvailability', { timestamps: true })
)

// One availability response per player per match
PlayerAvailabilitySchema.index({ matchId: 1, playerId: 1 }, { unique: true })
PlayerAvailabilitySchema.index({ matchId: 1, teamId: 1, status: 1 })

PlayerAvailabilitySchema.virtual('id').get(function (this: IPlayerAvailability) {
  return this._id
})

export const PlayerAvailability = model<IPlayerAvailability>(
  'PlayerAvailability',
  PlayerAvailabilitySchema
)

