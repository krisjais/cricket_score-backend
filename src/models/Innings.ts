import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import type { IMatchUmpire } from './Match'

export interface IInnings {
  _id: string
  id: string
  matchId: string
  number: number
  battingTeamId: string
  bowlingTeamId: string
  status: string
  currentStrikerId: string | null
  currentNonStrikerId: string | null
  currentBowlerId: string | null
  mainUmpire: IMatchUmpire | null
  legUmpire: IMatchUmpire | null
}

const InningsUmpireSchema = new Schema<IMatchUmpire>(
  {
    name: { type: String, required: true },
    teamId: { type: String, default: null, ref: 'Team' },
    teamName: { type: String, default: null },
    playerId: { type: String, default: null, ref: 'Player' },
  },
  { _id: false }
)

const InningsSchema = new Schema<IInnings>(
  {
    _id: { type: String, default: () => randomUUID() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    number: { type: Number, required: true },
    battingTeamId: { type: String, required: true, ref: 'Team' },
    bowlingTeamId: { type: String, required: true, ref: 'Team' },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'COMPLETED'],
      default: 'IN_PROGRESS',
    },
    currentStrikerId: { type: String, default: null },
    currentNonStrikerId: { type: String, default: null },
    currentBowlerId: { type: String, default: null },
    mainUmpire: { type: InningsUmpireSchema, default: null },
    legUmpire: { type: InningsUmpireSchema, default: null },
  },
  {
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id
        delete ret.__v
        return ret
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

InningsSchema.index({ matchId: 1, number: 1 }, { unique: true })

InningsSchema.virtual('id').get(function (this: IInnings) {
  return this._id
})

export const Innings = model<IInnings>('Innings', InningsSchema)
