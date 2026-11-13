import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type CaptaincyAuditAction = 'ASSIGN' | 'REPLACE' | 'REMOVE' | 'AUTO_EXPIRE'

export interface ICaptaincyAuditLog {
  _id: string
  id: string
  assignmentId: string
  action: CaptaincyAuditAction
  seasonId: string
  teamId: string
  previousCaptainId: string | null
  newCaptainId: string | null
  performedBy: string
  performedAt: Date
  reason: string | null
  createdAt: Date
  updatedAt: Date
}

const CaptaincyAuditLogSchema = new Schema<ICaptaincyAuditLog>(
  {
    _id: { type: String, default: () => randomUUID() },
    assignmentId: { type: String, required: true, ref: 'CaptaincyAssignment', index: true },
    action: {
      type: String,
      enum: ['ASSIGN', 'REPLACE', 'REMOVE', 'AUTO_EXPIRE'],
      required: true,
      index: true,
    },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    previousCaptainId: { type: String, default: null, ref: 'Player' },
    newCaptainId: { type: String, default: null, ref: 'Player' },
    performedBy: { type: String, required: true, trim: true },
    performedAt: { type: Date, default: Date.now },
    reason: { type: String, default: null, trim: true },
  },
  baseSchemaOptions('captaincyAuditLogs', { timestamps: true })
)

CaptaincyAuditLogSchema.index({ performedAt: -1 })
CaptaincyAuditLogSchema.index({ seasonId: 1, teamId: 1, performedAt: -1 })

CaptaincyAuditLogSchema.virtual('id').get(function (this: ICaptaincyAuditLog) {
  return this._id
})

export const CaptaincyAuditLog = model<ICaptaincyAuditLog>(
  'CaptaincyAuditLog',
  CaptaincyAuditLogSchema
)

