import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface IRefreshToken {
  _id: string
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
  createdAt: Date
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, ref: 'User', index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions('refreshTokens')
)

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 })

RefreshTokenSchema.virtual('id').get(function (this: IRefreshToken) {
  return this._id
})

export const RefreshToken = model<IRefreshToken>('RefreshToken', RefreshTokenSchema)

