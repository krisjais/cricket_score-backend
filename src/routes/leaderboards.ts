import { Router } from 'express'
import {
  connectDB,
  Match,
  Player,
  PlayerMatchStat,
  Team,
} from '../lib/db'
import { sendOk, sendFail } from '../lib/api-utils'
import { oversStr, round2 } from '../lib/cricket'

const router = Router()

type LeaderboardCategory =
  | 'runs'
  | 'batting_avg'
  | 'strike_rate'
  | 'hundreds'
  | 'fifties'
  | 'sixes'
  | 'wickets'
  | 'bowling_avg'
  | 'economy'
  | 'best_bowling'
  | 'catches'
  | 'run_outs'
  | 'player_of_match'
  | 'all_rounder'

/**
 * Qualification thresholds prevent single-appearance outliers from topping rate-based rankings.
 */
function qualificationRule(category: LeaderboardCategory, scopeMatchesCount: number) {
  const minInnings = scopeMatchesCount <= 2 ? 1 : 2
  const minBallsFaced = scopeMatchesCount <= 2 ? 6 : 20
  const minLegalBallsBowled = scopeMatchesCount <= 2 ? 6 : 18
  switch (category) {
    case 'batting_avg':
      return { minInnings, label: `Min ${minInnings} innings & at least 1 dismissal` }
    case 'strike_rate':
      return { minBallsFaced, label: `Min ${minBallsFaced} balls faced` }
    case 'bowling_avg':
      return { minLegalBallsBowled, label: `Min ${minLegalBallsBowled} legal balls & 1+ wicket` }
    case 'economy':
      return { minLegalBallsBowled, label: `Min ${minLegalBallsBowled} legal balls bowled` }
    default:
      return { label: 'All verified matches' }
  }
}

// GET /api/leaderboards
router.get('/', async (req, res) => {
  try {
    await connectDB()
    const category = (String(req.query.category || 'runs') as LeaderboardCategory)
    const scope = String(req.query.scope || 'ALL_TIME').toUpperCase()
    const seasonId = typeof req.query.seasonId === 'string' && req.query.seasonId ? req.query.seasonId : null
    const tournamentId = typeof req.query.tournamentId === 'string' && req.query.tournamentId ? req.query.tournamentId : null
    const teamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : null

    const verifiedMatchQuery: Record<string, any> = { status: 'COMPLETED', scorecardStatus: 'VERIFIED' }
    if (scope === 'SEASON' && seasonId) verifiedMatchQuery.seasonId = seasonId
    if (scope === 'TOURNAMENT' && tournamentId) verifiedMatchQuery.tournamentId = tournamentId

    const verifiedMatches = await Match.find(verifiedMatchQuery).select({ _id: 1 }).lean()
    const verifiedMatchIds = verifiedMatches.map((m) => m._id)

    if (verifiedMatchIds.length === 0) {
      return sendOk(res, {
        category,
        scope,
        qualification: qualificationRule(category, 0).label,
        totalVerifiedMatches: 0,
        entries: [],
      })
    }

    const statQuery: Record<string, any> = { matchId: { $in: verifiedMatchIds } }
    if (scope === 'TEAM' && teamId) statQuery.teamId = teamId

    const [matchStats, players, teams] = await Promise.all([
      PlayerMatchStat.find(statQuery).lean(),
      Player.find({ status: { $ne: 'MERGED' } }).lean(),
      Team.find({}).lean(),
    ])

    const playerMap = new Map(players.map((p) => [p._id, p]))
    const teamMap = new Map(teams.map((t) => [t._id, t]))

    type Bucket = {
      playerId: string
      latestTeamId: string | null
      matches: number
      inningsBatted: number
      runs: number
      ballsFaced: number
      fours: number
      sixes: number
      notOuts: number
      highestScore: number
      fifties: number
      hundreds: number
      inningsBowled: number
      legalBalls: number
      runsConceded: number
      wickets: number
      maidens: number
      bestW: number
      bestR: number
      catches: number
      runOuts: number
      stumpings: number
      playerOfMatch: number
    }

    const buckets = new Map<string, Bucket>()
    for (const st of matchStats) {
      const p = playerMap.get(st.playerId)
      if (!p || p.privacy?.isPublic === false) continue

      let b = buckets.get(st.playerId)
      if (!b) {
        b = {
          playerId: st.playerId,
          latestTeamId: st.teamId,
          matches: 0,
          inningsBatted: 0,
          runs: 0,
          ballsFaced: 0,
          fours: 0,
          sixes: 0,
          notOuts: 0,
          highestScore: 0,
          fifties: 0,
          hundreds: 0,
          inningsBowled: 0,
          legalBalls: 0,
          runsConceded: 0,
          wickets: 0,
          maidens: 0,
          bestW: 0,
          bestR: 0,
          catches: 0,
          runOuts: 0,
          stumpings: 0,
          playerOfMatch: 0,
        }
        buckets.set(st.playerId, b)
      }
      b.latestTeamId = st.teamId
      if (st.played && !st.absent) b.matches += 1
      if (st.batting.innings > 0) {
        b.inningsBatted += st.batting.innings
        b.runs += st.batting.runs
        b.ballsFaced += st.batting.balls
        b.fours += st.batting.fours
        b.sixes += st.batting.sixes
        if (st.batting.notOut) b.notOuts += 1
        b.highestScore = Math.max(b.highestScore, st.batting.runs)
        b.fifties += st.batting.fifty
        b.hundreds += st.batting.hundred
      }
      if (st.bowling.innings > 0) {
        b.inningsBowled += st.bowling.innings
        b.legalBalls += st.bowling.legalBalls
        b.runsConceded += st.bowling.runsConceded
        b.wickets += st.bowling.wickets
        b.maidens += st.bowling.maidens
        if (
          b.inningsBowled === st.bowling.innings ||
          st.bowling.bestFiguresWickets > b.bestW ||
          (st.bowling.bestFiguresWickets === b.bestW && st.bowling.bestFiguresRuns < b.bestR)
        ) {
          b.bestW = st.bowling.bestFiguresWickets
          b.bestR = st.bowling.bestFiguresRuns
        }
      }
      b.catches += st.fielding.catches
      b.runOuts += st.fielding.runOuts
      b.stumpings += st.fielding.stumpings
      if (st.isPlayerOfMatch) b.playerOfMatch += 1
    }

    const qual = qualificationRule(category, verifiedMatches.length)
    const rows = [...buckets.values()].map((b) => {
      const p = playerMap.get(b.playerId)!
      const tm = (b.latestTeamId ? teamMap.get(b.latestTeamId) : null) ?? (p.teamId ? teamMap.get(p.teamId) : null)
      const dismissals = b.inningsBatted - b.notOuts
      const battingAverage = dismissals > 0 ? round2(b.runs / dismissals) : null
      const strikeRate = b.ballsFaced > 0 ? round2((b.runs * 100) / b.ballsFaced) : 0
      const bowlingAverage = b.wickets > 0 ? round2(b.runsConceded / b.wickets) : null
      const economy = b.legalBalls > 0 ? round2((b.runsConceded * 6) / b.legalBalls) : 0
      const allRounderScore = round2(b.runs + b.wickets * 25 + (b.catches + b.runOuts + b.stumpings) * 10)

      return {
        playerId: p._id,
        playerCode: p.playerCode,
        name: p.name,
        role: p.role,
        avatarUrl: p.avatarUrl ?? null,
        isVerified: Boolean(p.isVerified),
        team: tm ? { id: tm._id, name: tm.name, shortName: tm.shortName, color: tm.color } : null,
        matches: b.matches,
        inningsBatted: b.inningsBatted,
        runs: b.runs,
        ballsFaced: b.ballsFaced,
        fours: b.fours,
        sixes: b.sixes,
        highestScore: b.highestScore,
        notOuts: b.notOuts,
        battingAverage,
        strikeRate,
        fifties: b.fifties,
        hundreds: b.hundreds,
        legalBalls: b.legalBalls,
        overs: oversStr(b.legalBalls),
        runsConceded: b.runsConceded,
        wickets: b.wickets,
        maidens: b.maidens,
        bowlingAverage,
        economy,
        bestBowlingWickets: b.bestW,
        bestBowlingRuns: b.bestR,
        bestBowlingDisplay: b.inningsBowled > 0 ? `${b.bestW}/${b.bestR}` : '0/0',
        catches: b.catches,
        runOuts: b.runOuts,
        stumpings: b.stumpings,
        playerOfMatch: b.playerOfMatch,
        allRounderScore,
      }
    })

    const filtered = rows.filter((r) => {
      switch (category) {
        case 'runs':
          return r.runs > 0
        case 'batting_avg':
          return r.inningsBatted >= (qual.minInnings ?? 1) && r.battingAverage !== null && r.runs > 0
        case 'strike_rate':
          return r.ballsFaced >= (qual.minBallsFaced ?? 6)
        case 'hundreds':
          return r.hundreds > 0
        case 'fifties':
          return r.fifties > 0
        case 'sixes':
          return r.sixes > 0
        case 'wickets':
          return r.wickets > 0
        case 'bowling_avg':
          return r.legalBalls >= (qual.minLegalBallsBowled ?? 6) && r.bowlingAverage !== null && r.wickets > 0
        case 'economy':
          return r.legalBalls >= (qual.minLegalBallsBowled ?? 6)
        case 'best_bowling':
          return r.legalBalls > 0
        case 'catches':
          return r.catches > 0
        case 'run_outs':
          return r.runOuts > 0
        case 'player_of_match':
          return r.playerOfMatch > 0
        case 'all_rounder':
          return r.allRounderScore > 0
        default:
          return r.matches > 0
      }
    })

    filtered.sort((a, b) => {
      switch (category) {
        case 'runs':
          return b.runs - a.runs || b.strikeRate - a.strikeRate
        case 'batting_avg':
          return (b.battingAverage ?? 0) - (a.battingAverage ?? 0) || b.runs - a.runs
        case 'strike_rate':
          return b.strikeRate - a.strikeRate || b.runs - a.runs
        case 'hundreds':
          return b.hundreds - a.hundreds || b.runs - a.runs
        case 'fifties':
          return b.fifties - a.fifties || b.runs - a.runs
        case 'sixes':
          return b.sixes - a.sixes || b.runs - a.runs
        case 'wickets':
          return b.wickets - a.wickets || a.economy - b.economy
        case 'bowling_avg':
          return (a.bowlingAverage ?? 9999) - (b.bowlingAverage ?? 9999) || b.wickets - a.wickets
        case 'economy':
          return a.economy - b.economy || b.wickets - a.wickets
        case 'best_bowling':
          return b.bestBowlingWickets - a.bestBowlingWickets || a.bestBowlingRuns - b.bestBowlingRuns
        case 'catches':
          return b.catches - a.catches || b.matches - a.matches
        case 'run_outs':
          return b.runOuts - a.runOuts || b.matches - a.matches
        case 'player_of_match':
          return b.playerOfMatch - a.playerOfMatch || b.allRounderScore - a.allRounderScore
        case 'all_rounder':
          return b.allRounderScore - a.allRounderScore
        default:
          return b.runs - a.runs
      }
    })

    return sendOk(res, {
      category,
      scope,
      qualification: qual.label,
      totalVerifiedMatches: verifiedMatches.length,
      entries: filtered.slice(0, 50).map((r, i) => ({ ...r, rank: i + 1 })),
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to compute leaderboards', 500)
  }
})

export default router

