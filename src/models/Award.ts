import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type AwardScope = 'MATCH' | 'TOURNAMENT' | 'SEASON'
export type AwardType =
  | 'PLAYER_OF_MATCH'
  | 'BEST_BATTER'
  | 'BEST_BOWLER'
  | 'BEST_FIELDER'
  | 'PLAYER_OF_TOURNAMENT'

export interface IAward {
  _id: string
  id: string
  scope: AwardScope
  awardType: AwardType
  matchId: string | null
  tournamentId: string | null
  seasonId: string | null
  playerId: string
  teamId: string | null
  notes: string | null
  awardedBy: string | null
  awardedAt: Date
  createdAt: Date
}

const AwardSchema = new Schema<IAward>(
  {
    _id: { type: String, default: () => randomUUID() },
    scope: { type: String, enum: ['MATCH', 'TOURNAMENT', 'SEASON'], required: true, index: true },
    awardType: {
      type: String,
      enum: ['PLAYER_OF_MATCH', 'BEST_BATTER', 'BEST_BOWLER', 'BEST_FIELDER', 'PLAYER_OF_TOURNAMENT'],
      required: true,
    },
    matchId: { type: String, default: null, ref: 'Match', index: true },
    tournamentId: { type: String, default: null, ref: 'Tournament', index: true },
    seasonId: { type: String, default: null, ref: 'Season', index: true },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, default: null, ref: 'Team' },
    notes: { type: String, default: null },
    awardedBy: { type: String, default: null },
    awardedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions('awards')
)

AwardSchema.index(
  { scope: 1, matchId: 1, awardType: 1 },
  { unique: true, partialFilterExpression: { matchId: { $type: 'string' } } }
)

AwardSchema.virtual('id').get(function (this: IAward) {
  return this._id
})

export const Award = model<IAward>('Award', AwardSchema)

