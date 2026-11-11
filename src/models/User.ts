import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface IUser {
  _id: string
  id: string
  name: string
  email: string | null
  mobile: string | null
  passwordHash: string
  role: 'PLAYER' | 'ADMIN'
  emailVerified: boolean
  mobileVerified: boolean
  isActive: boolean
  playerId: string | null
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    mobile: { type: String, default: null, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['PLAYER', 'ADMIN'], default: 'PLAYER' },
    emailVerified: { type: Boolean, default: false },
    mobileVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    playerId: { type: String, default: null, ref: 'Player' },
    lastLoginAt: { type: Date, default: null },
  },
  baseSchemaOptions('users', { timestamps: true })
)

// Partial unique indexes so null values never collide while enforcing strict uniqueness on real credentials
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
)
UserSchema.index(
  { mobile: 1 },
  { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } }
)
UserSchema.index(
  { playerId: 1 },
  { unique: true, partialFilterExpression: { playerId: { $type: 'string' } } }
)

UserSchema.virtual('id').get(function (this: IUser) {
  return this._id
})

export const User = model<IUser>('User', UserSchema)

