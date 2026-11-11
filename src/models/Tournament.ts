import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface ITournament {
  _id: string
  id: string
  name: string
  shortName: string
  seasonId: string
  format: 'T10' | 'T20' | 'ODI' | 'CUSTOM'
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED'
  startDate: Date | null
  endDate: Date | null
  winnerTeamId: string | null
  createdAt: Date
  updatedAt: Date
}

const TournamentSchema = new Schema<ITournament>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, required: true, trim: true, uppercase: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    format: { type: String, enum: ['T10', 'T20', 'ODI', 'CUSTOM'], default: 'T20' },
    status: { type: String, enum: ['UPCOMING', 'ACTIVE', 'COMPLETED'], default: 'ACTIVE', index: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    winnerTeamId: { type: String, default: null, ref: 'Team' },
  },
  baseSchemaOptions('tournaments', { timestamps: true })
)

TournamentSchema.index({ seasonId: 1, name: 1 }, { unique: true })

TournamentSchema.virtual('id').get(function (this: ITournament) {
  return this._id
})

export const Tournament = model<ITournament>('Tournament', TournamentSchema)

