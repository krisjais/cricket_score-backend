import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'

export interface IAdmin {
  _id: string
  id: string
  username: string
  passwordHash: string
  createdAt: Date
}

const AdminSchema = new Schema<IAdmin>(
  {
    _id: { type: String, default: () => randomUUID() },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
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

AdminSchema.virtual('id').get(function (this: IAdmin) {
  return this._id
})

export const Admin = model<IAdmin>('Admin', AdminSchema)
