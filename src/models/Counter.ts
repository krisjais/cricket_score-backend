import { Schema, model } from 'mongoose'
import { baseSchemaOptions } from './schema-helpers'

export interface ICounter {
  _id: string
  id: string
  seq: number
  updatedAt: Date
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  baseSchemaOptions('counters', { timestamps: { createdAt: false, updatedAt: true } })
)

CounterSchema.virtual('id').get(function (this: ICounter) {
  return this._id
})

export const Counter = model<ICounter>('Counter', CounterSchema)

