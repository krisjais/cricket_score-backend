import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

export interface ITeam {
  _id: string
  id: string
  name: string
  shortName: string
  color: string
  logoUrl?: string | null
  captain: string | null
  createdAt: Date
  updatedAt: Date
}

const TeamSchema = new Schema<ITeam>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, unique: true, trim: true },
    shortName: { type: String, required: true, trim: true, uppercase: true },
    color: { type: String, default: '#0d3a24' },
    logoUrl: { type: String, default: null },
    captain: { type: String, default: null },
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

TeamSchema.virtual('id').get(function (this: ITeam) {
  return this._id
})

export const Team = model<ITeam>('Team', TeamSchema)
