import { oversStr, round2 } from './cricket'
import type { IAward, IPlayer, IPlayerCareerStat, ISeason, ITeam, ITeamMembership, ITournament, IMatch } from '../models'

export interface DashboardTeamSummary {
  id: string
  name: string
  shortName: string
  color: string
  logoUrl?: string | null
}

export interface DashboardSeasonSummary {
  id: string
  name: string
  year: number
}

export interface DashboardTournamentSummary {
  id: string
  name: string
  shortName: string
}

export interface DashboardMatchHistoryEntry {
  _id: string
  id: string
  matchId: string
  playerId: string
  teamId: string
  opponentTeamId: string
  seasonId: string | null
  tournamentId: string | null
  matchDate: Date | string
  played: boolean
  didNotBat: boolean
  absent: boolean
  isPlayerOfMatch: boolean
  result: 'WON' | 'LOST' | 'TIED' | 'NO_RESULT'
  matchResultText: string | null
  format: string
  venue: string | null
  team: DashboardTeamSummary | null
  opponent: DashboardTeamSummary | null
  season: DashboardSeasonSummary | null
  tournament: DashboardTournamentSummary | null
  batting: {
    innings: number
    runs: number
    balls: number
    fours: number
    sixes: number
    notOut: boolean
    strikeRate: number
    fifty: number
    hundred: number
    dismissalText: string | null
  }
  bowling: {
    innings: number
    legalBalls: number
    overs: string
    maidens: number
    runsConceded: number
    wickets: number
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

export interface PersonalBestMatchRef {
  matchId: string
  opponentName: string | null
  opponentShortName: string | null
  matchDate: Date | string
}

export interface PersonalBestsDto {
  highestScore: (PersonalBestMatchRef & {
    runs: number
    balls: number
    notOut: boolean
    strikeRate: number
  }) | null
  bestBowling: (PersonalBestMatchRef & {
    wickets: number
    runsConceded: number
    overs: string
    economy: number
    display: string
  }) | null
  mostSixesInMatch: (PersonalBestMatchRef & {
    sixes: number
    runs: number
    balls: number
  }) | null
  mostFoursInMatch: (PersonalBestMatchRef & {
    fours: number
    runs: number
    balls: number
  }) | null
  bestStrikeRate: (PersonalBestMatchRef & {
    strikeRate: number
    runs: number
    balls: number
    notOut: boolean
  }) | null
  bestStrikeRateQualified: boolean
  bestStrikeRateCriteria: string
  mostWicketsInMatch: (PersonalBestMatchRef & {
    wickets: number
    runsConceded: number
    overs: string
  }) | null
}

export type AchievementCategory = 'BATTING' | 'BOWLING' | 'CAREER' | 'MATCH' | 'TOURNAMENT'

export interface PlayerAchievementDto {
  id: string
  key: string
  title: string
  subtitle: string
  category: AchievementCategory
  achievedAt: Date | string | null
  count?: number
}

export interface EnrichedPerformancePoint {
  matchIndex: number
  matchKey: string
  matchId: string
  label: string
  opponentName: string
  opponentShortName: string
  date: Date | string
  runs: number
  balls: number
  batted: boolean
  notOut: boolean
  wickets: number
  runsConceded: number
  bowled: boolean
  overs: string
  economy: number
  result: 'WON' | 'LOST' | 'TIED' | 'NO_RESULT'
  cumulativeAverage: number
  cumulativeStrikeRate: number
}

export interface SeasonPerformancePoint {
  seasonId: string
  seasonName: string
  label: string
  year: number
  matches: number
  inningsBatted: number
  runs: number
  balls: number
  inningsBowled: number
  wickets: number
  legalBalls: number
  overs: string
  runsConceded: number
  battingAverage: number | null
  strikeRate: number
  economy: number
  teams: string[]
}

export interface UpcomingPlayerMatchDto {
  id: string
  matchId: string
  format: string
  status: string
  venue: string | null
  matchDate: Date | string | null
  tournament: DashboardTournamentSummary
  season: DashboardSeasonSummary | null
  playerTeam: DashboardTeamSummary | null
  opponent: DashboardTeamSummary | null
}

const STRIKE_RATE_MIN_INNINGS = 2
const STRIKE_RATE_MIN_BALLS = 10
const STRIKE_RATE_CRITERIA = 'Min. 2 batted innings & 10+ balls in an innings'

function matchRef(m: DashboardMatchHistoryEntry): PersonalBestMatchRef {
  return {
    matchId: m.matchId,
    opponentName: m.opponent?.name ?? null,
    opponentShortName: m.opponent?.shortName ?? null,
    matchDate: m.matchDate,
  }
}

function formatOpponentLabel(m: DashboardMatchHistoryEntry): string {
  return m.opponent?.shortName || m.opponent?.name || 'opponent'
}

/**
 * Derive single-match and qualifying career-record Personal Bests strictly
 * from finalized/verified PlayerMatchStat rows sorted descending by date.
 */
export function computePersonalBests(matchHistoryDesc: DashboardMatchHistoryEntry[]): PersonalBestsDto {
  const batted = matchHistoryDesc.filter((m) => m.batting.innings > 0)
  const bowled = matchHistoryDesc.filter((m) => m.bowling.innings > 0 || m.bowling.legalBalls > 0)

  let highestScore: PersonalBestsDto['highestScore'] = null
  for (const m of batted) {
    const r = m.batting.runs
    const b = m.batting.balls
    const no = m.batting.notOut
    const sr = m.batting.strikeRate || (b > 0 ? round2((r * 100) / b) : 0)
    if (
      !highestScore ||
      r > highestScore.runs ||
      (r === highestScore.runs && no && !highestScore.notOut) ||
      (r === highestScore.runs && no === highestScore.notOut && b < highestScore.balls)
    ) {
      highestScore = { ...matchRef(m), runs: r, balls: b, notOut: no, strikeRate: sr }
    }
  }

  let bestBowling: PersonalBestsDto['bestBowling'] = null
  let mostWicketsInMatch: PersonalBestsDto['mostWicketsInMatch'] = null
  for (const m of bowled) {
    const w = m.bowling.wickets
    const rc = m.bowling.runsConceded
    if (
      !bestBowling ||
      w > bestBowling.wickets ||
      (w === bestBowling.wickets && rc < bestBowling.runsConceded)
    ) {
      bestBowling = {
        ...matchRef(m),
        wickets: w,
        runsConceded: rc,
        overs: m.bowling.overs,
        economy: m.bowling.economy,
        display: `${w}/${rc}`,
      }
      mostWicketsInMatch = {
        ...matchRef(m),
        wickets: w,
        runsConceded: rc,
        overs: m.bowling.overs,
      }
    }
  }

  let mostSixesInMatch: PersonalBestsDto['mostSixesInMatch'] = null
  let mostFoursInMatch: PersonalBestsDto['mostFoursInMatch'] = null
  for (const m of batted) {
    const { sixes, fours, runs, balls } = m.batting
    if (
      !mostSixesInMatch ||
      sixes > mostSixesInMatch.sixes ||
      (sixes === mostSixesInMatch.sixes && runs > mostSixesInMatch.runs)
    ) {
      mostSixesInMatch = { ...matchRef(m), sixes, runs, balls }
    }
    if (
      !mostFoursInMatch ||
      fours > mostFoursInMatch.fours ||
      (fours === mostFoursInMatch.fours && runs > mostFoursInMatch.runs)
    ) {
      mostFoursInMatch = { ...matchRef(m), fours, runs, balls }
    }
  }

  const eligibleSrMatches =
    batted.length >= STRIKE_RATE_MIN_INNINGS
      ? batted.filter((m) => m.batting.balls >= STRIKE_RATE_MIN_BALLS)
      : []

  let bestStrikeRate: PersonalBestsDto['bestStrikeRate'] = null
  for (const m of eligibleSrMatches) {
    const sr = m.batting.balls > 0 ? round2((m.batting.runs * 100) / m.batting.balls) : 0
    if (
      !bestStrikeRate ||
      sr > bestStrikeRate.strikeRate ||
      (sr === bestStrikeRate.strikeRate && m.batting.runs > bestStrikeRate.runs)
    ) {
      bestStrikeRate = {
        ...matchRef(m),
        strikeRate: sr,
        runs: m.batting.runs,
        balls: m.batting.balls,
        notOut: m.batting.notOut,
      }
    }
  }

  return {
    highestScore,
    bestBowling,
    mostSixesInMatch,
    mostFoursInMatch,
    bestStrikeRate,
    bestStrikeRateQualified: bestStrikeRate !== null,
    bestStrikeRateCriteria: STRIKE_RATE_CRITERIA,
    mostWicketsInMatch,
  }
}

/**
 * Unlock achievements strictly backed by earned verified stats, awards, and tournament wins.
 * Never returns locked or placeholder entries.
 */
export function computeEarnedAchievements(params: {
  matchHistoryDesc: DashboardMatchHistoryEntry[]
  career: Pick<IPlayerCareerStat, 'runs' | 'wickets' | 'playerOfMatchAwards'> | null
  awards: Pick<IAward, '_id' | 'awardType' | 'scope' | 'awardedAt' | 'tournamentId' | 'seasonId'>[]
  tournaments: Pick<ITournament, '_id' | 'name' | 'shortName' | 'seasonId' | 'status' | 'winnerTeamId' | 'endDate'>[]
  memberships: Pick<ITeamMembership, 'teamId' | 'seasonId' | 'status'>[]
  seasonMap: Map<string, Pick<ISeason, '_id' | 'name' | 'year'>>
}): PlayerAchievementDto[] {
  const { matchHistoryDesc, career, awards, tournaments, memberships, seasonMap } = params
  const chronological = [...matchHistoryDesc].reverse()
  const out: PlayerAchievementDto[] = []

  const firstFifty = chronological.find((m) => m.batting.innings > 0 && m.batting.runs >= 50)
  if (firstFifty) {
    out.push({
      id: 'first-fifty',
      key: 'FIRST_FIFTY',
      title: 'First Fifty',
      subtitle: `${firstFifty.batting.runs}${firstFifty.batting.notOut ? '*' : ''} (${firstFifty.batting.balls}b) vs ${formatOpponentLabel(firstFifty)}`,
      category: 'BATTING',
      achievedAt: firstFifty.matchDate,
    })
  }

  const firstHundred = chronological.find((m) => m.batting.innings > 0 && m.batting.runs >= 100)
  if (firstHundred) {
    out.push({
      id: 'first-hundred',
      key: 'FIRST_HUNDRED',
      title: 'First Hundred',
      subtitle: `${firstHundred.batting.runs}${firstHundred.batting.notOut ? '*' : ''} (${firstHundred.batting.balls}b) vs ${formatOpponentLabel(firstHundred)}`,
      category: 'BATTING',
      achievedAt: firstHundred.matchDate,
    })
  }

  const firstFiveWicket = chronological.find(
    (m) => m.bowling.wickets >= 5 || m.bowling.bestFiguresWickets >= 5
  )
  if (firstFiveWicket) {
    out.push({
      id: 'first-five-wickets',
      key: 'FIRST_FIVE_WICKET_HAUL',
      title: 'First Five-Wicket Haul',
      subtitle: `${firstFiveWicket.bowling.wickets}/${firstFiveWicket.bowling.runsConceded} vs ${formatOpponentLabel(firstFiveWicket)}`,
      category: 'BOWLING',
      achievedAt: firstFiveWicket.matchDate,
    })
  }

  let runningRuns = 0
  let hundredRunsMatch: DashboardMatchHistoryEntry | null = null
  let runningWickets = 0
  let fiftyWicketsMatch: DashboardMatchHistoryEntry | null = null

  for (const m of chronological) {
    runningRuns += m.batting.runs
    if (!hundredRunsMatch && runningRuns >= 100) {
      hundredRunsMatch = m
    }
    runningWickets += m.bowling.wickets
    if (!fiftyWicketsMatch && runningWickets >= 50) {
      fiftyWicketsMatch = m
    }
  }

  if (hundredRunsMatch || (career?.runs ?? 0) >= 100) {
    out.push({
      id: '100-career-runs',
      key: 'CAREER_100_RUNS',
      title: '100 Career Runs',
      subtitle: hundredRunsMatch
        ? `Crossed 100 runs vs ${formatOpponentLabel(hundredRunsMatch)}`
        : `${career?.runs ?? 100} lifetime runs`,
      category: 'CAREER',
      achievedAt: hundredRunsMatch?.matchDate ?? null,
    })
  }

  if (fiftyWicketsMatch || (career?.wickets ?? 0) >= 50) {
    out.push({
      id: '50-career-wickets',
      key: 'CAREER_50_WICKETS',
      title: '50 Career Wickets',
      subtitle: fiftyWicketsMatch
        ? `Crossed 50 wickets vs ${formatOpponentLabel(fiftyWicketsMatch)}`
        : `${career?.wickets ?? 50} lifetime wickets`,
      category: 'CAREER',
      achievedAt: fiftyWicketsMatch?.matchDate ?? null,
    })
  }

  const pomMatches = matchHistoryDesc.filter((m) => m.isPlayerOfMatch)
  const pomAwards = awards.filter((a) => a.awardType === 'PLAYER_OF_MATCH')
  const pomCount = Math.max(pomMatches.length, pomAwards.length, career?.playerOfMatchAwards ?? 0)
  if (pomCount > 0) {
    const latestPom = pomMatches[0]
    const subtitle =
      pomCount > 1
        ? latestPom
          ? `${pomCount} awards · Latest vs ${formatOpponentLabel(latestPom)}`
          : `${pomCount} Player of the Match honors`
        : latestPom
          ? `Match star vs ${formatOpponentLabel(latestPom)}`
          : 'Awarded Player of the Match'
    out.push({
      id: 'player-of-match',
      key: 'PLAYER_OF_MATCH',
      title: 'Player of the Match',
      subtitle,
      category: 'MATCH',
      achievedAt: latestPom?.matchDate ?? pomAwards[0]?.awardedAt ?? null,
      count: pomCount,
    })
  }

  // Tournament Winner: completed tournament whose winnerTeamId matches player's verified match participation
  // or non-released/non-transferred membership for that season & team.
  const activeOrCompletedMemKeys = new Set(
    memberships
      .filter((m) => m.status === 'ACTIVE' || m.status === 'COMPLETED')
      .map((m) => `${m.seasonId}::${m.teamId}`)
  )
  const wonTournaments = tournaments.filter((tr) => {
    if (tr.status !== 'COMPLETED' || !tr.winnerTeamId) return false
    const playedForWinner = matchHistoryDesc.some(
      (m) => m.tournamentId === tr._id && m.teamId === tr.winnerTeamId
    )
    const memberOfWinner = activeOrCompletedMemKeys.has(`${tr.seasonId}::${tr.winnerTeamId}`)
    return playedForWinner || memberOfWinner
  })

  if (wonTournaments.length > 0) {
    const sortedWins = [...wonTournaments].sort(
      (a, b) =>
        new Date(b.endDate ?? 0).getTime() - new Date(a.endDate ?? 0).getTime()
    )
    const names = sortedWins.map((t) => t.shortName || t.name)
    out.push({
      id: 'tournament-winner',
      key: 'TOURNAMENT_WINNER',
      title: 'Tournament Winner',
      subtitle:
        names.length === 1
          ? `${sortedWins[0].name} Champion`
          : `${names.length} titles · ${names.slice(0, 2).join(', ')}`,
      category: 'TOURNAMENT',
      achievedAt: sortedWins[0].endDate ?? null,
      count: wonTournaments.length,
    })
  }

  // Persisted major tournament/season honors (other than POM already summarized)
  const awardLabels: Record<string, string> = {
    PLAYER_OF_TOURNAMENT: 'Player of the Tournament',
    BEST_BATTER: 'Best Batter Award',
    BEST_BOWLER: 'Best Bowler Award',
    BEST_FIELDER: 'Best Fielder Award',
  }
  const tournamentById = new Map(tournaments.map((t) => [t._id, t]))
  for (const aw of awards) {
    if (aw.awardType === 'PLAYER_OF_MATCH') continue
    const title = awardLabels[aw.awardType]
    if (!title) continue
    const tr = aw.tournamentId ? tournamentById.get(aw.tournamentId) : null
    const sn = aw.seasonId ? seasonMap.get(aw.seasonId) : null
    out.push({
      id: `award-${aw._id}`,
      key: aw.awardType,
      title,
      subtitle: tr?.name || sn?.name || 'Official Tournament Honor',
      category: 'TOURNAMENT',
      achievedAt: aw.awardedAt ?? null,
    })
  }

  return out.sort((a, b) => {
    const ta = a.achievedAt ? new Date(a.achievedAt).getTime() : 0
    const tb = b.achievedAt ? new Date(b.achievedAt).getTime() : 0
    return tb - ta
  })
}

/**
 * Enrich chronological match series with unique X-axis keys & bowling/result context
 * while preserving every existing chart property expected by Performance Graphs.
 */
export function enrichPerformanceSeries(chronological: DashboardMatchHistoryEntry[]): EnrichedPerformancePoint[] {
  let cumRuns = 0
  let cumBalls = 0
  let cumDismissals = 0

  return chronological.map((m, idx) => {
    cumRuns += m.batting.runs
    cumBalls += m.batting.balls
    if (m.batting.innings > 0 && !m.batting.notOut) {
      cumDismissals += 1
    }
    const opponentShortName = m.opponent?.shortName || 'OPP'
    return {
      matchIndex: idx + 1,
      matchKey: `#${idx + 1} · ${opponentShortName}`,
      matchId: m.matchId,
      label: `vs ${opponentShortName}`,
      opponentName: m.opponent?.name || opponentShortName,
      opponentShortName,
      date: m.matchDate,
      runs: m.batting.runs,
      balls: m.batting.balls,
      batted: m.batting.innings > 0,
      notOut: m.batting.notOut,
      wickets: m.bowling.wickets,
      runsConceded: m.bowling.runsConceded,
      bowled: m.bowling.innings > 0 || m.bowling.legalBalls > 0,
      overs: m.bowling.overs,
      economy: m.bowling.economy,
      result: m.result,
      cumulativeAverage: cumDismissals > 0 ? Number((cumRuns / cumDismissals).toFixed(2)) : cumRuns,
      cumulativeStrikeRate: cumBalls > 0 ? Number(((cumRuns * 100) / cumBalls).toFixed(2)) : 0,
    }
  })
}

/**
 * Aggregate verified match records by season ascending so team transfers within
 * a season combine cleanly under that season.
 */
export function computeSeasonPerformance(
  matchHistoryDesc: DashboardMatchHistoryEntry[],
  seasonMap: Map<string, Pick<ISeason, '_id' | 'name' | 'year'>>
): SeasonPerformancePoint[] {
  const buckets = new Map<
    string,
    {
      seasonId: string
      seasonName: string
      year: number
      matches: number
      inningsBatted: number
      dismissals: number
      runs: number
      balls: number
      inningsBowled: number
      wickets: number
      legalBalls: number
      runsConceded: number
      teams: Set<string>
    }
  >()

  for (const m of matchHistoryDesc) {
    const sid = m.seasonId || '__unassigned__'
    const s = m.seasonId ? seasonMap.get(m.seasonId) : null
    const seasonName = s?.name || m.season?.name || 'Other Matches'
    const year = s?.year ?? m.season?.year ?? 0

    let b = buckets.get(sid)
    if (!b) {
      b = {
        seasonId: sid,
        seasonName,
        year,
        matches: 0,
        inningsBatted: 0,
        dismissals: 0,
        runs: 0,
        balls: 0,
        inningsBowled: 0,
        wickets: 0,
        legalBalls: 0,
        runsConceded: 0,
        teams: new Set<string>(),
      }
      buckets.set(sid, b)
    }

    b.matches += 1
    if (m.batting.innings > 0) {
      b.inningsBatted += 1
      b.runs += m.batting.runs
      b.balls += m.batting.balls
      if (!m.batting.notOut) b.dismissals += 1
    }
    if (m.bowling.innings > 0 || m.bowling.legalBalls > 0) {
      b.inningsBowled += 1
      b.wickets += m.bowling.wickets
      b.legalBalls += m.bowling.legalBalls
      b.runsConceded += m.bowling.runsConceded
    }
    if (m.team?.shortName) {
      b.teams.add(m.team.shortName)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.year - b.year || a.seasonName.localeCompare(b.seasonName))
    .map((b) => ({
      seasonId: b.seasonId,
      seasonName: b.seasonName,
      label: b.year > 0 && !b.seasonName.includes(String(b.year)) ? `${b.seasonName} (${b.year})` : b.seasonName,
      year: b.year,
      matches: b.matches,
      inningsBatted: b.inningsBatted,
      runs: b.runs,
      balls: b.balls,
      inningsBowled: b.inningsBowled,
      wickets: b.wickets,
      legalBalls: b.legalBalls,
      overs: oversStr(b.legalBalls),
      runsConceded: b.runsConceded,
      battingAverage:
        b.dismissals > 0 ? round2(b.runs / b.dismissals) : b.inningsBatted > 0 ? b.runs : null,
      strikeRate: b.balls > 0 ? round2((b.runs * 100) / b.balls) : 0,
      economy: b.legalBalls > 0 ? round2((b.runsConceded * 6) / b.legalBalls) : 0,
      teams: [...b.teams],
    }))
}

const LIVE_STATUS_PRIORITY: Record<string, number> = {
  LIVE: 0,
  INNINGS_BREAK: 1,
  PAUSED: 2,
  TOSS_DONE: 3,
  SCHEDULED: 4,
}

/**
 * Resolve upcoming/active fixtures linked to the player's active tournament/season
 * registration, strictly excluding completed tournaments and matches where the
 * player is explicitly marked ABSENT.
 */
export function resolveUpcomingMatchesForPlayer(params: {
  player: Pick<IPlayer, '_id' | 'teamId'>
  memberships: Pick<ITeamMembership, 'teamId' | 'seasonId' | 'status'>[]
  seasonMap: Map<string, Pick<ISeason, '_id' | 'name' | 'year' | 'status'>>
  tournamentMap: Map<string, Pick<ITournament, '_id' | 'name' | 'shortName' | 'seasonId' | 'status'>>
  teamMap: Map<string, Pick<ITeam, '_id' | 'name' | 'shortName' | 'color' | 'logoUrl'>>
  activeMatches: Pick<
    IMatch,
    '_id' | 'format' | 'status' | 'venue' | 'matchDate' | 'teamAId' | 'teamBId' | 'seasonId' | 'tournamentId' | 'playerStatuses'
  >[]
}): UpcomingPlayerMatchDto[] {
  const { player, memberships, seasonMap, tournamentMap, teamMap, activeMatches } = params

  const seasonsWithAnyMembership = new Set(memberships.map((m) => m.seasonId))
  const registeredTeamBySeason = new Map<string, string>()

  for (const m of memberships) {
    const s = seasonMap.get(m.seasonId)
    if (m.status === 'ACTIVE' && s && s.status !== 'COMPLETED') {
      registeredTeamBySeason.set(m.seasonId, m.teamId)
    }
  }

  // Fallback ONLY for active seasons with zero membership history if player.teamId is assigned
  if (player.teamId) {
    for (const s of seasonMap.values()) {
      if (s.status === 'ACTIVE' && !seasonsWithAnyMembership.has(s._id) && !registeredTeamBySeason.has(s._id)) {
        registeredTeamBySeason.set(s._id, player.teamId)
      }
    }
  }

  if (registeredTeamBySeason.size === 0) {
    return []
  }

  const upcoming: UpcomingPlayerMatchDto[] = []

  for (const match of activeMatches) {
    if (!match.tournamentId) continue
    const tr = tournamentMap.get(match.tournamentId)
    if (!tr || tr.status === 'COMPLETED') continue

    const effectiveSeasonId = match.seasonId ?? tr.seasonId
    const registeredTeamId = registeredTeamBySeason.get(effectiveSeasonId)
    if (!registeredTeamId) continue

    const isTeamA = match.teamAId === registeredTeamId
    const isTeamB = match.teamBId === registeredTeamId
    if (!isTeamA && !isTeamB) continue

    const isMarkedAbsent = (match.playerStatuses ?? []).some(
      (ps) => ps.playerId === player._id && ps.status === 'ABSENT'
    )
    if (isMarkedAbsent) continue

    const oppId = isTeamA ? match.teamBId : match.teamAId
    const pTeam = teamMap.get(registeredTeamId)
    const opp = teamMap.get(oppId)
    const s = seasonMap.get(effectiveSeasonId)

    upcoming.push({
      id: match._id,
      matchId: match._id,
      format: match.format,
      status: match.status,
      venue: match.venue ?? null,
      matchDate: match.matchDate ?? null,
      tournament: {
        id: tr._id,
        name: tr.name,
        shortName: tr.shortName,
      },
      season: s ? { id: s._id, name: s.name, year: s.year } : null,
      playerTeam: pTeam
        ? {
            id: pTeam._id,
            name: pTeam.name,
            shortName: pTeam.shortName,
            color: pTeam.color,
            logoUrl: pTeam.logoUrl ?? null,
          }
        : null,
      opponent: opp
        ? {
            id: opp._id,
            name: opp.name,
            shortName: opp.shortName,
            color: opp.color,
            logoUrl: opp.logoUrl ?? null,
          }
        : null,
    })
  }

  return upcoming.sort((a, b) => {
    const pa = LIVE_STATUS_PRIORITY[a.status] ?? 9
    const pb = LIVE_STATUS_PRIORITY[b.status] ?? 9
    if (pa !== pb) return pa - pb
    const ta = a.matchDate ? new Date(a.matchDate).getTime() : Number.MAX_SAFE_INTEGER
    const tb = b.matchDate ? new Date(b.matchDate).getTime() : Number.MAX_SAFE_INTEGER
    return ta - tb
  })
}

