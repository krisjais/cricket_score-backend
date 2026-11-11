import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type MembershipStatus = 'ACTIVE' | 'COMPLETED' | 'TRANSFERRED' | 'RELEASED'
export type MembershipDesignation = 'PLAYER' | 'CAPTAIN' | 'VICE_CAPTAIN' | 'WICKETKEEPER'

export interface ITeamMembership {
  _id: string
  id: string
  playerId: string
  teamId: string
  seasonId: string
  joinedAt: Date
  leftAt: Date | null
  status: MembershipStatus
  designation: MembershipDesignation
  jerseyNumber: number | null
  assignedBy: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

const TeamMembershipSchema = new Schema<ITeamMembership>(
  {
    _id: { type: String, default: () => randomUUID() },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'RELEASED'],
      default: 'ACTIVE',
      index: true,
    },
    designation: {
      type: String,
      enum: ['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN', 'WICKETKEEPER'],
      default: 'PLAYER',
    },
    jerseyNumber: { type: Number, default: null },
    assignedBy: { type: String, default: null },
    notes: { type: String, default: null },
  },
  baseSchemaOptions('teamMemberships', { timestamps: true })
)

// Core architectural invariant: one player membership per season
TeamMembershipSchema.index({ playerId: 1, seasonId: 1 }, { unique: true })
TeamMembershipSchema.index({ teamId: 1, seasonId: 1 })

TeamMembershipSchema.virtual('id').get(function (this: ITeamMembership) {
  return this._id
})

export const TeamMembership = model<ITeamMembership>('TeamMembership', TeamMembershipSchema)

