import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

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
}

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
