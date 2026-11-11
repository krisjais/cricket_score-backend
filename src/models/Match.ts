import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type MatchPlayerStatusType = 'PLAYED' | 'RETIRED_HURT' | 'RETIRED_OUT' | 'ABSENT'
export type ScorecardStatus = 'DRAFT' | 'FINALIZED' | 'VERIFIED' | 'CORRECTION_REQUIRED'

export interface IMatchPlayerStatusEntry {
  playerId: string
  status: MatchPlayerStatusType
  notes?: string | null
}

export interface IMatch {
  _id: string
  id: string
  format: string
  totalOvers: number
  venue: string | null
  status: string
  teamAId: string
  teamBId: string
  seasonId: string | null
  tournamentId: string | null
  matchDate: Date | null
  playingXIA: string[]
  playingXIB: string[]
  playerStatuses: IMatchPlayerStatusEntry[]
  playerOfMatchId: string | null
  scorecardStatus: ScorecardStatus
  finalizedAt: Date | null
  finalizedBy: string | null
  verifiedAt: Date | null
  verifiedBy: string | null
  statsProcessedVersion: number
  statsSnapshotHash: string | null
  tossWinnerId: string | null
  tossDecision: string | null
  battingFirstId: string | null
  currentInnings: number
  target: number | null
  resultText: string | null
  winnerId: string | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const PlayerStatusEntrySchema = new Schema<IMatchPlayerStatusEntry>(
  {
    playerId: { type: String, required: true, ref: 'Player' },
    status: { type: String, enum: ['PLAYED', 'RETIRED_HURT', 'RETIRED_OUT', 'ABSENT'], default: 'PLAYED' },
    notes: { type: String, default: null },
  },
  { _id: false }
)

const MatchSchema = new Schema<IMatch>(
  {
    _id: { type: String, default: () => randomUUID() },
    format: {
      type: String,
      enum: ['T10', 'T20', 'ODI', 'CUSTOM'],
      default: 'T20',
    },
    totalOvers: { type: Number, default: 20 },
    venue: { type: String, default: null },
    status: {
      type: String,
      enum: ['SCHEDULED', 'TOSS_DONE', 'LIVE', 'PAUSED', 'INNINGS_BREAK', 'COMPLETED', 'ABANDONED'],
      default: 'SCHEDULED',
    },
    teamAId: { type: String, required: true, ref: 'Team' },
    teamBId: { type: String, required: true, ref: 'Team' },
    seasonId: { type: String, default: null, ref: 'Season', index: true },
    tournamentId: { type: String, default: null, ref: 'Tournament', index: true },
    matchDate: { type: Date, default: null },
    playingXIA: { type: [String], default: [] },
    playingXIB: { type: [String], default: [] },
    playerStatuses: { type: [PlayerStatusEntrySchema], default: [] },
    playerOfMatchId: { type: String, default: null, ref: 'Player' },
    scorecardStatus: {
      type: String,
      enum: ['DRAFT', 'FINALIZED', 'VERIFIED', 'CORRECTION_REQUIRED'],
      default: 'DRAFT',
      index: true,
    },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: null },
    statsProcessedVersion: { type: Number, default: 0 },
    statsSnapshotHash: { type: String, default: null },
    tossWinnerId: { type: String, default: null },
    tossDecision: { type: String, default: null },
    battingFirstId: { type: String, default: null },
    currentInnings: { type: Number, default: 0 },
    target: { type: Number, default: null },
    resultText: { type: String, default: null },
    winnerId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  baseSchemaOptions(undefined, { timestamps: true })
)

MatchSchema.virtual('id').get(function (this: IMatch) {
  return this._id
})

export const Match = model<IMatch>('Match', MatchSchema)
