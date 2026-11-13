import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  connectDB,
  CaptaincyAssignment,
  CaptaincyAuditLog,
  Match,
  Player,
  PlayerAvailability,
  PlayingXISubmission,
  Season,
  Team,
  TeamAnnouncement,
  TeamMembership,
} from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { requirePlayer, type PlayerSession } from '../lib/player-auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import {
  getActiveCaptaincy,
  getTeamPerformanceStats,
  type EnrichedCaptaincyStatus,
} from '../lib/captaincy-service'
import {
  publishTeamAnnouncement,
  getAnnouncementDeliveryReport,
} from '../lib/notification-service'

const router = Router()

// Extend Express Request with captain session
interface CaptainRequest extends Request {
  playerSession?: PlayerSession
  captain?: EnrichedCaptaincyStatus
}

/**
 * Middleware ensuring the authenticated user is an active captain
 * for a valid, non-completed season.
 */
async function requireCaptainMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const pSess = await requirePlayer(req)
  if (!pSess) {
    sendFail(res, 'Captain authentication required. Please sign in to your player account.', 401)
    return
  }

  const captainStatus = await getActiveCaptaincy(pSess.playerId)
  if (!captainStatus.isCaptain || !captainStatus.teamId || !captainStatus.seasonId) {
    sendFail(res, 'Active captain authorization required for this operation', 403)
    return
  }

  ;(req as CaptainRequest).playerSession = pSess
  ;(req as CaptainRequest).captain = captainStatus
  next()
}

// ============================================================================
// ADMIN CAPTAIN MANAGEMENT ROUTES (requireAdmin)
// ============================================================================

// GET /api/captains/admin/overview - Overview of captaincy assignments with search & filters
router.get('/admin/overview', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId, status, query } = req.query

    const filter: Record<string, any> = {}
    if (typeof seasonId === 'string' && seasonId) filter.seasonId = seasonId
    if (typeof teamId === 'string' && teamId) filter.teamId = teamId
    if (typeof status === 'string' && status && status !== 'all') filter.status = status

    const [assignments, seasons, teams, players] = await Promise.all([
      CaptaincyAssignment.find(filter).sort({ assignedAt: -1 }).lean(),
      Season.find({}).lean(),
      Team.find({}).lean(),
      Player.find({}).select({ _id: 1, name: 1, playerCode: 1, role: 1, avatarUrl: 1 }).lean(),
    ])

    const seasonMap = new Map(seasons.map((s) => [s._id, s]))
    const teamMap = new Map(teams.map((t) => [t._id, t]))
    const playerMap = new Map(players.map((p) => [p._id, p]))

    let enriched = assignments.map((a) => {
      const s = seasonMap.get(a.seasonId)
      const t = teamMap.get(a.teamId)
      const p = playerMap.get(a.playerId)
      return {
        ...a,
        id: a._id,
        season: s ? { id: s._id, name: s.name, code: s.code, year: s.year, status: s.status } : null,
        team: t ? { id: t._id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl } : null,
        player: p ? { id: p._id, name: p.name, playerCode: p.playerCode, role: p.role, avatarUrl: p.avatarUrl } : null,
      }
    })

    if (typeof query === 'string' && query.trim()) {
      const q = query.trim().toLowerCase()
      enriched = enriched.filter(
        (item) =>
          item.player?.name.toLowerCase().includes(q) ||
          item.player?.playerCode?.toLowerCase().includes(q) ||
          item.team?.name.toLowerCase().includes(q) ||
          item.team?.shortName.toLowerCase().includes(q) ||
          item.season?.name.toLowerCase().includes(q)
      )
    }

    return sendOk(res, enriched)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load captaincy overview', 500)
  }
})

// GET /api/captains/admin/squad-candidates - List registered squad players eligible for captaincy
router.get('/admin/squad-candidates', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId } = req.query
    if (typeof seasonId !== 'string' || !seasonId || typeof teamId !== 'string' || !teamId) {
      return sendFail(res, 'seasonId and teamId are required')
    }

    const [memberships, players, existingActiveCaptains] = await Promise.all([
      TeamMembership.find({
        seasonId,
        teamId,
        status: { $in: ['ACTIVE', 'COMPLETED'] },
      }).lean(),
      Player.find({ status: { $ne: 'MERGED' } })
        .select({ _id: 1, name: 1, playerCode: 1, role: 1, avatarUrl: 1, jerseyNumber: 1 })
        .lean(),
      CaptaincyAssignment.find({ seasonId, status: 'active' }).lean(),
    ])

    const playerMap = new Map(players.map((p) => [p._id, p]))
    const activeCapMap = new Map(existingActiveCaptains.map((c) => [c.playerId, c.teamId]))

    const candidates = memberships
      .map((m) => {
        const p = playerMap.get(m.playerId)
        if (!p) return null
        const activeTeamId = activeCapMap.get(p._id)
        return {
          id: p._id,
          name: p.name,
          playerCode: p.playerCode,
          role: p.role,
          avatarUrl: p.avatarUrl,
          jerseyNumber: m.jerseyNumber ?? p.jerseyNumber,
          isCurrentTeamCaptain: activeTeamId === teamId,
          isOtherTeamCaptain: Boolean(activeTeamId && activeTeamId !== teamId),
        }
      })
      .filter(Boolean)

    return sendOk(res, candidates)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load squad candidates', 500)
  }
})

// POST /api/captains/admin/assign - Assign a player as captain
router.post('/admin/assign', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId, playerId, notes, replaceExisting } = req.body ?? {}

    if (!seasonId || !teamId || !playerId) {
      return sendFail(res, 'seasonId, teamId, and playerId are required')
    }

    const [season, team, player, membership] = await Promise.all([
      Season.findById(seasonId).lean(),
      Team.findById(teamId).lean(),
      Player.findById(playerId).lean(),
      TeamMembership.findOne({ seasonId, teamId, playerId }).lean(),
    ])

    if (!season) return sendFail(res, 'Season not found', 404)
    if (season.status === 'COMPLETED') {
      return sendFail(res, 'Cannot assign captain to a COMPLETED season', 400)
    }
    if (!team) return sendFail(res, 'Team not found', 404)
    if (!player) return sendFail(res, 'Player not found', 404)
    if (player.status === 'MERGED') {
      return sendFail(res, 'Cannot assign a merged player profile', 400)
    }

    // Rule: Must belong to selected team's season squad
    if (!membership || (membership.status !== 'ACTIVE' && membership.status !== 'COMPLETED')) {
      return sendFail(
        res,
        `Player ${player.name} is not registered in ${team.name}'s squad for ${season.name}`,
        400
      )
    }

    // Rule: A player cannot be captain of two different teams in the same season
    const otherTeamCaptaincy = await CaptaincyAssignment.findOne({
      seasonId,
      playerId,
      status: 'active',
      teamId: { $ne: teamId },
    }).lean()

    if (otherTeamCaptaincy) {
      return sendFail(
        res,
        `Player is already active captain for another team in ${season.name}. A player cannot captain multiple teams in the same season.`,
        409
      )
    }

    // Check if team already has an active captain
    const currentActive = await CaptaincyAssignment.findOne({
      seasonId,
      teamId,
      status: 'active',
    })

    if (currentActive) {
      if (currentActive.playerId === playerId) {
        return sendFail(res, `${player.name} is already the active captain of ${team.name}`, 409)
      }
      if (!replaceExisting) {
        return sendFail(
          res,
          `Team already has an active captain. Pass replaceExisting=true to replace the current captain.`,
          409
        )
      }

      // Replace: End existing captaincy assignment
      currentActive.status = 'completed'
      currentActive.endedAt = new Date()
      await currentActive.save()

      // Reset previous captain's team membership designation
      await TeamMembership.updateOne(
        { seasonId, teamId, playerId: currentActive.playerId },
        { $set: { designation: 'PLAYER' } }
      )

      await CaptaincyAuditLog.create({
        assignmentId: currentActive._id,
        action: 'REPLACE',
        seasonId,
        teamId,
        previousCaptainId: currentActive.playerId,
        newCaptainId: playerId,
        performedBy: session.username,
        performedAt: new Date(),
        reason: notes || 'Admin replaced team captain',
      })
    }

    // Create new active captain assignment
    const assignment = await CaptaincyAssignment.create({
      playerId,
      teamId,
      seasonId,
      assignedBy: session.username,
      assignedAt: new Date(),
      status: 'active',
      notes: typeof notes === 'string' ? notes.trim() || null : null,
    })

    // Update new captain's designation in season squad
    await TeamMembership.updateOne(
      { seasonId, teamId, playerId },
      { $set: { designation: 'CAPTAIN' } }
    )

    // Log the assignment audit event
    await CaptaincyAuditLog.create({
      assignmentId: assignment._id,
      action: 'ASSIGN',
      seasonId,
      teamId,
      previousCaptainId: currentActive?.playerId ?? null,
      newCaptainId: playerId,
      performedBy: session.username,
      performedAt: new Date(),
      reason: notes || 'Official captain assignment',
    })

    return sendOk(res, assignment.toObject(), 201)
  } catch (err: any) {
    if (err?.code === 11000) {
      return sendFail(
        res,
        'Database constraint: Team already has an active captain for this season',
        409
      )
    }
    return sendFail(res, err?.message || 'Failed to assign captain', 500)
  }
})

// POST /api/captains/admin/replace - Replace an active captain
router.post('/admin/replace', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId, newPlayerId, reason } = req.body ?? {}

    if (!seasonId || !teamId || !newPlayerId) {
      return sendFail(res, 'seasonId, teamId, and newPlayerId are required')
    }

    const [season, team, newPlayer, newMembership, currentActive] = await Promise.all([
      Season.findById(seasonId).lean(),
      Team.findById(teamId).lean(),
      Player.findById(newPlayerId).lean(),
      TeamMembership.findOne({ seasonId, teamId, playerId: newPlayerId }).lean(),
      CaptaincyAssignment.findOne({ seasonId, teamId, status: 'active' }),
    ])

    if (!season) return sendFail(res, 'Season not found', 404)
    if (!team) return sendFail(res, 'Team not found', 404)
    if (!newPlayer) return sendFail(res, 'New player not found', 404)
    if (!newMembership) {
      return sendFail(res, `New player is not a member of ${team.name} in ${season.name}`, 400)
    }
    if (!currentActive) {
      return sendFail(res, `No active captain found for ${team.name} in ${season.name}`, 404)
    }
    if (currentActive.playerId === newPlayerId) {
      return sendFail(res, 'Player is already active captain', 400)
    }

    // End current captaincy
    const prevCaptainId = currentActive.playerId
    currentActive.status = 'completed'
    currentActive.endedAt = new Date()
    await currentActive.save()

    // Reset previous captain's designation
    await TeamMembership.updateOne(
      { seasonId, teamId, playerId: prevCaptainId },
      { $set: { designation: 'PLAYER' } }
    )

    // Create new captaincy
    const assignment = await CaptaincyAssignment.create({
      playerId: newPlayerId,
      teamId,
      seasonId,
      assignedBy: session.username,
      assignedAt: new Date(),
      status: 'active',
      notes: typeof reason === 'string' ? reason.trim() || null : null,
    })

    // Set new captain's designation
    await TeamMembership.updateOne(
      { seasonId, teamId, playerId: newPlayerId },
      { $set: { designation: 'CAPTAIN' } }
    )

    // Audit log
    await CaptaincyAuditLog.create({
      assignmentId: assignment._id,
      action: 'REPLACE',
      seasonId,
      teamId,
      previousCaptainId: prevCaptainId,
      newCaptainId: newPlayerId,
      performedBy: session.username,
      performedAt: new Date(),
      reason: reason || 'Captain replaced by admin',
    })

    return sendOk(res, assignment.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to replace captain', 500)
  }
})

// POST /api/captains/admin/remove - Remove captaincy without deleting history
router.post('/admin/remove', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { assignmentId, reason } = req.body ?? {}

    if (!assignmentId) return sendFail(res, 'assignmentId is required')

    const assignment = await CaptaincyAssignment.findById(assignmentId)
    if (!assignment) return sendFail(res, 'Captaincy assignment not found', 404)
    if (assignment.status !== 'active') {
      return sendFail(res, 'Assignment is not currently active', 400)
    }

    assignment.status = 'revoked'
    assignment.endedAt = new Date()
    await assignment.save()

    // Reset squad designation
    await TeamMembership.updateOne(
      { seasonId: assignment.seasonId, teamId: assignment.teamId, playerId: assignment.playerId },
      { $set: { designation: 'PLAYER' } }
    )

    // Write audit log
    await CaptaincyAuditLog.create({
      assignmentId: assignment._id,
      action: 'REMOVE',
      seasonId: assignment.seasonId,
      teamId: assignment.teamId,
      previousCaptainId: assignment.playerId,
      newCaptainId: null,
      performedBy: session.username,
      performedAt: new Date(),
      reason: reason || 'Captaincy removed by admin',
    })

    return sendOk(res, assignment.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to remove captaincy', 500)
  }
})

// GET /api/captains/admin/audit-logs - View audit history
router.get('/admin/audit-logs', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId } = req.query
    const filter: Record<string, any> = {}
    if (typeof seasonId === 'string' && seasonId) filter.seasonId = seasonId
    if (typeof teamId === 'string' && teamId) filter.teamId = teamId

    const [logs, players, teams, seasons] = await Promise.all([
      CaptaincyAuditLog.find(filter).sort({ performedAt: -1 }).limit(100).lean(),
      Player.find({}).select({ _id: 1, name: 1, playerCode: 1 }).lean(),
      Team.find({}).select({ _id: 1, name: 1, shortName: 1 }).lean(),
      Season.find({}).select({ _id: 1, name: 1, year: 1 }).lean(),
    ])

    const pMap = new Map(players.map((p) => [p._id, p]))
    const tMap = new Map(teams.map((t) => [t._id, t]))
    const sMap = new Map(seasons.map((s) => [s._id, s]))

    const enriched = logs.map((l) => ({
      ...l,
      id: l._id,
      previousCaptain: l.previousCaptainId ? pMap.get(l.previousCaptainId) ?? null : null,
      newCaptain: l.newCaptainId ? pMap.get(l.newCaptainId) ?? null : null,
      team: tMap.get(l.teamId) ?? null,
      season: sMap.get(l.seasonId) ?? null,
    }))

    return sendOk(res, enriched)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load audit logs', 500)
  }
})

// GET /api/captains/admin/lineups - Admin reviews Playing XI submissions across matches
router.get('/admin/lineups', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { seasonId, teamId, status } = req.query
    const filter: Record<string, any> = {}
    if (typeof seasonId === 'string' && seasonId) filter.seasonId = seasonId
    if (typeof teamId === 'string' && teamId) filter.teamId = teamId
    if (typeof status === 'string' && status) filter.status = status

    const [submissions, matches, teams, players] = await Promise.all([
      PlayingXISubmission.find(filter).sort({ submittedAt: -1, updatedAt: -1 }).lean(),
      Match.find({}).select({ _id: 1, matchDate: 1, venue: 1, status: 1, teamAId: 1, teamBId: 1 }).lean(),
      Team.find({}).select({ _id: 1, name: 1, shortName: 1 }).lean(),
      Player.find({}).select({ _id: 1, name: 1, role: 1, playerCode: 1 }).lean(),
    ])

    const mMap = new Map(matches.map((m) => [m._id, m]))
    const tMap = new Map(teams.map((t) => [t._id, t]))
    const pMap = new Map(players.map((p) => [p._id, p]))

    const enriched = submissions.map((sub) => {
      const m = mMap.get(sub.matchId)
      const oppTeamId = m ? (m.teamAId === sub.teamId ? m.teamBId : m.teamAId) : null
      return {
        ...sub,
        id: sub._id,
        match: m
          ? {
              id: m._id,
              matchDate: m.matchDate,
              venue: m.venue,
              status: m.status,
              opponent: oppTeamId ? tMap.get(oppTeamId) ?? null : null,
            }
          : null,
        team: tMap.get(sub.teamId) ?? null,
        captain: pMap.get(sub.captainId) ?? null,
        playingXIPlayers: sub.playingXI.map((id) => pMap.get(id)).filter(Boolean),
        substitutePlayers: sub.substitutes.map((id) => pMap.get(id)).filter(Boolean),
      }
    })

    return sendOk(res, enriched)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load lineup submissions', 500)
  }
})

// POST /api/captains/admin/lineups/:id/review - Admin approves or rejects Playing XI
router.post('/admin/lineups/:id/review', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const { status, reviewNotes, applyToMatch } = req.body ?? {}

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return sendFail(res, "status must be 'APPROVED' or 'REJECTED'", 400)
    }

    const submission = await PlayingXISubmission.findById(req.params.id)
    if (!submission) return sendFail(res, 'Lineup submission not found', 404)

    submission.status = status
    submission.reviewNotes = typeof reviewNotes === 'string' ? reviewNotes.trim() || null : null
    submission.reviewedBy = session.username
    submission.reviewedAt = new Date()
    await submission.save()

    // If approved and requested, sync directly into official match lineup
    if (status === 'APPROVED' && applyToMatch) {
      const match = await Match.findById(submission.matchId)
      if (match) {
        if (match.teamAId === submission.teamId) {
          match.playingXIA = submission.playingXI
        } else if (match.teamBId === submission.teamId) {
          match.playingXIB = submission.playingXI
        }
        await match.save()
      }
    }

    return sendOk(res, submission.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to review lineup submission', 500)
  }
})

// ============================================================================
// CAPTAIN-ONLY ROUTES (requireCaptainMiddleware)
// ============================================================================

// GET /api/captains/my-status - Active captain status and assigned team/season
router.get('/my-status', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const status = await getActiveCaptaincy(pSess.playerId)
    return sendOk(res, status)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load captain status', 500)
  }
})

// GET /api/captains/team-squad - Captain views full registered team squad (read-only)
router.get('/team-squad', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const memberships = await TeamMembership.find({
      teamId: captain.teamId,
      seasonId: captain.seasonId,
      status: { $in: ['ACTIVE', 'COMPLETED'] },
    }).lean()

    const playerIds = memberships.map((m) => m.playerId)
    const players = await Player.find({ _id: { $in: playerIds } }).lean()
    const pMap = new Map(players.map((p) => [p._id, p]))

    const squad = memberships.map((m) => {
      const p = pMap.get(m.playerId)
      return {
        id: m.playerId,
        membershipId: m._id,
        name: p?.name ?? 'Player',
        playerCode: p?.playerCode ?? null,
        role: p?.role ?? 'ALL_ROUNDER',
        battingStyle: p?.battingStyle ?? null,
        bowlingStyle: p?.bowlingStyle ?? null,
        jerseyNumber: m.jerseyNumber ?? p?.jerseyNumber ?? null,
        designation: m.designation,
        avatarUrl: p?.avatarUrl ?? null,
        isVerified: p?.isVerified ?? false,
        joinedAt: m.joinedAt,
      }
    })

    return sendOk(res, squad)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load team squad', 500)
  }
})

// GET /api/captains/fixtures - Captain views team fixtures (upcoming & completed)
router.get('/fixtures', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const [matches, teams] = await Promise.all([
      Match.find({
        seasonId: captain.seasonId,
        $or: [{ teamAId: captain.teamId }, { teamBId: captain.teamId }],
      })
        .sort({ matchDate: 1 })
        .lean(),
      Team.find({}).lean(),
    ])

    const teamMap = new Map(teams.map((t) => [t._id, t]))

    const fixtures = matches.map((m) => {
      const isTeamA = m.teamAId === captain.teamId
      const oppId = isTeamA ? m.teamBId : m.teamAId
      const opponent = teamMap.get(oppId)
      return {
        id: m._id,
        format: m.format,
        totalOvers: m.totalOvers,
        venue: m.venue,
        status: m.status,
        matchDate: m.matchDate,
        resultText: m.resultText,
        winnerId: m.winnerId,
        isWon: m.winnerId === captain.teamId,
        scorecardStatus: m.scorecardStatus,
        opponent: opponent
          ? {
              id: opponent._id,
              name: opponent.name,
              shortName: opponent.shortName,
              color: opponent.color,
              logoUrl: opponent.logoUrl,
            }
          : null,
      }
    })

    return sendOk(res, fixtures)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load fixtures', 500)
  }
})

// GET /api/captains/lineup/:matchId - View Playing XI draft or submission
router.get('/lineup/:matchId', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId) return sendFail(res, 'Invalid captain context', 400)

  try {
    await connectDB()
    const { matchId } = req.params
    const match = await Match.findById(matchId).lean()
    if (!match) return sendFail(res, 'Match not found', 404)

    // Security check: Must belong to captain's team and active season
    if (match.teamAId !== captain.teamId && match.teamBId !== captain.teamId) {
      return sendFail(res, 'Match does not involve your team', 403)
    }
    if (match.seasonId && match.seasonId !== captain.seasonId) {
      return sendFail(res, 'Match does not belong to your active captaincy season', 403)
    }
    if (match.seasonId && match.seasonId !== captain.seasonId) {
      return sendFail(res, 'Match does not belong to your active captaincy season', 403)
    }

    const submission = await PlayingXISubmission.findOne({
      matchId,
      teamId: captain.teamId,
    }).lean()

    return sendOk(res, submission ?? null)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load lineup', 500)
  }
})

// POST /api/captains/lineup/:matchId - Save draft or submit Playing XI
router.post('/lineup/:matchId', requireCaptainMiddleware, async (req, res) => {
  const { captain, playerSession } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId || !playerSession) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const { matchId } = req.params
    const { playingXI, substitutes, notes, submit } = req.body ?? {}

    const match = await Match.findById(matchId).lean()
    if (!match) return sendFail(res, 'Match not found', 404)

    // Security check: Match must involve captain's team and belong to their active season
    if (match.teamAId !== captain.teamId && match.teamBId !== captain.teamId) {
      return sendFail(res, 'Match does not involve your team', 403)
    }
    if (match.seasonId && match.seasonId !== captain.seasonId) {
      return sendFail(res, 'Match does not belong to your active captaincy season', 403)
    }
    if (match.seasonId && match.seasonId !== captain.seasonId) {
      return sendFail(res, 'Match does not belong to your active captaincy season', 403)
    }

    if (match.status === 'COMPLETED' || match.status === 'ABANDONED') {
      return sendFail(res, 'Cannot modify lineup for a finished or abandoned match', 400)
    }

    const xiArray: string[] = Array.isArray(playingXI) ? playingXI : []
    const subArray: string[] = Array.isArray(substitutes) ? substitutes : []

    // Validate squad membership: all players must belong to captain's squad
    const squadMemberships = await TeamMembership.find({
      teamId: captain.teamId,
      seasonId: captain.seasonId,
      status: { $in: ['ACTIVE', 'COMPLETED'] },
    }).lean()

    const squadPlayerIds = new Set(squadMemberships.map((m) => m.playerId))

    for (const pId of xiArray) {
      if (!squadPlayerIds.has(pId)) {
        return sendFail(res, `Player ${pId} is not a member of your registered squad`, 400)
      }
    }
    for (const pId of subArray) {
      if (!squadPlayerIds.has(pId)) {
        return sendFail(res, `Substitute player ${pId} is not in your squad`, 400)
      }
    }

    // No duplicates within playingXI or between playingXI and substitutes
    const uniqueXI = new Set(xiArray)
    if (uniqueXI.size !== xiArray.length) {
      return sendFail(res, 'Playing XI contains duplicate players', 400)
    }
    for (const subId of subArray) {
      if (uniqueXI.has(subId)) {
        return sendFail(res, `Player cannot be in both Playing XI and substitutes`, 400)
      }
    }

    // When submitting, require exactly 11 players
    if (submit && xiArray.length !== 11) {
      return sendFail(res, `Playing XI must contain exactly 11 players (selected ${xiArray.length})`, 400)
    }

    const status = submit ? 'SUBMITTED' : 'DRAFT'
    const submittedAt = submit ? new Date() : null

    const updated = await PlayingXISubmission.findOneAndUpdate(
      { matchId, teamId: captain.teamId },
      {
        $set: {
          seasonId: captain.seasonId,
          captainId: playerSession.playerId,
          submittedBy: playerSession.userId,
          playingXI: xiArray,
          substitutes: subArray,
          notes: typeof notes === 'string' ? notes.trim() || null : null,
          status,
          submittedAt,
        },
      },
      { upsert: true, new: true }
    )

    return sendOk(res, updated.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to save lineup', 500)
  }
})

// GET /api/captains/availability/:matchId - View squad availability for match
router.get('/availability/:matchId', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const { matchId } = req.params
    const match = await Match.findById(matchId).lean()
    if (!match) return sendFail(res, 'Match not found', 404)

    if (match.teamAId !== captain.teamId && match.teamBId !== captain.teamId) {
      return sendFail(res, 'Match does not involve your team', 403)
    }
    if (match.seasonId && match.seasonId !== captain.seasonId) {
      return sendFail(res, 'Match does not belong to your active captaincy season', 403)
    }

    const [memberships, players, availabilities] = await Promise.all([
      TeamMembership.find({
        teamId: captain.teamId,
        seasonId: captain.seasonId,
        status: { $in: ['ACTIVE', 'COMPLETED'] },
      }).lean(),
      Player.find({}).select({ _id: 1, name: 1, role: 1, avatarUrl: 1, playerCode: 1 }).lean(),
      PlayerAvailability.find({ matchId, teamId: captain.teamId }).lean(),
    ])

    const pMap = new Map(players.map((p) => [p._id, p]))
    const aMap = new Map(availabilities.map((a) => [a.playerId, a]))

    const rosterAvailability = memberships.map((m) => {
      const p = pMap.get(m.playerId)
      const av = aMap.get(m.playerId)
      return {
        playerId: m.playerId,
        name: p?.name ?? 'Player',
        playerCode: p?.playerCode ?? null,
        role: p?.role ?? 'ALL_ROUNDER',
        avatarUrl: p?.avatarUrl ?? null,
        status: av?.status ?? 'PENDING',
        note: av?.note ?? null,
        updatedAt: av?.updatedAt ?? null,
      }
    })

    const summary = {
      availableCount: rosterAvailability.filter((r) => r.status === 'AVAILABLE').length,
      unavailableCount: rosterAvailability.filter((r) => r.status === 'UNAVAILABLE').length,
      pendingCount: rosterAvailability.filter((r) => r.status === 'PENDING' || r.status === 'TENTATIVE').length,
      totalSquad: rosterAvailability.length,
    }

    return sendOk(res, { summary, roster: rosterAvailability })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load availability', 500)
  }
})

// GET /api/captains/performance - Team analytics from actual scorecards
router.get('/performance', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const stats = await getTeamPerformanceStats(captain.teamId, captain.seasonId)
    return sendOk(res, stats)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load performance stats', 500)
  }
})

// GET /api/captains/announcements - View team announcements (published / archived)
router.get('/announcements', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const { status } = req.query
    const filter: Record<string, any> = {
      teamId: captain.teamId,
      seasonId: captain.seasonId,
    }
    if (status === 'published' || status === 'archived') {
      filter.status = status
    }

    const announcements = await TeamAnnouncement.find(filter)
      .sort({ createdAt: -1 })
      .lean()

    return sendOk(res, announcements.map((a) => ({ ...a, id: a._id })))
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load announcements', 500)
  }
})

// POST /api/captains/announcements - Create and publish a new team announcement
router.post('/announcements', requireCaptainMiddleware, async (req, res) => {
  const { captain, playerSession } = req as CaptainRequest
  if (!captain || !captain.teamId || !captain.seasonId || !playerSession) {
    return sendFail(res, 'Invalid captain context', 400)
  }

  try {
    await connectDB()
    const {
      title,
      content,
      priority,
      category,
      eventDate,
      eventTime,
      location,
      attachmentUrl,
    } = req.body ?? {}

    if (!title || typeof title !== 'string' || !title.trim()) {
      return sendFail(res, 'Announcement title is required')
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return sendFail(res, 'Announcement content / description is required')
    }

    const validPriorities = ['NORMAL', 'IMPORTANT', 'URGENT']
    const safePriority = validPriorities.includes(priority) ? priority : 'NORMAL'

    const validCategories = [
      'GENERAL',
      'PRACTICE',
      'MATCH_REMINDER',
      'MEETING',
      'UPDATE',
      'TOURNAMENT',
      'EMERGENCY',
    ]
    const safeCategory = validCategories.includes(category) ? category : 'GENERAL'

    const announcement = await publishTeamAnnouncement({
      captainPlayerId: playerSession.playerId,
      teamId: captain.teamId,
      seasonId: captain.seasonId,
      title: title.trim(),
      content: content.trim(),
      category: safeCategory as any,
      priority: safePriority as any,
      eventDate: eventDate ? new Date(eventDate) : null,
      eventTime: typeof eventTime === 'string' ? eventTime.trim() : null,
      location: typeof location === 'string' ? location.trim() : null,
      attachmentUrl: typeof attachmentUrl === 'string' ? attachmentUrl.trim() : null,
    })

    return sendOk(res, announcement, 201)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to publish announcement', 500)
  }
})

// GET /api/captains/announcements/:id/delivery-report - Audit delivery statistics
router.get('/announcements/:id/delivery-report', requireCaptainMiddleware, async (req, res) => {
  const { playerSession } = req as CaptainRequest
  if (!playerSession?.playerId) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const report = await getAnnouncementDeliveryReport(req.params.id, playerSession.playerId)
    return sendOk(res, report)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to generate delivery report', 500)
  }
})

// PUT /api/captains/announcements/:id - Edit an announcement
router.put('/announcements/:id', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId) return sendFail(res, 'Invalid captain context', 400)

  try {
    await connectDB()
    const {
      title,
      content,
      priority,
      category,
      eventDate,
      eventTime,
      location,
      attachmentUrl,
    } = req.body ?? {}

    const announcement = await TeamAnnouncement.findOne({
      _id: req.params.id,
      teamId: captain.teamId,
    })

    if (!announcement) return sendFail(res, 'Announcement not found', 404)

    if (title && typeof title === 'string') announcement.title = title.trim()
    if (content && typeof content === 'string') announcement.content = content.trim()
    if (priority && ['NORMAL', 'IMPORTANT', 'URGENT'].includes(priority)) {
      announcement.priority = priority
    }
    if (
      category &&
      ['GENERAL', 'PRACTICE', 'MATCH_REMINDER', 'MEETING', 'UPDATE', 'TOURNAMENT', 'EMERGENCY'].includes(category)
    ) {
      announcement.category = category
    }
    if (eventDate !== undefined) announcement.eventDate = eventDate ? new Date(eventDate) : null
    if (eventTime !== undefined) announcement.eventTime = eventTime ? String(eventTime).trim() : null
    if (location !== undefined) announcement.location = location ? String(location).trim() : null
    if (attachmentUrl !== undefined) announcement.attachmentUrl = attachmentUrl ? String(attachmentUrl).trim() : null

    await announcement.save()
    return sendOk(res, announcement.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update announcement', 500)
  }
})

// PATCH /api/captains/announcements/:id/archive - Archive an announcement
router.patch('/announcements/:id/archive', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId) return sendFail(res, 'Invalid captain context', 400)

  try {
    await connectDB()
    const announcement = await TeamAnnouncement.findOneAndUpdate(
      {
        _id: req.params.id,
        teamId: captain.teamId,
      },
      {
        $set: { status: 'archived' },
      },
      { new: true }
    )

    if (!announcement) return sendFail(res, 'Announcement not found', 404)
    return sendOk(res, announcement.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to archive announcement', 500)
  }
})

// DELETE /api/captains/announcements/:id - Delete an announcement
router.delete('/announcements/:id', requireCaptainMiddleware, async (req, res) => {
  const { captain } = req as CaptainRequest
  if (!captain || !captain.teamId) return sendFail(res, 'Invalid captain context', 400)

  try {
    await connectDB()
    const deleted = await TeamAnnouncement.findOneAndDelete({
      _id: req.params.id,
      teamId: captain.teamId,
    })
    if (!deleted) return sendFail(res, 'Announcement not found', 404)

    return sendOk(res, { success: true })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to delete announcement', 500)
  }
})

// ============================================================================
// GENERAL PLAYER AVAILABILITY & ANNOUNCEMENT ROUTES
// (Any authenticated player)
// ============================================================================

// GET /api/captains/player-availability/:matchId - Player checks their own availability
router.get('/player-availability/:matchId', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const av = await PlayerAvailability.findOne({
      matchId: req.params.matchId,
      playerId: pSess.playerId,
    }).lean()

    return sendOk(res, av ? { ...av, id: av._id } : null)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load player availability', 500)
  }
})

// POST /api/captains/player-availability/:matchId - Player responds to match availability
router.post('/player-availability/:matchId', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const { status, note } = req.body ?? {}

    if (!['AVAILABLE', 'UNAVAILABLE', 'TENTATIVE'].includes(status)) {
      return sendFail(res, "status must be 'AVAILABLE', 'UNAVAILABLE', or 'TENTATIVE'", 400)
    }

    const match = await Match.findById(req.params.matchId).lean()
    if (!match) return sendFail(res, 'Match not found', 404)

    if (match.status === 'COMPLETED' || match.status === 'ABANDONED') {
      return sendFail(res, 'Cannot submit availability for past matches', 400)
    }

    // Verify player belongs to one of the teams in this match and season
    const membership = await TeamMembership.findOne({
      playerId: pSess.playerId,
      seasonId: match.seasonId,
      teamId: { $in: [match.teamAId, match.teamBId] },
      status: { $in: ['ACTIVE', 'COMPLETED'] },
    }).lean()

    if (!membership) {
      return sendFail(res, 'You are not a registered squad player for this match', 403)
    }

    const updated = await PlayerAvailability.findOneAndUpdate(
      { matchId: match._id, playerId: pSess.playerId },
      {
        $set: {
          teamId: membership.teamId,
          seasonId: match.seasonId,
          status,
          note: typeof note === 'string' ? note.trim() || null : null,
        },
      },
      { upsert: true, new: true }
    )

    return sendOk(res, updated.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update availability', 500)
  }
})

// GET /api/captains/player-announcements - Normal player gets announcements for their active team
router.get('/player-announcements', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) {
    return sendOk(res, { announcements: [] })
  }

  try {
    await connectDB()
    const memberships = await TeamMembership.find({
      playerId: pSess.playerId,
      status: 'ACTIVE',
    }).lean()

    if (memberships.length === 0) {
      return sendOk(res, { announcements: [] })
    }

    const queryPairs = memberships.map((m) => ({ teamId: m.teamId, seasonId: m.seasonId }))
    const announcements = await TeamAnnouncement.find({
      $or: queryPairs,
      status: { $ne: 'archived' },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()

    const list = announcements.map((a) => ({ ...a, id: a._id }))
    return sendOk(res, { announcements: list })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load team announcements', 500)
  }
})

export default router

