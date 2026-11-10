/**
 * Server-side match state service: loads match + innings + balls from DB,
 * computes scorecards with the pure engine, syncs the match state machine
 * (innings completion, targets, results) and builds API/push payloads.
 */
import { db } from './db'
import {
  BallData,
  buildResultText,
  computeInnings,
  InningsStats,
  isAllOut,
  maxWicketsFor,
  oversStr,
  round2,
} from './cricket'

export interface TeamLite {
  id: string
  name: string
  shortName: string
  color: string
  logoUrl?: string | null
}

export interface InningsScoreLine {
  number: number
  battingTeamId: string
  runs: number
  wickets: number
  overs: string
  declared: boolean
}

export interface BowlerOption {
  id: string
  name: string
  overs: string
  runs: number
  wickets: number
  maxOvers: number
  blocked: boolean
  blockedReason: string | null
}

export interface LiveView {
  inningsNumber: number
  battingTeamId: string
  bowlingTeamId: string
  strikerId: string | null
  nonStrikerId: string | null
  bowlerId: string | null
  needsNewBatsman: 'STRIKER' | 'NON_STRIKER' | null
  overComplete: boolean
  lastOverBowlerId: string | null
  currentRunRate: number
  requiredRunRate: number | null
  target: number | null
  ballsRemaining: number | null
  yetToBat: { id: string; name: string; jerseyNumber: number | null; role: string }[]
  bowlers: BowlerOption[]
  thisOver: { label: string; kind: string; runs: number }[]
  squadSizes: { batting: number; bowling: number }
  maxWickets: number
}

export interface MatchSummary {
  id: string
  format: string
  totalOvers: number
  venue: string | null
  status: string
  currentInnings: number
  tossWinnerId: string | null
  tossDecision: string | null
  battingFirstId: string | null
  target: number | null
  resultText: string | null
  winnerId: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  teamA: TeamLite
  teamB: TeamLite
  scores: InningsScoreLine[]
  liveTeamId: string | null
}

export interface MatchStatePayload {
  match: MatchSummary
  innings: InningsStats[]
  live: LiveView | null
}

type FullMatch = NonNullable<Awaited<ReturnType<typeof loadFullMatch>>>

async function loadFullMatch(matchId: string) {
  return db.match.findUnique({
    where: { id: matchId },
    include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
  })
}

async function loadSquads(match: { teamAId: string; teamBId: string }) {
  const teams = await db.team.findMany({
    where: { id: { in: [match.teamAId, match.teamBId] } },
    include: { players: { orderBy: [{ jerseyNumber: 'asc' }, { name: 'asc' }] } },
  })
  const teamA = teams.find((t) => t.id === match.teamAId) ?? null
  const teamB = teams.find((t) => t.id === match.teamBId) ?? null
  return { teamA, teamB }
}

export function teamLite(t: { id: string; name: string; shortName: string; color: string; logoUrl?: string | null }): TeamLite {
  return { id: t.id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl ?? null }
}

function toBallData(b: {
  id: string
  sequence: number
  overNumber: number
  strikerId: string
  nonStrikerId: string
  bowlerId: string
  runsOffBat: number
  extraType: string | null
  extraRuns: number
  isLegal: boolean
  isWicket: boolean
  wicketType: string | null
  dismissedId: string | null
  assistId: string | null
  createdAt: Date
}): BallData {
  return {
    id: b.id,
    sequence: b.sequence,
    overNumber: b.overNumber,
    strikerId: b.strikerId,
    nonStrikerId: b.nonStrikerId,
    bowlerId: b.bowlerId,
    runsOffBat: b.runsOffBat,
    extraType: b.extraType as BallData['extraType'],
    extraRuns: b.extraRuns,
    isLegal: b.isLegal,
    isWicket: b.isWicket,
    wicketType: b.wicketType,
    dismissedId: b.dismissedId,
    assistId: b.assistId,
    createdAt: b.createdAt.toISOString(),
  }
}

const playerLite = (p: { id: string; name: string; jerseyNumber: number | null; role: string }) => ({
  id: p.id,
  name: p.name,
  jerseyNumber: p.jerseyNumber,
  role: p.role,
})

function inningsMeta(inn: {
  id: string
  number: number
  battingTeamId: string
  bowlingTeamId: string
  status: string
  currentStrikerId: string | null
  currentNonStrikerId: string | null
  currentBowlerId: string | null
}) {
  return {
    inningsId: inn.id,
    number: inn.number,
    battingTeamId: inn.battingTeamId,
    bowlingTeamId: inn.bowlingTeamId,
    status: inn.status,
    currentStrikerId: inn.currentStrikerId,
    currentNonStrikerId: inn.currentNonStrikerId,
    currentBowlerId: inn.currentBowlerId,
  }
}

/**
 * Re-evaluate innings completion / match result after any scoring change.
 * Also re-opens innings when the last ball is undone.
 */
export async function syncMatchState(matchId: string): Promise<FullMatch> {
  let match = await loadFullMatch(matchId)
  if (!match) throw new Error('Match not found')
  if (!['LIVE', 'INNINGS_BREAK', 'COMPLETED'].includes(match.status)) return match

  const { teamA, teamB } = await loadSquads(match)
  if (!teamA || !teamB) return match
  const nameOf = (id: string) => (id === teamA.id ? teamA.name : teamB.name)

  const innings1 = match.innings.find((i) => i.number === 1) ?? null
  const innings2 = match.innings.find((i) => i.number === 2) ?? null

  const stats1 = innings1
    ? computeInnings(
        inningsMeta(innings1),
        innings1.balls.map(toBallData),
        (innings1.battingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite),
        (innings1.bowlingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite),
        match.totalOvers
      )
    : null

  // ----- Innings 1 natural completion (overs done or all out) -----
  if (innings1 && innings1.status === 'IN_PROGRESS' && stats1 && (match.status === 'LIVE' || match.status === 'INNINGS_BREAK')) {
    const squad1 = innings1.battingTeamId === teamA.id ? teamA.players.length : teamB.players.length
    const oversDone = stats1.legalBalls >= match.totalOvers * 6
    const allOut = isAllOut(stats1.wickets, squad1)
    if (oversDone || allOut) {
      await db.innings.update({ where: { id: innings1.id }, data: { status: 'COMPLETED' } })
      innings1.status = 'COMPLETED'
      if (match.status === 'LIVE') {
        match = await db.match.update({
          where: { id: match.id },
          data: { status: 'INNINGS_BREAK', target: stats1.runs + 1 },
          include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
        })
      }
    }
  }

  // ----- Innings 2 completion (chase done, overs done or all out) -----
  if (innings2 && innings2.status === 'IN_PROGRESS' && match.status === 'LIVE' && match.currentInnings === 2 && stats1) {
    const battingTeam2 = innings2.battingTeamId === teamA.id ? teamA : teamB
    const bowlingTeam2 = innings2.bowlingTeamId === teamA.id ? teamA : teamB
    const stats2 = computeInnings(
      inningsMeta(innings2),
      innings2.balls.map(toBallData),
      battingTeam2.players.map(playerLite),
      bowlingTeam2.players.map(playerLite),
      match.totalOvers
    )
    const target = match.target ?? stats1.runs + 1
    const chased = stats2.runs >= target
    const oversDone = stats2.legalBalls >= match.totalOvers * 6
    const allOut = isAllOut(stats2.wickets, battingTeam2.players.length)
    if (chased || oversDone || allOut) {
      await db.innings.update({ where: { id: innings2.id }, data: { status: 'COMPLETED' } })
      innings2.status = 'COMPLETED'
      const { text, winnerId } = buildResultText(stats1, stats2, battingTeam2.players.length, nameOf)
      match = await db.match.update({
        where: { id: match.id },
        data: { status: 'COMPLETED', resultText: text, winnerId, endedAt: new Date() },
        include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
      })
    }
  }

  return match
}

/** Full payload for one match (used by GET endpoint and socket broadcast). */
export async function buildMatchPayload(matchId: string): Promise<MatchStatePayload | null> {
  const match = await loadFullMatch(matchId)
  if (!match) return null
  const { teamA, teamB } = await loadSquads(match)
  if (!teamA || !teamB) return null

  const stats: InningsStats[] = match.innings.map((inn) =>
    computeInnings(
      inningsMeta(inn),
      inn.balls.map(toBallData),
      (inn.battingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite),
      (inn.bowlingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite),
      match.totalOvers
    )
  )
  stats.sort((a, b) => a.number - b.number)

  const current =
    match.status === 'LIVE' || match.status === 'PAUSED'
      ? stats.find((s) => s.number === match.currentInnings && s.live) ?? null
      : null

  let live: LiveView | null = null
  if (current) {
    const battingTeam = current.battingTeamId === teamA.id ? teamA : teamB
    const bowlingTeam = current.bowlingTeamId === teamA.id ? teamA : teamB
    const bowlerStats = new Map(current.bowling.map((b) => [b.id, b]))
    const maxOvers = Math.max(1, Math.ceil(match.totalOvers / 5))
    const lastOverBowlerId = current.live?.lastOverBowlerId ?? null
    const atCrease = new Set(
      [current.live?.strikerId, current.live?.nonStrikerId].filter(Boolean) as string[]
    )
    const yetToBat = battingTeam.players
      .filter((p) => !atCrease.has(p.id) && !current.batting.find((b) => b.id === p.id)?.batted)
      .map(playerLite)

    const ballsLeft = match.totalOvers * 6 - current.legalBalls
    const bowlerOptions: BowlerOption[] = bowlingTeam.players.map((p) => {
      const st = bowlerStats.get(p.id)
      const legalBalls = st?.legalBalls ?? 0
      const completeOvers = Math.floor(legalBalls / 6)
      const isCurrentBowler = p.id === (current.live?.bowlerId ?? '')
      const limitReached = completeOvers >= maxOvers && legalBalls % 6 === 0
      const consecutive = lastOverBowlerId !== null && p.id === lastOverBowlerId
      let blockedReason: string | null = null
      if (limitReached) blockedReason = `Over limit reached (${maxOvers} max)`
      else if (consecutive) blockedReason = 'Bowled the previous over'
      return {
        id: p.id,
        name: p.name,
        overs: oversStr(legalBalls),
        runs: st?.runsConceded ?? 0,
        wickets: st?.wickets ?? 0,
        maxOvers,
        blocked: limitReached || consecutive || (isCurrentBowler && !current.live?.overComplete),
        blockedReason,
      }
    })

    live = {
      inningsNumber: current.number,
      battingTeamId: current.battingTeamId,
      bowlingTeamId: current.bowlingTeamId,
      strikerId: current.live?.strikerId ?? null,
      nonStrikerId: current.live?.nonStrikerId ?? null,
      bowlerId: current.live?.bowlerId ?? null,
      needsNewBatsman: current.live?.needsNewBatsman ?? null,
      overComplete: current.live?.overComplete ?? false,
      lastOverBowlerId,
      currentRunRate: current.runRate,
      requiredRunRate: match.target
        ? ballsLeft > 0
          ? round2(((match.target - current.runs) * 6) / ballsLeft)
          : null
        : null,
      target: match.target ?? null,
      ballsRemaining: ballsLeft,
      yetToBat,
      bowlers: bowlerOptions,
      thisOver: current.overs.length ? current.overs[current.overs.length - 1].balls : [],
      squadSizes: { batting: battingTeam.players.length, bowling: bowlingTeam.players.length },
      maxWickets: maxWicketsFor(battingTeam.players.length),
    }
  }

  const squadOf = (teamId: string) => (teamId === teamA.id ? teamA.players.length : teamB.players.length)
  const scores: InningsScoreLine[] = stats.map((s) => ({
    number: s.number,
    battingTeamId: s.battingTeamId,
    runs: s.runs,
    wickets: s.wickets,
    overs: s.oversDisplay,
    declared:
      s.status === 'COMPLETED' &&
      s.legalBalls < match.totalOvers * 6 &&
      !isAllOut(s.wickets, squadOf(s.battingTeamId)),
  }))

  const matchSummary: MatchSummary = {
    id: match.id,
    format: match.format,
    totalOvers: match.totalOvers,
    venue: match.venue,
    status: match.status,
    currentInnings: match.currentInnings,
    tossWinnerId: match.tossWinnerId,
    tossDecision: match.tossDecision,
    battingFirstId: match.battingFirstId,
    target: match.target,
    resultText: match.resultText,
    winnerId: match.winnerId,
    createdAt: match.createdAt.toISOString(),
    startedAt: match.startedAt?.toISOString() ?? null,
    endedAt: match.endedAt?.toISOString() ?? null,
    teamA: teamLite(teamA),
    teamB: teamLite(teamB),
    scores,
    liveTeamId: current ? current.battingTeamId : null,
  }

  return { match: matchSummary, innings: stats, live }
}

/** Lightweight list payload for match cards. */
export async function buildMatchSummaries(): Promise<MatchSummary[]> {
  const matches = await db.match.findMany({
    orderBy: { createdAt: 'desc' },
    include: { innings: { include: { balls: true } } },
  })
  const teamIds = new Set<string>()
  for (const m of matches) {
    teamIds.add(m.teamAId)
    teamIds.add(m.teamBId)
  }
  const teams = await db.team.findMany({ where: { id: { in: [...teamIds] } } })
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const lit = (id: string): TeamLite => {
    const t = teamMap.get(id)
    return t ? teamLite(t) : { id, name: 'Unknown', shortName: 'UNK', color: '#6b7280' }
  }

  return matches.map((m) => {
    const sorted = [...m.innings].sort((a, b) => a.number - b.number)
    const scores: InningsScoreLine[] = sorted.map((inn) => {
      let runs = 0
      let wickets = 0
      let legal = 0
      for (const b of inn.balls) {
        runs += b.runsOffBat + b.extraRuns
        if (b.isWicket) wickets++
        if (b.isLegal) legal++
      }
      return {
        number: inn.number,
        battingTeamId: inn.battingTeamId,
        runs,
        wickets,
        overs: oversStr(legal),
        declared: inn.status === 'COMPLETED',
      }
    })
    return {
      id: m.id,
      format: m.format,
      totalOvers: m.totalOvers,
      venue: m.venue,
      status: m.status,
      currentInnings: m.currentInnings,
      tossWinnerId: m.tossWinnerId,
      tossDecision: m.tossDecision,
      battingFirstId: m.battingFirstId,
      target: m.target,
      resultText: m.resultText,
      winnerId: m.winnerId,
      createdAt: m.createdAt.toISOString(),
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      teamA: lit(m.teamAId),
      teamB: lit(m.teamBId),
      scores,
      liveTeamId: m.status === 'LIVE' ? scores.find((s) => s.number === m.currentInnings)?.battingTeamId ?? null : null,
    }
  })
}
