import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED'

export interface ISeason {
  _id: string
  id: string
  name: string
  code: string
  year: number
  status: SeasonStatus
  isDefault: boolean
  startDate: Date | null
  endDate: Date | null
  createdAt: Date
  updatedAt: Date
}

const SeasonSchema = new Schema<ISeason>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    year: { type: Number, required: true, index: true },
    status: { type: String, enum: ['UPCOMING', 'ACTIVE', 'COMPLETED'], default: 'ACTIVE', index: true },
    isDefault: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
  },
  baseSchemaOptions('seasons', { timestamps: true })
)

SeasonSchema.virtual('id').get(function (this: ISeason) {
  return this._id
})

export const Season = model<ISeason>('Season', SeasonSchema)

