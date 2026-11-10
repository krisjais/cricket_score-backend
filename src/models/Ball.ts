import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

export interface IBall {
  _id: string
  id: string
  inningsId: string
  sequence: number
  overNumber: number
  strikerId: string
  nonStrikerId: string
  bowlerId: string
  runsOffBat: number
  extraType: string | null
  extraRuns: number
  isLegal: boolean
  isWicket: boolean
  wicketType: string | null
  dismissedId: string | null
  assistId: string | null
  createdAt: Date
}

const BallSchema = new Schema<IBall>(
  {
    _id: { type: String, default: () => randomUUID() },
    inningsId: { type: String, required: true, ref: 'Innings', index: true },
    sequence: { type: Number, required: true },
    overNumber: { type: Number, required: true },
    strikerId: { type: String, required: true },
    nonStrikerId: { type: String, required: true },
    bowlerId: { type: String, required: true },
    runsOffBat: { type: Number, default: 0 },
    extraType: {
      type: String,
      enum: ['WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', null],
      default: null,
    },
    extraRuns: { type: Number, default: 0 },
    isLegal: { type: Boolean, default: true },
    isWicket: { type: Boolean, default: false },
    wicketType: {
      type: String,
      enum: ['BOWLED', 'CAUGHT', 'CAUGHT_AND_BOWLED', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', null],
      default: null,
    },
    dismissedId: { type: String, default: null },
    assistId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
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

BallSchema.index({ inningsId: 1, sequence: 1 })

BallSchema.virtual('id').get(function (this: IBall) {
  return this._id
})

export const Ball = model<IBall>('Ball', BallSchema)
