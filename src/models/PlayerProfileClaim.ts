import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_COMPLETED'

export interface IPlayerProfileClaim {
  _id: string
  id: string
  userId: string
  targetPlayerId: string
  requestedEmail: string | null
  requestedMobile: string | null
  verificationMethod: 'OTP_EMAIL' | 'OTP_MOBILE' | 'ADMIN'
  otpVerified: boolean
  evidenceNotes: string | null
  status: ClaimStatus
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

const PlayerProfileClaimSchema = new Schema<IPlayerProfileClaim>(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, ref: 'User', index: true },
    targetPlayerId: { type: String, required: true, ref: 'Player', index: true },
    requestedEmail: { type: String, default: null },
    requestedMobile: { type: String, default: null },
    verificationMethod: { type: String, enum: ['OTP_EMAIL', 'OTP_MOBILE', 'ADMIN'], required: true },
    otpVerified: { type: Boolean, default: false },
    evidenceNotes: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_COMPLETED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  baseSchemaOptions('playerProfileClaims', { timestamps: true })
)

PlayerProfileClaimSchema.virtual('id').get(function (this: IPlayerProfileClaim) {
  return this._id
})

export const PlayerProfileClaim = model<IPlayerProfileClaim>('PlayerProfileClaim', PlayerProfileClaimSchema)

