import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

export interface IPlayer {
  _id: string
  id: string
  name: string
  jerseyNumber: number | null
  role: string
  gender: 'MALE' | 'FEMALE'
  teamId: string | null
  avatarUrl?: string | null
  createdAt: Date
}

const PlayerSchema = new Schema<IPlayer>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, trim: true },
    jerseyNumber: { type: Number, default: null },
    role: {
      type: String,
      enum: ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'],
      default: 'ALL_ROUNDER',
    },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE'],
      default: 'MALE',
    },
    teamId: { type: String, default: null, ref: 'Team', index: true },
    avatarUrl: { type: String, default: null },
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

PlayerSchema.virtual('id').get(function (this: IPlayer) {
  return this._id
})

export const Player = model<IPlayer>('Player', PlayerSchema)
