import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export interface ICareerBreakdownRow {
  key: string
  seasonId?: string | null
  seasonName?: string | null
  year?: number | null
  teamId?: string | null
  teamName?: string | null
  teamShortName?: string | null
  tournamentId?: string | null
  tournamentName?: string | null
  matches: number
  inningsBatted: number
  runs: number
  ballsFaced: number
  fours: number
  sixes: number
  highestScore: number
  highestScoreNotOut: boolean
  notOuts: number
  battingAverage: number | null
  strikeRate: number
  fifties: number
  hundreds: number
  inningsBowled: number
  legalBalls: number
  overs: string
  runsConceded: number
  wickets: number
  maidens: number
  bowlingAverage: number | null
  economy: number
  bowlingStrikeRate: number | null
  bestBowlingWickets: number
  bestBowlingRuns: number
  bestBowlingDisplay: string
  catches: number
  runOuts: number
  stumpings: number
  playerOfMatchAwards: number
}

export interface IPlayerCareerStat {
  _id: string
  id: string
  playerId: string
  matches: number
  inningsBatted: number
  runs: number
  ballsFaced: number
  fours: number
  sixes: number
  highestScore: number
  highestScoreNotOut: boolean
  notOuts: number
  battingAverage: number | null
  strikeRate: number
  fifties: number
  hundreds: number
  inningsBowled: number
  legalBallsBowled: number
  oversBowled: string
  runsConceded: number
  wickets: number
  maidens: number
  bowlingAverage: number | null
  economy: number
  bowlingStrikeRate: number | null
  bestBowlingWickets: number
  bestBowlingRuns: number
  bestBowlingDisplay: string
  catches: number
  runOuts: number
  stumpings: number
  playerOfMatchAwards: number
  seasonsCount: number
  teamsCount: number
  tournamentsCount: number
  seasonBreakdown: ICareerBreakdownRow[]
  teamBreakdown: ICareerBreakdownRow[]
  tournamentBreakdown: ICareerBreakdownRow[]
  lastUpdatedAt: Date
}

const BreakdownRowSchema = new Schema<ICareerBreakdownRow>(
  {
    key: { type: String, required: true },
    seasonId: { type: String, default: null },
    seasonName: { type: String, default: null },
    year: { type: Number, default: null },
    teamId: { type: String, default: null },
    teamName: { type: String, default: null },
    teamShortName: { type: String, default: null },
    tournamentId: { type: String, default: null },
    tournamentName: { type: String, default: null },
    matches: { type: Number, default: 0 },
    inningsBatted: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    highestScore: { type: Number, default: 0 },
    highestScoreNotOut: { type: Boolean, default: false },
    notOuts: { type: Number, default: 0 },
    battingAverage: { type: Number, default: null },
    strikeRate: { type: Number, default: 0 },
    fifties: { type: Number, default: 0 },
    hundreds: { type: Number, default: 0 },
    inningsBowled: { type: Number, default: 0 },
    legalBalls: { type: Number, default: 0 },
    overs: { type: String, default: '0.0' },
    runsConceded: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    maidens: { type: Number, default: 0 },
    bowlingAverage: { type: Number, default: null },
    economy: { type: Number, default: 0 },
    bowlingStrikeRate: { type: Number, default: null },
    bestBowlingWickets: { type: Number, default: 0 },
    bestBowlingRuns: { type: Number, default: 0 },
    bestBowlingDisplay: { type: String, default: '0/0' },
    catches: { type: Number, default: 0 },
    runOuts: { type: Number, default: 0 },
    stumpings: { type: Number, default: 0 },
    playerOfMatchAwards: { type: Number, default: 0 },
  },
  { _id: false }
)

const PlayerCareerStatSchema = new Schema<IPlayerCareerStat>(
  {
    _id: { type: String, default: () => randomUUID() },
    playerId: { type: String, required: true, unique: true, ref: 'Player', index: true },
    matches: { type: Number, default: 0 },
    inningsBatted: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    highestScore: { type: Number, default: 0 },
    highestScoreNotOut: { type: Boolean, default: false },
    notOuts: { type: Number, default: 0 },
    battingAverage: { type: Number, default: null },
    strikeRate: { type: Number, default: 0 },
    fifties: { type: Number, default: 0 },
    hundreds: { type: Number, default: 0 },
    inningsBowled: { type: Number, default: 0 },
    legalBallsBowled: { type: Number, default: 0 },
    oversBowled: { type: String, default: '0.0' },
    runsConceded: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    maidens: { type: Number, default: 0 },
    bowlingAverage: { type: Number, default: null },
    economy: { type: Number, default: 0 },
    bowlingStrikeRate: { type: Number, default: null },
    bestBowlingWickets: { type: Number, default: 0 },
    bestBowlingRuns: { type: Number, default: 0 },
    bestBowlingDisplay: { type: String, default: '0/0' },
    catches: { type: Number, default: 0 },
    runOuts: { type: Number, default: 0 },
    stumpings: { type: Number, default: 0 },
    playerOfMatchAwards: { type: Number, default: 0 },
    seasonsCount: { type: Number, default: 0 },
    teamsCount: { type: Number, default: 0 },
    tournamentsCount: { type: Number, default: 0 },
    seasonBreakdown: { type: [BreakdownRowSchema], default: [] },
    teamBreakdown: { type: [BreakdownRowSchema], default: [] },
    tournamentBreakdown: { type: [BreakdownRowSchema], default: [] },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions('playerCareerStats')
)

PlayerCareerStatSchema.virtual('id').get(function (this: IPlayerCareerStat) {
  return this._id
})

export const PlayerCareerStat = model<IPlayerCareerStat>('PlayerCareerStat', PlayerCareerStatSchema)

