import { Router } from 'express'
import { db } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
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

  const format = rawFormat && ['T10', 'T20', 'ODI', 'CUSTOM'].includes(rawFormat) ? rawFormat : 'T20'
  let totalOvers: number
  if (format === 'CUSTOM') {
    totalOvers = Math.floor(Number(rawOvers ?? 0))
    if (!Number.isInteger(totalOvers) || totalOvers < 1 || totalOvers > 50) {
      return sendFail(res, 'Custom overs must be between 1 and 50')
    }
  } else {
    totalOvers = FORMAT_OVERS[format]
  }

  const match = await db.match.create({
    data: {
      teamAId,
      teamBId,
      format,
      totalOvers,
      venue: typeof venue === 'string' ? venue.trim() || null : null,
      status: 'SCHEDULED',
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

  const updated = await db.match.update({
    where: { id },
    data: {
      venue: body.venue !== undefined ? body.venue?.trim() || null : match.venue,
      format,
      totalOvers,
      teamAId,
      teamBId,
    },
  })

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

  await db.match.delete({ where: { id } })
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

    if (match.status === 'INNINGS_BREAK') {
      await startInnings2(id, req.body ?? {})
    } else {
      await startMatch(id, req.body ?? {})
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

export default router
