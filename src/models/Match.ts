import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

export interface IMatch {
  _id: string
  id: string
  format: string
  totalOvers: number
  venue: string | null
  status: string
  teamAId: string
  teamBId: string
  tossWinnerId: string | null
  tossDecision: string | null
  battingFirstId: string | null
  currentInnings: number
  target: number | null
  resultText: string | null
  winnerId: string | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const MatchSchema = new Schema<IMatch>(
  {
    _id: { type: String, default: () => randomUUID() },
    format: {
      type: String,
      enum: ['T10', 'T20', 'ODI', 'CUSTOM'],
      default: 'T20',
    },
    totalOvers: { type: Number, default: 20 },
    venue: { type: String, default: null },
    status: {
      type: String,
      enum: ['SCHEDULED', 'TOSS_DONE', 'LIVE', 'PAUSED', 'INNINGS_BREAK', 'COMPLETED', 'ABANDONED'],
      default: 'SCHEDULED',
    },
    teamAId: { type: String, required: true, ref: 'Team' },
    teamBId: { type: String, required: true, ref: 'Team' },
    tossWinnerId: { type: String, default: null },
    tossDecision: { type: String, default: null },
    battingFirstId: { type: String, default: null },
    currentInnings: { type: Number, default: 0 },
    target: { type: Number, default: null },
    resultText: { type: String, default: null },
    winnerId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
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

MatchSchema.virtual('id').get(function (this: IMatch) {
  return this._id
})

export const Match = model<IMatch>('Match', MatchSchema)
