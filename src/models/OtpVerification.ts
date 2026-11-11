import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type OtpChannel = 'EMAIL' | 'MOBILE'
export type OtpPurpose = 'REGISTER' | 'VERIFY_EMAIL' | 'VERIFY_MOBILE' | 'CLAIM_PROFILE' | 'RESET_PASSWORD'

export interface IOtpVerification {
  _id: string
  id: string
  channel: OtpChannel
  target: string
  purpose: OtpPurpose
  codeHash: string
  expiresAt: Date
  attempts: number
  consumedAt: Date | null
  userId: string | null
  createdAt: Date
}

const OtpVerificationSchema = new Schema<IOtpVerification>(
  {
    _id: { type: String, default: () => randomUUID() },
    channel: { type: String, enum: ['EMAIL', 'MOBILE'], required: true },
    target: { type: String, required: true, trim: true },
    purpose: {
      type: String,
      enum: ['REGISTER', 'VERIFY_EMAIL', 'VERIFY_MOBILE', 'CLAIM_PROFILE', 'RESET_PASSWORD'],
      required: true,
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    userId: { type: String, default: null, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions('otpVerifications')
)

OtpVerificationSchema.index({ channel: 1, target: 1, purpose: 1, createdAt: -1 })
OtpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })

OtpVerificationSchema.virtual('id').get(function (this: IOtpVerification) {
  return this._id
})

export const OtpVerification = model<IOtpVerification>('OtpVerification', OtpVerificationSchema)

