import {
  CaptaincyAssignment,
  CaptaincyAuditLog,
  Match,
  Player,
  PlayerMatchStat,
  Season,
  Team,
  TeamMembership,
  Tournament,
} from './db'

export interface EnrichedCaptaincyStatus {
  isCaptain: boolean
  assignmentId?: string
  playerId?: string
  teamId?: string
  seasonId?: string
  assignedAt?: string
  team?: {
    id: string
    name: string
    shortName: string
    color: string
    logoUrl?: string | null
  } | null
  season?: {
    id: string
    name: string
    code: string
    year: number
    status: string
  } | null
}

export interface CaptaincyHistoryItem {
  id: string
  assignmentId: string
  seasonId: string
  seasonName: string
  seasonYear: number
  seasonStatus: string
  teamId: string
  teamName: string
  teamShortName: string
  teamColor: string
  teamLogoUrl: string | null
  assignedAt: string
  endedAt: string | null
  status: 'active' | 'completed' | 'revoked'
  matchesCaptained: number
  matchesWon: number
  matchesLost: number
  matchesTied: number
  winPercentage: number
  tournamentsWon: number
  tournamentNamesWon: string[]
  achievementLabel?: string | null
}

export interface CaptainBadgeDto {
  id: string
  key:
    | 'CURRENT_CAPTAIN'
    | 'FORMER_CAPTAIN'
    | 'WINNING_CAPTAIN'
    | 'CHAMPIONSHIP_WINNING_CAPTAIN'
    | 'MULTIPLE_TIME_CAPTAIN'
  title: string
  subtitle: string
  achievedAt: string | null
}

export interface TeamPerformanceStatsDto {
  teamId: string
  seasonId: string
  matchesPlayed: number
  matchesWon: number
  matchesLost: number
  matchesTied: number
  winPercentage: number
  totalRunsScored: number
  totalWicketsTaken: number
  highestTeamScore: {
    runs: number
    wickets: number
    overs: string
    opponentName: string | null
  } | null
  topRunScorer: {
    playerId: string
    playerName: string
    runs: number
    innings: number
  } | null
  topWicketTaker: {
    playerId: string
    playerName: string
    wickets: number
    runsConceded: number
  } | null
}

/**
 * Resolve whether a player currently holds an active captaincy.
 * Automatically completes the assignment if the associated season has ended.
 */
export async function getActiveCaptaincy(
  playerId: string
): Promise<EnrichedCaptaincyStatus> {
  const assignment = await CaptaincyAssignment.findOne({
    playerId,
    status: 'active',
  }).lean()

  if (!assignment) {
    return { isCaptain: false }
  }

  const [season, team] = await Promise.all([
    Season.findById(assignment.seasonId).lean(),
    Team.findById(assignment.teamId).lean(),
  ])

  // If the season has officially completed, the captaincy automatically expires
  if (season?.status === 'COMPLETED') {
    await CaptaincyAssignment.updateOne(
      { _id: assignment._id, status: 'active' },
      { $set: { status: 'completed', endedAt: new Date() } }
    )
    await CaptaincyAuditLog.create({
      assignmentId: assignment._id,
      action: 'AUTO_EXPIRE',
      seasonId: assignment.seasonId,
      teamId: assignment.teamId,
      previousCaptainId: playerId,
      newCaptainId: null,
      performedBy: 'SYSTEM',
      performedAt: new Date(),
      reason: `Season ${season.name} completed`,
    })
    return { isCaptain: false }
  }

  return {
    isCaptain: true,
    assignmentId: assignment._id,
    playerId: assignment.playerId,
    teamId: assignment.teamId,
    seasonId: assignment.seasonId,
    assignedAt: assignment.assignedAt.toISOString(),
    team: team
      ? {
          id: team._id,
          name: team.name,
          shortName: team.shortName,
          color: team.color,
          logoUrl: team.logoUrl ?? null,
        }
      : null,
    season: season
      ? {
          id: season._id,
          name: season.name,
          code: season.code,
          year: season.year,
          status: season.status,
        }
      : null,
  }
}

/**
 * Retrieve permanent historical captaincy records for a player,
 * including verified match and tournament records while captain.
 */
export async function getPlayerCaptaincyHistory(
  playerId: string
): Promise<CaptaincyHistoryItem[]> {
  const assignments = await CaptaincyAssignment.find({ playerId })
    .sort({ assignedAt: -1 })
    .lean()

  if (assignments.length === 0) return []

  const seasonIds = Array.from(new Set(assignments.map((a) => a.seasonId)))
  const teamIds = Array.from(new Set(assignments.map((a) => a.teamId)))

  const [seasons, teams, tournaments, verifiedStats] = await Promise.all([
    Season.find({ _id: { $in: seasonIds } }).lean(),
    Team.find({ _id: { $in: teamIds } }).lean(),
    Tournament.find({ seasonId: { $in: seasonIds } }).lean(),
    PlayerMatchStat.find({
      playerId,
      played: true,
      seasonId: { $in: seasonIds },
    }).lean(),
  ])

  const seasonMap = new Map(seasons.map((s) => [s._id, s]))
  const teamMap = new Map(teams.map((t) => [t._id, t]))

  // Group tournaments by season and winning team
  const wonTournamentsBySeasonTeam = new Map<string, typeof tournaments>()
  for (const tr of tournaments) {
    if (tr.status === 'COMPLETED' && tr.winnerTeamId) {
      const key = `${tr.seasonId}::${tr.winnerTeamId}`
      const arr = wonTournamentsBySeasonTeam.get(key) ?? []
      arr.push(tr)
      wonTournamentsBySeasonTeam.set(key, arr)
    }
  }

  const results: CaptaincyHistoryItem[] = []

  for (const a of assignments) {
    const s = seasonMap.get(a.seasonId)
    const t = teamMap.get(a.teamId)
    const startDate = a.assignedAt
    const endDate = a.endedAt ? new Date(a.endedAt) : null

    // Matches captained: matches where player played for this team & season
    // during the active tenure of this assignment
    const matchesUnderTenure = verifiedStats.filter((m) => {
      if (m.teamId !== a.teamId || m.seasonId !== a.seasonId) return false
      const mDate = new Date(m.matchDate)
      if (mDate < startDate) return false
      if (endDate && mDate > endDate) return false
      return true
    })

    const matchesCaptained = matchesUnderTenure.length
    const matchesWon = matchesUnderTenure.filter((m) => m.result === 'WON').length
    const matchesLost = matchesUnderTenure.filter((m) => m.result === 'LOST').length
    const matchesTied = matchesUnderTenure.filter(
      (m) => m.result === 'TIED' || m.result === 'NO_RESULT'
    ).length

    const winPercentage =
      matchesCaptained > 0
        ? Math.round((matchesWon / matchesCaptained) * 1000) / 10
        : 0

    const wonTrList =
      wonTournamentsBySeasonTeam.get(`${a.seasonId}::${a.teamId}`) ?? []
    const tournamentsWon = wonTrList.length
    const tournamentNamesWon = wonTrList.map((tr) => tr.shortName || tr.name)

    let achievementLabel: string | null = null
    if (tournamentsWon > 0) {
      achievementLabel =
        tournamentsWon === 1
          ? `${wonTrList[0].name} Champion Captain`
          : `${tournamentsWon}x Championship Captain`
    }

    results.push({
      id: a._id,
      assignmentId: a._id,
      seasonId: a.seasonId,
      seasonName: s?.name ?? 'Unknown Season',
      seasonYear: s?.year ?? 0,
      seasonStatus: s?.status ?? 'UNKNOWN',
      teamId: a.teamId,
      teamName: t?.name ?? 'Unknown Team',
      teamShortName: t?.shortName ?? 'NPL',
      teamColor: t?.color ?? '#7A1426',
      teamLogoUrl: t?.logoUrl ?? null,
      assignedAt: a.assignedAt.toISOString(),
      endedAt: a.endedAt ? a.endedAt.toISOString() : null,
      status: a.status,
      matchesCaptained,
      matchesWon,
      matchesLost,
      matchesTied,
      winPercentage,
      tournamentsWon,
      tournamentNamesWon,
      achievementLabel,
    })
  }

  return results
}

/**
 * Compute official captaincy badges based on verified season and tournament records.
 */
export async function computeCaptainBadges(
  playerId: string
): Promise<CaptainBadgeDto[]> {
  const history = await getPlayerCaptaincyHistory(playerId)
  if (history.length === 0) return []

  const badges: CaptainBadgeDto[] = []

  const activeAssignment = history.find((h) => h.status === 'active')
  if (activeAssignment) {
    badges.push({
      id: 'current-captain',
      key: 'CURRENT_CAPTAIN',
      title: 'Current Captain',
      subtitle: `${activeAssignment.teamName} • ${activeAssignment.seasonName}`,
      achievedAt: activeAssignment.assignedAt,
    })
  }

  const pastAssignments = history.filter((h) => h.status !== 'active')
  if (pastAssignments.length > 0) {
    const latestPast = pastAssignments[0]
    badges.push({
      id: 'former-captain',
      key: 'FORMER_CAPTAIN',
      title: 'Former Captain',
      subtitle: `${pastAssignments.length} past captaincy ${pastAssignments.length === 1 ? 'tenure' : 'tenures'}`,
      achievedAt: latestPast.endedAt ?? latestPast.assignedAt,
    })
  }

  // Championship-winning captain: team won a completed tournament in that season
  const titleWins = history.filter((h) => h.tournamentsWon > 0)
  if (titleWins.length > 0) {
    const totalTitles = titleWins.reduce((acc, h) => acc + h.tournamentsWon, 0)
    const latestWin = titleWins[0]
    badges.push({
      id: 'championship-winning-captain',
      key: 'CHAMPIONSHIP_WINNING_CAPTAIN',
      title: 'Championship-Winning Captain',
      subtitle:
        totalTitles === 1
          ? `${latestWin.tournamentNamesWon[0] ?? latestWin.teamName} Champion`
          : `${totalTitles} titles with ${latestWin.teamName}`,
      achievedAt: latestWin.assignedAt,
    })
  }

  // Multiple-Time Captain: captained in multiple distinct seasons
  const distinctSeasons = new Set(history.map((h) => h.seasonId))
  if (distinctSeasons.size >= 2) {
    badges.push({
      id: 'multiple-time-captain',
      key: 'MULTIPLE_TIME_CAPTAIN',
      title: 'Multiple-Time Captain',
      subtitle: `Appointed captain across ${distinctSeasons.size} seasons`,
      achievedAt: history[0]?.assignedAt ?? null,
    })
  }

  return badges
}

/**
 * Calculate team performance metrics for the captain's team and active season
 * exclusively from verified finalized scorecards.
 */
export async function getTeamPerformanceStats(
  teamId: string,
  seasonId: string
): Promise<TeamPerformanceStatsDto> {
  const matches = await Match.find({
    seasonId,
    $or: [{ teamAId: teamId }, { teamBId: teamId }],
    status: 'COMPLETED',
  }).lean()

  const matchIds = matches.map((m) => m._id)

  const [matchStats, players, teams] = await Promise.all([
    PlayerMatchStat.find({
      matchId: { $in: matchIds },
      teamId,
      played: true,
    }).lean(),
    Player.find({}).select({ _id: 1, name: 1 }).lean(),
    Team.find({}).select({ _id: 1, name: 1 }).lean(),
  ])

  const playerMap = new Map(players.map((p) => [p._id, p.name]))
  const teamMap = new Map(teams.map((t) => [t._id, t.name]))

  let matchesWon = 0
  let matchesLost = 0
  let matchesTied = 0

  for (const m of matches) {
    if (m.winnerId === teamId) {
      matchesWon++
    } else if (m.winnerId) {
      matchesLost++
    } else {
      matchesTied++
    }
  }

  const matchesPlayed = matches.length
  const winPercentage =
    matchesPlayed > 0
      ? Math.round((matchesWon / matchesPlayed) * 1000) / 10
      : 0

  let totalRunsScored = 0
  let totalWicketsTaken = 0

  // Per-player aggregation
  const batterRuns = new Map<string, { runs: number; innings: number }>()
  const bowlerWickets = new Map<string, { wickets: number; runsConceded: number }>()

  // Per-match team score calculation
  const matchRunsMap = new Map<string, number>()

  for (const stat of matchStats) {
    totalRunsScored += stat.batting.runs
    totalWicketsTaken += stat.bowling.wickets

    // Tally runs per match for highest team score
    matchRunsMap.set(
      stat.matchId,
      (matchRunsMap.get(stat.matchId) ?? 0) + stat.batting.runs
    )

    if (stat.batting.innings > 0) {
      const prev = batterRuns.get(stat.playerId) ?? { runs: 0, innings: 0 }
      batterRuns.set(stat.playerId, {
        runs: prev.runs + stat.batting.runs,
        innings: prev.innings + 1,
      })
    }

    if (stat.bowling.innings > 0) {
      const prev = bowlerWickets.get(stat.playerId) ?? {
        wickets: 0,
        runsConceded: 0,
      }
      bowlerWickets.set(stat.playerId, {
        wickets: prev.wickets + stat.bowling.wickets,
        runsConceded: prev.runsConceded + stat.bowling.runsConceded,
      })
    }
  }

  // Highest team score
  let highestScoreRuns = 0
  let highestMatchId: string | null = null
  for (const [mId, runs] of matchRunsMap.entries()) {
    if (runs > highestScoreRuns) {
      highestScoreRuns = runs
      highestMatchId = mId
    }
  }

  let highestTeamScore: TeamPerformanceStatsDto['highestTeamScore'] = null
  if (highestMatchId) {
    const topMatch = matches.find((m) => m._id === highestMatchId)
    const oppId =
      topMatch?.teamAId === teamId ? topMatch?.teamBId : topMatch?.teamAId
    highestTeamScore = {
      runs: highestScoreRuns,
      wickets: 0, // aggregate team runs
      overs: `${topMatch?.totalOvers ?? 20}.0`,
      opponentName: oppId ? teamMap.get(oppId) ?? null : null,
    }
  }

  // Top run scorer
  let topRunScorer: TeamPerformanceStatsDto['topRunScorer'] = null
  let maxRuns = -1
  for (const [pId, info] of batterRuns.entries()) {
    if (info.runs > maxRuns) {
      maxRuns = info.runs
      topRunScorer = {
        playerId: pId,
        playerName: playerMap.get(pId) ?? 'Player',
        runs: info.runs,
        innings: info.innings,
      }
    }
  }

  // Top wicket taker
  let topWicketTaker: TeamPerformanceStatsDto['topWicketTaker'] = null
  let maxWickets = -1
  for (const [pId, info] of bowlerWickets.entries()) {
    if (info.wickets > maxWickets) {
      maxWickets = info.wickets
      topWicketTaker = {
        playerId: pId,
        playerName: playerMap.get(pId) ?? 'Player',
        wickets: info.wickets,
        runsConceded: info.runsConceded,
      }
    }
  }

  return {
    teamId,
    seasonId,
    matchesPlayed,
    matchesWon,
    matchesLost,
    matchesTied,
    winPercentage,
    totalRunsScored,
    totalWicketsTaken,
    highestTeamScore,
    topRunScorer,
    topWicketTaker,
  }
}

