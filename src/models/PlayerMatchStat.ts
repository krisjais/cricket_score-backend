import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface IPlayerMatchStat {
  _id: string
  id: string
  matchId: string
  playerId: string
  teamId: string
  opponentTeamId: string
  seasonId: string | null
  tournamentId: string | null
  matchDate: Date
  played: boolean
  didNotBat: boolean
  absent: boolean
  isPlayerOfMatch: boolean
  result: 'WON' | 'LOST' | 'TIED' | 'NO_RESULT'
  matchResultText: string | null
  verificationVersion: number
  computedAt: Date
  batting: {
    innings: number
    runs: number
    balls: number
    fours: number
    sixes: number
    notOut: boolean
    retiredHurt: boolean
    retiredOut: boolean
    dismissalType: string | null
    dismissalText: string | null
    strikeRate: number
    fifty: number
    hundred: number
  }
  bowling: {
    innings: number
    legalBalls: number
    overs: string
    maidens: number
    runsConceded: number
    wickets: number
    wides: number
    noBalls: number
    dots: number
    economy: number
    bestFiguresWickets: number
    bestFiguresRuns: number
  }
  fielding: {
    catches: number
    runOuts: number
    stumpings: number
  }
}

const PlayerMatchStatSchema = new Schema<IPlayerMatchStat>(
  {
    _id: { type: String, default: () => randomUUID() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    playerId: { type: String, required: true, ref: 'Player', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    opponentTeamId: { type: String, required: true, ref: 'Team' },
    seasonId: { type: String, default: null, ref: 'Season', index: true },
    tournamentId: { type: String, default: null, ref: 'Tournament', index: true },
    matchDate: { type: Date, required: true, index: true },
    played: { type: Boolean, default: true },
    didNotBat: { type: Boolean, default: false },
    absent: { type: Boolean, default: false },
    isPlayerOfMatch: { type: Boolean, default: false },
    result: { type: String, enum: ['WON', 'LOST', 'TIED', 'NO_RESULT'], default: 'NO_RESULT' },
    matchResultText: { type: String, default: null },
    verificationVersion: { type: Number, default: 1 },
    computedAt: { type: Date, default: Date.now },
    batting: {
      innings: { type: Number, default: 0 },
      runs: { type: Number, default: 0 },
      balls: { type: Number, default: 0 },
      fours: { type: Number, default: 0 },
      sixes: { type: Number, default: 0 },
      notOut: { type: Boolean, default: false },
      retiredHurt: { type: Boolean, default: false },
      retiredOut: { type: Boolean, default: false },
      dismissalType: { type: String, default: null },
      dismissalText: { type: String, default: null },
      strikeRate: { type: Number, default: 0 },
      fifty: { type: Number, default: 0 },
      hundred: { type: Number, default: 0 },
    },
    bowling: {
      innings: { type: Number, default: 0 },
      legalBalls: { type: Number, default: 0 },
      overs: { type: String, default: '0.0' },
      maidens: { type: Number, default: 0 },
      runsConceded: { type: Number, default: 0 },
      wickets: { type: Number, default: 0 },
      wides: { type: Number, default: 0 },
      noBalls: { type: Number, default: 0 },
      dots: { type: Number, default: 0 },
      economy: { type: Number, default: 0 },
      bestFiguresWickets: { type: Number, default: 0 },
      bestFiguresRuns: { type: Number, default: 0 },
    },
    fielding: {
      catches: { type: Number, default: 0 },
      runOuts: { type: Number, default: 0 },
      stumpings: { type: Number, default: 0 },
    },
  },
  baseSchemaOptions('playerMatchStats')
)

PlayerMatchStatSchema.index({ matchId: 1, playerId: 1 }, { unique: true })
PlayerMatchStatSchema.index({ playerId: 1, matchDate: -1 })
PlayerMatchStatSchema.index({ seasonId: 1, playerId: 1 })
PlayerMatchStatSchema.index({ tournamentId: 1, playerId: 1 })
PlayerMatchStatSchema.index({ teamId: 1, playerId: 1 })

PlayerMatchStatSchema.virtual('id').get(function (this: IPlayerMatchStat) {
  return this._id
})

export const PlayerMatchStat = model<IPlayerMatchStat>('PlayerMatchStat', PlayerMatchStatSchema)

