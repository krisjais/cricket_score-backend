import { Router } from 'express'
import { Award, db, Innings, Match, Player, PlayerMatchStat } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import { ensureDefaultSeasonAndTournament } from '../lib/bootstrap'
import {
  correctMatchAndRecalculate,
  finalizeMatchScorecard,
  rebuildCareerStatsForPlayers,
  verifyMatchAndSyncStats,
} from '../lib/stats-service'
import {
  buildMatchPayload,
  emitMatchUpdate,
  setToss,
  startMatch,
  startInnings2,
  recordBall,
  applyAction,
  undoLastBall,
  MatchError,
  MatchAction,
} from '../lib/match-service'
import { buildMatchSummaries } from '../lib/match-state'
import { emitToRoom } from '../lib/broadcast'
import { FORMAT_OVERS } from '../lib/cricket'

const router = Router()

const ACTIONS: MatchAction[] = [
  'NEW_BATSMAN',
  'NEW_BOWLER',
  'SWAP_STRIKE',
  'PAUSE',
  'RESUME',
  'END_INNINGS',
  'ABANDON',
]

function cleanUmpire(val: any): { name: string; teamId: string | null; teamName: string | null; playerId: string | null } | null {
  if (!val || typeof val !== 'object') return null
  const name = typeof val.name === 'string' ? val.name.trim() : ''
  if (!name) return null
  return {
    name,
    teamId: typeof val.teamId === 'string' && val.teamId.trim() ? val.teamId.trim() : null,
    teamName: typeof val.teamName === 'string' && val.teamName.trim() ? val.teamName.trim() : null,
    playerId: typeof val.playerId === 'string' && val.playerId.trim() ? val.playerId.trim() : null,
  }
}

async function validateUmpires(
  mainUmpire: ReturnType<typeof cleanUmpire>,
  legUmpire: ReturnType<typeof cleanUmpire>,
  teamAId: string,
  teamBId: string,
  currentMatchId?: string
): Promise<string | null> {
  if (mainUmpire?.teamId) {
    if (mainUmpire.teamId === teamAId || mainUmpire.teamId === teamBId) {
      return 'Main Umpire cannot be from either of the playing teams'
    }
  }
  if (legUmpire?.teamId) {
    if (legUmpire.teamId === teamAId || legUmpire.teamId === teamBId) {
      return 'Leg Umpire cannot be from either of the playing teams'
    }
  }
  if (mainUmpire?.teamId && legUmpire?.teamId && mainUmpire.teamId === legUmpire.teamId) {
    return 'Main Umpire and Leg Umpire must be selected from two different teams'
  }

  // Check if either umpire belongs to a team currently playing in an active live match
  const umpireTeamIds = [mainUmpire?.teamId, legUmpire?.teamId].filter(Boolean) as string[]
  if (umpireTeamIds.length > 0) {
    const liveMatches = await db.match.findMany({
      where: {
        status: { in: ['LIVE', 'PAUSED'] },
      },
    })
    const liveTeamIds = new Set<string>()
    for (const lm of liveMatches) {
      if (lm.id !== currentMatchId) {
        liveTeamIds.add(lm.teamAId)
        liveTeamIds.add(lm.teamBId)
      }
    }

    if (mainUmpire?.teamId && liveTeamIds.has(mainUmpire.teamId)) {
      return `Main Umpire belongs to a team (${mainUmpire.teamName || 'team'}) currently playing in an active live match`
    }
    if (legUmpire?.teamId && liveTeamIds.has(legUmpire.teamId)) {
      return `Leg Umpire belongs to a team (${legUmpire.teamName || 'team'}) currently playing in an active live match`
    }
  }

  return null
}

// GET /api/matches - List all matches
router.get('/', async (req, res) => {
  try {
    const status = req.query.status as string | undefined
    let summaries = await buildMatchSummaries()
    if (status && status !== 'ALL') {
      summaries = summaries.filter((m) => m.status === status)
    }
    return sendOk(res, summaries)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to list matches', 500)
  }
})

// POST /api/matches - Create a match
router.post('/', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { teamAId, teamBId, format: rawFormat, totalOvers: rawOvers, venue } = req.body ?? {}
  if (!teamAId || !teamBId) return sendFail(res, 'Both teams are required')
  if (teamAId === teamBId) return sendFail(res, 'A team cannot play against itself')

  const [a, b] = await Promise.all([
    db.team.findUnique({ where: { id: teamAId } }),
    db.team.findUnique({ where: { id: teamBId } }),
  ])
  if (!a) return sendFail(res, 'Team A not found', 404)
  if (!b) return sendFail(res, 'Team B not found', 404)

  const format = rawFormat && ['T10', 'T20', 'ODI', 'CUSTOM'].includes(rawFormat) ? rawFormat : 'CUSTOM'
  let totalOvers: number
  if (format === 'CUSTOM' || !FORMAT_OVERS[format]) {
    totalOvers = Math.floor(Number(rawOvers ?? 16))
    if (!Number.isInteger(totalOvers) || totalOvers < 1 || totalOvers > 50) {
      return sendFail(res, 'Custom overs must be between 1 and 50')
    }
  } else {
    totalOvers = FORMAT_OVERS[format]
  }

  const defaults = await ensureDefaultSeasonAndTournament()
  const seasonId = typeof req.body?.seasonId === 'string' && req.body.seasonId.trim()
    ? req.body.seasonId.trim()
    : defaults.season._id
  const tournamentId = typeof req.body?.tournamentId === 'string' && req.body.tournamentId.trim()
    ? req.body.tournamentId.trim()
    : defaults.tournament._id
  const matchDate = req.body?.matchDate ? new Date(req.body.matchDate) : new Date()
  const playingXIA = Array.isArray(req.body?.playingXIA) ? req.body.playingXIA : []
  const playingXIB = Array.isArray(req.body?.playingXIB) ? req.body.playingXIB : []

  const rawMaxOversPerBowler = req.body?.maxOversPerBowler
  let maxOversPerBowler: number | null = null
  if (rawMaxOversPerBowler !== undefined && rawMaxOversPerBowler !== null && rawMaxOversPerBowler !== '') {
    const val = Math.floor(Number(rawMaxOversPerBowler))
    if (!Number.isInteger(val) || val < 1 || val > 20) {
      return sendFail(res, 'Max overs per bowler must be between 1 and 20')
    }
    maxOversPerBowler = val
  }

  const rawMaxBowlersWithMax = req.body?.maxBowlersWithMaxOvers
  let maxBowlersWithMaxOvers: number | null = null
  if (rawMaxBowlersWithMax !== undefined && rawMaxBowlersWithMax !== null && rawMaxBowlersWithMax !== '') {
    const val = Math.floor(Number(rawMaxBowlersWithMax))
    if (!Number.isInteger(val) || val < 1 || val > 10) {
      return sendFail(res, 'Max bowlers with max overs must be between 1 and 10')
    }
    maxBowlersWithMaxOvers = val
  }

  const mainUmpire = cleanUmpire(req.body?.mainUmpire)
  const legUmpire = cleanUmpire(req.body?.legUmpire)
  const umpireErr = await validateUmpires(mainUmpire, legUmpire, teamAId, teamBId)
  if (umpireErr) return sendFail(res, umpireErr)

  const match = await db.match.create({
    data: {
      teamAId,
      teamBId,
      seasonId,
      tournamentId,
      matchDate: Number.isNaN(matchDate.getTime()) ? new Date() : matchDate,
      playingXIA,
      playingXIB,
      format,
      totalOvers,
      maxOversPerBowler,
      maxBowlersWithMaxOvers,
      mainUmpire,
      legUmpire,
      venue: typeof venue === 'string' ? venue.trim() || null : null,
      status: 'SCHEDULED',
      scorecardStatus: 'DRAFT',
    },
  })

  const summaries = await buildMatchSummaries()
  await emitToRoom('matches', 'matches:update', summaries)
  return sendOk(res, match, 201)
})

// GET /api/matches/:id - Get full match details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const payload = await buildMatchPayload(id)
    if (!payload) return sendFail(res, 'Match not found', 404)
    return sendOk(res, payload)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to fetch match', 500)
  }
})

// PATCH /api/matches/:id - Update match settings
router.patch('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const match = await db.match.findUnique({ where: { id } })
  if (!match) return sendFail(res, 'Match not found', 404)

  const body = req.body ?? {}
  const editable = match.status === 'SCHEDULED' || match.status === 'TOSS_DONE'
  let format = match.format
  let totalOvers = match.totalOvers

  if (body.format && body.format !== match.format) {
    if (!editable) return sendFail(res, 'Format can only be changed before the match starts')
    if (!['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format)) return sendFail(res, 'Invalid format')
    format = body.format
  }

  if (body.teamAId || body.teamBId) {
    if (!editable) return sendFail(res, 'Teams can only be changed before the match starts')
  }

  const teamAId = body.teamAId ?? match.teamAId
  const teamBId = body.teamBId ?? match.teamBId
  if (teamAId === teamBId) return sendFail(res, 'A team cannot play against itself')

  if (body.teamAId || body.teamBId) {
    const [a, b] = await Promise.all([
      db.team.findUnique({ where: { id: teamAId } }),
      db.team.findUnique({ where: { id: teamBId } }),
    ])
    if (!a) return sendFail(res, 'Team A not found', 404)
    if (!b) return sendFail(res, 'Team B not found', 404)
  }

  if (format === 'CUSTOM') {
    if (body.totalOvers !== undefined) {
      if (!editable) return sendFail(res, 'Overs can only be changed before the match starts')
      const n = Math.floor(Number(body.totalOvers))
      if (!Number.isInteger(n) || n < 1 || n > 50) return sendFail(res, 'Custom overs must be between 1 and 50')
      totalOvers = n
    }
  } else {
    totalOvers = match.totalOvers
  }

  let maxOversPerBowlerUpdate: number | null | undefined = undefined
  if (body.maxOversPerBowler !== undefined) {
    if (body.maxOversPerBowler === null || body.maxOversPerBowler === '' || body.maxOversPerBowler === 0) {
      maxOversPerBowlerUpdate = null
    } else {
      const val = Math.floor(Number(body.maxOversPerBowler))
      if (!Number.isInteger(val) || val < 1 || val > 20) {
        return sendFail(res, 'Max overs per bowler must be between 1 and 20')
      }
      maxOversPerBowlerUpdate = val
    }
  }

  let maxBowlersWithMaxUpdate: number | null | undefined = undefined
  if (body.maxBowlersWithMaxOvers !== undefined) {
    if (body.maxBowlersWithMaxOvers === null || body.maxBowlersWithMaxOvers === '' || body.maxBowlersWithMaxOvers === 0) {
      maxBowlersWithMaxUpdate = null
    } else {
      const val = Math.floor(Number(body.maxBowlersWithMaxOvers))
      if (!Number.isInteger(val) || val < 1 || val > 10) {
        return sendFail(res, 'Max bowlers with max overs must be between 1 and 10')
      }
      maxBowlersWithMaxUpdate = val
    }
  }

  let mainUmpireUpdate: ReturnType<typeof cleanUmpire> | undefined = undefined
  let legUmpireUpdate: ReturnType<typeof cleanUmpire> | undefined = undefined
  if (body.mainUmpire !== undefined) mainUmpireUpdate = cleanUmpire(body.mainUmpire)
  if (body.legUmpire !== undefined) legUmpireUpdate = cleanUmpire(body.legUmpire)

  if (mainUmpireUpdate !== undefined || legUmpireUpdate !== undefined || body.teamAId || body.teamBId) {
    const effMain = mainUmpireUpdate !== undefined ? mainUmpireUpdate : cleanUmpire((match as any).mainUmpire)
    const effLeg = legUmpireUpdate !== undefined ? legUmpireUpdate : cleanUmpire((match as any).legUmpire)
    const umpireErr = await validateUmpires(effMain, effLeg, teamAId, teamBId, id)
    if (umpireErr) return sendFail(res, umpireErr)
  }

  const updated = await db.match.update({
    where: { id },
    data: {
      venue: body.venue !== undefined ? body.venue?.trim() || null : match.venue,
      format,
      totalOvers,
      teamAId,
      teamBId,
      ...(maxOversPerBowlerUpdate !== undefined ? { maxOversPerBowler: maxOversPerBowlerUpdate } : {}),
      ...(maxBowlersWithMaxUpdate !== undefined ? { maxBowlersWithMaxOvers: maxBowlersWithMaxUpdate } : {}),
      ...(mainUmpireUpdate !== undefined ? { mainUmpire: mainUmpireUpdate } : {}),
      ...(legUmpireUpdate !== undefined ? { legUmpire: legUmpireUpdate } : {}),
      ...(body.seasonId !== undefined ? { seasonId: body.seasonId || null } : {}),
      ...(body.tournamentId !== undefined ? { tournamentId: body.tournamentId || null } : {}),
      ...(body.matchDate !== undefined ? { matchDate: body.matchDate ? new Date(body.matchDate) : null } : {}),
      ...(Array.isArray(body.playingXIA) ? { playingXIA: body.playingXIA } : {}),
      ...(Array.isArray(body.playingXIB) ? { playingXIB: body.playingXIB } : {}),
      ...(body.playerOfMatchId !== undefined ? { playerOfMatchId: body.playerOfMatchId || null } : {}),
      ...(Array.isArray(body.playerStatuses) ? { playerStatuses: body.playerStatuses } : {}),
    },
  })

  if (mainUmpireUpdate !== undefined || legUmpireUpdate !== undefined) {
    const activeInn = await Innings.findOne({ matchId: id, number: match.currentInnings })
    if (activeInn) {
      await Innings.findByIdAndUpdate(activeInn._id, {
        $set: {
          ...(mainUmpireUpdate !== undefined ? { mainUmpire: mainUmpireUpdate } : {}),
          ...(legUmpireUpdate !== undefined ? { legUmpire: legUmpireUpdate } : {}),
        },
      })
    }
  }

  await emitMatchUpdate(updated.id)
  return sendOk(res, (await buildMatchPayload(updated.id)) ?? updated)
})

// DELETE /api/matches/:id - Delete a match
router.delete('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const match = await db.match.findUnique({ where: { id } })
  if (!match) return sendFail(res, 'Match not found', 404)

  const affectedStats = await PlayerMatchStat.find({ matchId: id }).select({ playerId: 1 }).lean()
  await db.match.delete({ where: { id } })
  if (affectedStats.length > 0) {
    await PlayerMatchStat.deleteMany({ matchId: id })
    await Award.deleteMany({ matchId: id })
    await rebuildCareerStatsForPlayers(affectedStats.map((s) => s.playerId))
  }
  const summaries = await buildMatchSummaries()
  await emitToRoom('matches', 'matches:update', summaries)
  await emitToRoom(`match:${id}`, 'match:update', null)
  return sendOk(res, { deleted: true })
})

// POST /api/matches/:id/toss - Record toss
router.post('/:id/toss', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  try {
    await setToss(id, req.body ?? {})
    return sendOk(res, await buildMatchPayload(id))
  } catch (e: any) {
    if (e instanceof MatchError) return sendFail(res, e.message, e.status)
    return sendFail(res, e?.message || 'Error recording toss', 500)
  }
})

// POST /api/matches/:id/start - Start match or second innings
router.post('/:id/start', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  try {
    const match = await db.match.findUnique({ where: { id } })
    if (!match) return sendFail(res, 'Match not found', 404)

    const rawBody = req.body ?? {}
    const mainUmpire = rawBody.mainUmpire !== undefined ? cleanUmpire(rawBody.mainUmpire) : undefined
    const legUmpire = rawBody.legUmpire !== undefined ? cleanUmpire(rawBody.legUmpire) : undefined
    if (mainUmpire !== undefined || legUmpire !== undefined) {
      const effMain = mainUmpire !== undefined ? mainUmpire : cleanUmpire((match as any).mainUmpire)
      const effLeg = legUmpire !== undefined ? legUmpire : cleanUmpire((match as any).legUmpire)
      const umpireErr = await validateUmpires(effMain, effLeg, match.teamAId, match.teamBId, id)
      if (umpireErr) return sendFail(res, umpireErr)
    }

    if (match.status === 'INNINGS_BREAK') {
      await startInnings2(id, rawBody)
    } else {
      await startMatch(id, rawBody)
    }
    return sendOk(res, await buildMatchPayload(id))
  } catch (e: any) {
    if (e instanceof MatchError) return sendFail(res, e.message, e.status)
    return sendFail(res, e?.message || 'Error starting match', 500)
  }
})

// POST /api/matches/:id/ball - Record a delivery
router.post('/:id/ball', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const body = req.body ?? {}
  try {
    await recordBall(id, {
      runsOffBat: Number(body.runsOffBat ?? 0),
      extraType: (body.extraType ?? null) as never,
      extraRuns: Number(body.extraRuns ?? 0),
      wicketType: (body.wicketType ?? null) as never,
      dismissedId: body.dismissedId ?? null,
      assistId: body.assistId ?? null,
    })
    return sendOk(res, await buildMatchPayload(id))
  } catch (e: any) {
    if (e instanceof MatchError) return sendFail(res, e.message, e.status)
    return sendFail(res, e?.message || 'Error recording ball', 500)
  }
})

// POST /api/matches/:id/action - Apply a match action
router.post('/:id/action', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const body = req.body ?? {}
  const action = body.action as MatchAction | undefined
  if (!action || !ACTIONS.includes(action)) return sendFail(res, 'Unknown action')

  try {
    await applyAction(id, action, { playerId: body.playerId })
    return sendOk(res, await buildMatchPayload(id))
  } catch (e: any) {
    if (e instanceof MatchError) return sendFail(res, e.message, e.status)
    return sendFail(res, e?.message || 'Error applying action', 500)
  }
})

// POST /api/matches/:id/undo - Undo last delivery
router.post('/:id/undo', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  try {
    await undoLastBall(id)
    return sendOk(res, await buildMatchPayload(id))
  } catch (e: any) {
    if (e instanceof MatchError) return sendFail(res, e.message, e.status)
    return sendFail(res, e?.message || 'Error undoing last ball', 500)
  }
})

// POST /api/matches/:id/finalize - Finalize scorecard before verification
router.post('/:id/finalize', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    const updated = await finalizeMatchScorecard(req.params.id, {
      type: 'ADMIN',
      id: session.adminId,
      name: session.username,
    })
    await emitMatchUpdate(req.params.id)
    return sendOk(res, { match: updated, payload: await buildMatchPayload(req.params.id) })
  } catch (e: any) {
    return sendFail(res, e?.message || 'Failed to finalize match scorecard', 400)
  }
})

// POST /api/matches/:id/verify - Verify scorecard & idempotently sync player/career stats
router.post('/:id/verify', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    if (req.body?.playerOfMatchId !== undefined) {
      const m = await Match.findById(req.params.id)
      if (!m) return sendFail(res, 'Match not found', 404)
      m.playerOfMatchId = req.body.playerOfMatchId || null
      await m.save()
    }
    const result = await verifyMatchAndSyncStats(req.params.id, {
      type: 'ADMIN',
      id: session.adminId,
      name: session.username,
    }, { force: Boolean(req.body?.force) })
    await emitMatchUpdate(req.params.id)
    return sendOk(res, { ...result, payload: await buildMatchPayload(req.params.id) })
  } catch (e: any) {
    return sendFail(res, e?.message || 'Failed to verify match statistics', 400)
  }
})

// POST /api/matches/:id/correct - Admin correction workflow with transactional stats recalculation & audit log
router.post('/:id/correct', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Authorized scorecard correction'
    const result = await correctMatchAndRecalculate(
      req.params.id,
      req.body ?? {},
      { type: 'ADMIN', id: session.adminId, name: session.username },
      reason
    )
    await emitMatchUpdate(req.params.id)
    return sendOk(res, { ...result, payload: await buildMatchPayload(req.params.id) })
  } catch (e: any) {
    return sendFail(res, e?.message || 'Failed to apply scorecard correction', 400)
  }
})

// POST /api/matches/:id/player-status - Set RETIRED_HURT / RETIRED_OUT / ABSENT / PLAYED for a match player
router.post('/:id/player-status', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    const { playerId, status, notes } = req.body ?? {}
    if (!playerId || !['PLAYED', 'RETIRED_HURT', 'RETIRED_OUT', 'ABSENT'].includes(status)) {
      return sendFail(res, 'Valid playerId and status (PLAYED | RETIRED_HURT | RETIRED_OUT | ABSENT) are required')
    }
    const player = await Player.findById(playerId).select({ _id: 1 }).lean()
    if (!player) return sendFail(res, 'Player not found', 404)

    const match = await Match.findById(req.params.id)
    if (!match) return sendFail(res, 'Match not found', 404)

    const filtered = (match.playerStatuses ?? []).filter((s) => s.playerId !== playerId)
    filtered.push({ playerId, status, notes: typeof notes === 'string' ? notes.trim() || null : null })
    match.playerStatuses = filtered
    await match.save()

    if (match.scorecardStatus === 'VERIFIED' && match.status === 'COMPLETED') {
      await verifyMatchAndSyncStats(
        match._id,
        { type: 'ADMIN', id: session.adminId, name: session.username },
        { force: true, action: 'CORRECT_MATCH', reason: `Updated player status to ${status}` }
      )
    }

    await emitMatchUpdate(req.params.id)
    return sendOk(res, await buildMatchPayload(req.params.id))
  } catch (e: any) {
    return sendFail(res, e?.message || 'Failed to update player match status', 500)
  }
})

// POST /api/matches/:id/player-of-match - Assign Player of the Match award
router.post('/:id/player-of-match', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    const match = await Match.findById(req.params.id)
    if (!match) return sendFail(res, 'Match not found', 404)

    const playerId = typeof req.body?.playerId === 'string' && req.body.playerId.trim() ? req.body.playerId.trim() : null
    if (playerId) {
      const p = await Player.findById(playerId).select({ _id: 1 }).lean()
      if (!p) return sendFail(res, 'Player not found', 404)
    }

    match.playerOfMatchId = playerId
    await match.save()

    if (match.scorecardStatus === 'VERIFIED' && match.status === 'COMPLETED') {
      await verifyMatchAndSyncStats(
        match._id,
        { type: 'ADMIN', id: session.adminId, name: session.username },
        { force: true, action: 'CORRECT_MATCH', reason: 'Updated Player of the Match' }
      )
    }

    await emitMatchUpdate(req.params.id)
    return sendOk(res, await buildMatchPayload(req.params.id))
  } catch (e: any) {
    return sendFail(res, e?.message || 'Failed to assign Player of the Match', 500)
  }
})

export default router
