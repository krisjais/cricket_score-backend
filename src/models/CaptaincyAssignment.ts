import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type CaptaincyStatus = 'active' | 'completed' | 'revoked'

export interface ICaptaincyAssignment {
  _id: string
  id: string
  playerId: string
  teamId: string
  seasonId: string
  assignedBy: string
  assignedAt: Date
  endedAt: Date | null
  status: CaptaincyStatus
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

const CaptaincyAssignmentSchema = new Schema<ICaptaincyAssignment>(
  {
    _id: { type: String, default: () => randomUUID() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    assignedBy: { type: String, required: true, trim: true },
    assignedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'completed', 'revoked'],
      default: 'active',
      index: true,
    },
    notes: { type: String, default: null, trim: true },
  },
  baseSchemaOptions('captaincyAssignments', { timestamps: true })
)

// Invariant: At most ONE active captain per team per season
CaptaincyAssignmentSchema.index(
  { seasonId: 1, teamId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
)

// Invariant: A player cannot be active captain for two different teams in the same season
CaptaincyAssignmentSchema.index(
  { seasonId: 1, playerId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
)

// Query index for player captaincy history
CaptaincyAssignmentSchema.index({ playerId: 1, assignedAt: -1 })

CaptaincyAssignmentSchema.virtual('id').get(function (this: ICaptaincyAssignment) {
  return this._id
})

export const CaptaincyAssignment = model<ICaptaincyAssignment>(
  'CaptaincyAssignment',
  CaptaincyAssignmentSchema
)

