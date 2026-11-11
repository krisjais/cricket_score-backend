import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type AuditAction =
  | 'FINALIZE_MATCH'
  | 'VERIFY_MATCH'
  | 'CORRECT_MATCH'
  | 'RECALCULATE_PLAYER'
  | 'RECALCULATE_ALL'
  | 'CLAIM_PLAYER'
  | 'MERGE_PLAYERS'
  | 'ASSIGN_TEAM_MEMBERSHIP'
  | 'VERIFY_PLAYER'
  | 'UPDATE_PLAYER_STATUS'

export interface IStatisticsAuditLog {
  _id: string
  id: string
  action: AuditAction
  actorType: 'ADMIN' | 'PLAYER' | 'SYSTEM'
  actorId: string | null
  actorName: string | null
  matchId: string | null
  playerId: string | null
  sourcePlayerId: string | null
  targetPlayerId: string | null
  reason: string | null
  beforeSummary: Record<string, any> | null
  afterSummary: Record<string, any> | null
  metadata: Record<string, any> | null
  createdAt: Date
}

const StatisticsAuditLogSchema = new Schema<IStatisticsAuditLog>(
  {
    _id: { type: String, default: () => randomUUID() },
    action: {
      type: String,
      enum: [
        'FINALIZE_MATCH',
        'VERIFY_MATCH',
        'CORRECT_MATCH',
        'RECALCULATE_PLAYER',
        'RECALCULATE_ALL',
        'CLAIM_PLAYER',
        'MERGE_PLAYERS',
        'ASSIGN_TEAM_MEMBERSHIP',
        'VERIFY_PLAYER',
        'UPDATE_PLAYER_STATUS',
      ],
      required: true,
      index: true,
    },
    actorType: { type: String, enum: ['ADMIN', 'PLAYER', 'SYSTEM'], required: true },
    actorId: { type: String, default: null },
    actorName: { type: String, default: null },
    matchId: { type: String, default: null, index: true },
    playerId: { type: String, default: null, index: true },
    sourcePlayerId: { type: String, default: null },
    targetPlayerId: { type: String, default: null },
    reason: { type: String, default: null },
    beforeSummary: { type: Schema.Types.Mixed, default: null },
    afterSummary: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  baseSchemaOptions('statisticsAuditLogs')
)

StatisticsAuditLogSchema.virtual('id').get(function (this: IStatisticsAuditLog) {
  return this._id
})

export const StatisticsAuditLog = model<IStatisticsAuditLog>('StatisticsAuditLog', StatisticsAuditLogSchema)

