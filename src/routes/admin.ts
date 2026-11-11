import { Router } from 'express'
import {
  Award,
  connectDB,
  db,
  Player,
  PlayerCareerStat,
  PlayerMatchStat,
  PlayerProfileClaim,
  StatisticsAuditLog,
  Team,
  TeamMembership,
  User,
} from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import { emitToRoom } from '../lib/broadcast'
import { mergePlayersAndRecalculate, recalculateStats, writeAuditLog, type ActorInfo } from '../lib/stats-service'

const router = Router()

const DEMO_SQUAD_A: Array<[string, string, number]> = [
  ['Arjun Mehta', 'BATTER', 1],
  ['Rohan Sharma', 'BATTER', 2],
  ['Vikram Rao', 'WICKETKEEPER', 3],
  ['Surya Patel', 'BATTER', 4],
  ['Karan Singh', 'ALL_ROUNDER', 5],
  ['Dev Chauhan', 'ALL_ROUNDER', 6],
  ['Aditya Verma', 'BOWLER', 7],
  ['Nitin Joshi', 'BOWLER', 8],
  ['Farhan Ali', 'BOWLER', 9],
  ['Sameer Khan', 'BOWLER', 10],
  ['Rahul Dubey', 'ALL_ROUNDER', 11],
]

const DEMO_SQUAD_B: Array<[string, string, number]> = [
  ['Aarav Nair', 'BATTER', 21],
  ['Ishaan Kulkarni', 'BATTER', 22],
  ['Manav Desai', 'WICKETKEEPER', 23],
  ['Kabir Malhotra', 'BATTER', 24],
  ['Rehan Pillai', 'ALL_ROUNDER', 25],
  ['Zaid Sheikh', 'ALL_ROUNDER', 26],
  ['Tarun Iyer', 'BOWLER', 27],
  ['Omkar Reddy', 'BOWLER', 28],
  ['Sahil Bansal', 'BOWLER', 29],
  ['Yash Gowda', 'BOWLER', 30],
  ['Nikhil Saxena', 'ALL_ROUNDER', 31],
]

async function notifyDeleted(matchIds: string[]): Promise<void> {
  await Promise.all([
    emitToRoom('matches', 'matches:update', null), // null => clients refetch feed
    ...matchIds.map((id) => emitToRoom(`match:${id}`, 'match:deleted', { matchId: id })),
  ])
}

// POST /api/admin/reset
router.post('/reset', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { scope } = req.body ?? {}

  if (scope === 'teams') {
    const [matchCount, teamCount, playerCount] = await Promise.all([
      db.match.count(),
      db.team.count(),
      db.player.count(),
    ])
    const matches = await db.match.findMany({ select: { id: true } })
    await db.match.deleteMany()
    await db.team.deleteMany()
    await Promise.all([
      TeamMembership.deleteMany({}),
      PlayerMatchStat.deleteMany({}),
      PlayerCareerStat.deleteMany({}),
      Award.deleteMany({}),
    ])
    await notifyDeleted(matches.map((m) => m.id))
    return sendOk(res, { scope, matchesDeleted: matchCount, teamsDeleted: teamCount, playersDeleted: playerCount })
  }

  if (scope === 'matches') {
    const [matchCount, teams] = await Promise.all([db.match.count(), db.team.count()])
    const matches = await db.match.findMany({ select: { id: true } })
    await db.match.deleteMany()
    await Promise.all([
      PlayerMatchStat.deleteMany({}),
      PlayerCareerStat.deleteMany({}),
      Award.deleteMany({ scope: 'MATCH' }),
    ])
    const remainingPlayers = await Player.find({ status: { $ne: 'MERGED' } }).select({ _id: 1 }).lean()
    await recalculateStats(null, { type: 'ADMIN', id: 'admin', name: 'Admin' }, 'Admin reset matches')
    await notifyDeleted(matches.map((m) => m.id))
    return sendOk(res, {
      scope,
      matchesDeleted: matchCount,
      teamsDeleted: 0,
      playersDeleted: 0,
      teamsKept: teams,
      playersReset: remainingPlayers.length,
    })
  }

  if (scope === 'demo') {
    const existing = await db.team.findMany({
      where: { name: { in: ['Rising Stars CC', 'Royal Warriors'] } },
      select: { name: true },
    })
    if (existing.length > 0) {
      return sendFail(res, 'Demo teams already exist. Use "Reset teams" first, then load demo data.')
    }

    const teamA = await db.team.create({
      data: { name: 'Rising Stars CC', shortName: 'RSC', color: '#0e7490', captain: 'Arjun Mehta' },
    })
    const teamB = await db.team.create({
      data: { name: 'Royal Warriors', shortName: 'RW', color: '#b45309', captain: 'Aarav Nair' },
    })
    await db.player.createMany({
      data: DEMO_SQUAD_A.map(([name, role, jerseyNumber]) => ({ name, role, jerseyNumber, teamId: teamA.id })),
    })
    await db.player.createMany({
      data: DEMO_SQUAD_B.map(([name, role, jerseyNumber]) => ({ name, role, jerseyNumber, teamId: teamB.id })),
    })
    const match = await db.match.create({
      data: {
        teamAId: teamA.id,
        teamBId: teamB.id,
        format: 'T10',
        totalOvers: 10,
        venue: 'City Cricket Ground',
        status: 'SCHEDULED',
      },
    })
    await emitToRoom('matches', 'matches:update', null)
    return sendOk(res, {
      scope,
      teamsCreated: 2,
      playersCreated: DEMO_SQUAD_A.length + DEMO_SQUAD_B.length,
      scheduledMatchId: match.id,
    })
  }

  return sendFail(res, 'Unknown scope — expected "teams", "matches" or "demo"')
})

function adminActor(req: any): ActorInfo {
  const admin = req.admin
  return {
    type: 'ADMIN',
    id: admin?.username ?? 'admin',
    name: admin?.username ?? 'Admin',
  }
}

// GET /api/admin/audit-logs - View career & match statistics audit trail
router.get('/audit-logs', async (req, res) => {
  const admin = await requireAdmin(req)
  if (!admin) return unauthorized(res)

  try {
    await connectDB()
    const filter: Record<string, any> = {}
    if (typeof req.query.action === 'string' && req.query.action.trim()) {
      filter.action = req.query.action.trim()
    }
    if (typeof req.query.matchId === 'string' && req.query.matchId.trim()) {
      filter.matchId = req.query.matchId.trim()
    }
    if (typeof req.query.playerId === 'string' && req.query.playerId.trim()) {
      const pid = req.query.playerId.trim()
      filter.$or = [{ playerId: pid }, { sourcePlayerId: pid }, { targetPlayerId: pid }]
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)
    const logs = await StatisticsAuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
    return sendOk(
      res,
      logs.map((l) => ({
        ...l,
        id: l._id,
      }))
    )
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load audit logs', 500)
  }
})

// GET /api/admin/claims - List unclaimed profile claim requests
router.get('/claims', async (req, res) => {
  const admin = await requireAdmin(req)
  if (!admin) return unauthorized(res)

  try {
    await connectDB()
    const statusParam = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'PENDING'
    const filter: Record<string, any> = statusParam && statusParam !== 'ALL' ? { status: statusParam } : {}

    const claims = await PlayerProfileClaim.find(filter).sort({ createdAt: -1 }).limit(100).lean()
    const userIds = [...new Set(claims.map((c) => c.userId))]
    const playerIds = new Set<string>(claims.map((c) => c.targetPlayerId))

    const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }).lean() : []
    for (const u of users) {
      if (u.playerId) playerIds.add(u.playerId)
    }

    const [players, teams, careerDocs] = await Promise.all([
      playerIds.size > 0 ? Player.find({ _id: { $in: [...playerIds] } }).lean() : Promise.resolve([]),
      Team.find({}).lean(),
      playerIds.size > 0 ? PlayerCareerStat.find({ playerId: { $in: [...playerIds] } }).lean() : Promise.resolve([]),
    ])

    const userMap = new Map<string, any>(users.map((u: any) => [String(u._id), u] as [string, any]))
    const playerMap = new Map<string, any>((players as any[]).map((p: any) => [String(p._id), p] as [string, any]))
    const teamMap = new Map<string, any>(teams.map((t: any) => [String(t._id), t] as [string, any]))
    const careerMap = new Map<string, any>((careerDocs as any[]).map((c: any) => [String(c.playerId), c] as [string, any]))

    return sendOk(
      res,
      claims.map((c) => {
        const u = userMap.get(c.userId)
        const claimantPlayer = u?.playerId ? playerMap.get(u.playerId) : null
        const target = playerMap.get(c.targetPlayerId)
        const targetTeam = target?.teamId ? teamMap.get(target.teamId) : null
        const targetCareer = target ? careerMap.get(target._id) : null
        return {
          ...c,
          id: c._id,
          claimantUser: u
            ? { id: u._id, name: u.name, email: u.email, mobile: u.mobile, playerId: u.playerId }
            : null,
          claimantPlayer: claimantPlayer
            ? { id: claimantPlayer._id, playerCode: claimantPlayer.playerCode, name: claimantPlayer.name }
            : null,
          targetPlayer: target
            ? {
                id: target._id,
                playerCode: target.playerCode,
                name: target.name,
                role: target.role,
                status: target.status,
                isClaimed: target.isClaimed,
                team: targetTeam ? { id: targetTeam._id, name: targetTeam.name, shortName: targetTeam.shortName } : null,
                matches: targetCareer?.matches ?? 0,
                runs: targetCareer?.runs ?? 0,
                wickets: targetCareer?.wickets ?? 0,
              }
            : null,
        }
      })
    )
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load profile claims', 500)
  }
})

// POST /api/admin/claims/:id/resolve - Approve (merge historical stats) or reject a profile claim
router.post('/claims/:id/resolve', async (req, res) => {
  const admin = await requireAdmin(req)
  if (!admin) return unauthorized(res)
  ;(req as any).admin = admin

  try {
    await connectDB()
    const claim = await PlayerProfileClaim.findById(req.params.id)
    if (!claim) return sendFail(res, 'Claim request not found', 404)
    if (claim.status !== 'PENDING') {
      return sendFail(res, `Claim has already been resolved (${claim.status})`, 409)
    }

    const decision = String(req.body?.decision ?? '').trim().toUpperCase()
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      return sendFail(res, 'decision must be "APPROVE" or "REJECT"')
    }

    if (decision === 'REJECT') {
      claim.status = 'REJECTED'
      claim.reviewedBy = admin.username ?? 'admin'
      claim.reviewedAt = new Date()
      claim.rejectionReason = reason || 'Rejected by administrator'
      await claim.save()

      await writeAuditLog({
        action: 'CLAIM_PLAYER',
        actor: adminActor(req),
        playerId: claim.targetPlayerId,
        reason: `Claim rejected: ${claim.rejectionReason}`,
        metadata: { claimId: claim._id, status: 'REJECTED' },
      })

      return sendOk(res, { claim: claim.toObject(), mergeResult: null })
    }

    const [claimantUser, unclaimedPlayer] = await Promise.all([
      User.findById(claim.userId),
      Player.findById(claim.targetPlayerId),
    ])
    if (!claimantUser) return sendFail(res, 'Claimant user account not found', 404)
    if (!unclaimedPlayer) return sendFail(res, 'Target unclaimed player profile not found', 404)
    if (unclaimedPlayer.status !== 'ACTIVE' || unclaimedPlayer.isClaimed) {
      return sendFail(res, 'Target profile is already claimed or merged', 409)
    }

    let mergeResult: any = null
    if (claimantUser.playerId && claimantUser.playerId !== unclaimedPlayer._id) {
      // Keep the registered player profile and fold historical unclaimed records into it
      mergeResult = await mergePlayersAndRecalculate(
        unclaimedPlayer._id,
        claimantUser.playerId,
        adminActor(req),
        reason || `Approved player profile claim (${claim._id})`
      )
    } else {
      unclaimedPlayer.userId = claimantUser._id
      unclaimedPlayer.isClaimed = true
      await unclaimedPlayer.save()
      claimantUser.playerId = unclaimedPlayer._id
      await claimantUser.save()
      await recalculateStats(unclaimedPlayer._id, adminActor(req), 'Direct profile claim approval')
    }

    claim.status = 'APPROVED'
    claim.reviewedBy = admin.username ?? 'admin'
    claim.reviewedAt = new Date()
    claim.rejectionReason = null
    await claim.save()

    await writeAuditLog({
      action: 'CLAIM_PLAYER',
      actor: adminActor(req),
      playerId: claimantUser.playerId,
      sourcePlayerId: unclaimedPlayer._id,
      targetPlayerId: claimantUser.playerId,
      reason: reason || 'Approved OTP-verified profile claim',
      metadata: { claimId: claim._id, mergeResult },
    })

    return sendOk(res, { claim: claim.toObject(), mergeResult })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to resolve claim request', 500)
  }
})

// POST /api/admin/stats/recalculate - Rebuild verified match & career stats for one player or all players
router.post('/stats/recalculate', async (req, res) => {
  const admin = await requireAdmin(req)
  if (!admin) return unauthorized(res)
  ;(req as any).admin = admin

  try {
    await connectDB()
    const playerId = typeof req.body?.playerId === 'string' && req.body.playerId.trim() ? req.body.playerId.trim() : null
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Manual recalculation triggered from Admin Panel'
    const result = await recalculateStats(playerId, adminActor(req), reason)
    return sendOk(res, result)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Recalculation failed', 500)
  }
})

export default router
