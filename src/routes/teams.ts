import { Router } from 'express'
import { connectDB, db, Match, Player, Season, TeamMembership } from '../lib/db'
import { OFFICIAL_BOWLER_WICKETS } from '../lib/stats-service'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'

const router = Router()

// GET /api/teams - List all teams
router.get('/', async (_req, res) => {
  try {
    const teams = await db.team.findMany({
      orderBy: { name: 'asc' },
      include: { players: { orderBy: [{ jerseyNumber: 'asc' }, { name: 'asc' }] } },
    })
    return sendOk(res, teams)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to list teams', 500)
  }
})

// POST /api/teams - Create a team
router.post('/', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const body = req.body ?? {}
  const name = body.name?.trim()
  const shortName = body.shortName?.trim()

  if (!name) return sendFail(res, 'Team name is required')
  if (!shortName) return sendFail(res, 'Short name is required')
  if (shortName.length > 5) return sendFail(res, 'Short name must be 5 characters or fewer')

  const exists = await db.team.findUnique({ where: { name } })
  if (exists) return sendFail(res, 'A team with this name already exists')

  const team = await db.team.create({
    data: {
      name,
      shortName: shortName.toUpperCase(),
      color: body.color || '#0d3a24',
      logoUrl: body.logoUrl?.trim() || null,
      captain: body.captain?.trim() || null,
    },
  })
  return sendOk(res, team, 201)
})

// GET /api/teams/:id - Team detail with career stats (optionally scoped by seasonId)
router.get('/:id', async (req, res) => {
  try {
    await connectDB()
    const { id } = req.params
    const seasonIdQuery = typeof req.query.seasonId === 'string' && req.query.seasonId.trim() ? req.query.seasonId.trim() : null

    const team = await db.team.findUnique({
      where: { id },
      include: { players: { orderBy: [{ jerseyNumber: 'asc' }, { name: 'asc' }] } },
    })
    if (!team) return sendFail(res, 'Team not found', 404)

    let rosterPlayers: any[] = team.players.filter((p: any) => p.status !== 'MERGED')
    if (seasonIdQuery) {
      const memberships = await TeamMembership.find({ teamId: id, seasonId: seasonIdQuery }).lean()
      const memPlayerIds = memberships.map((m) => m.playerId)
      const memMap = new Map(memberships.map((m) => [m.playerId, m]))
      const docs = memPlayerIds.length > 0 ? await Player.find({ _id: { $in: memPlayerIds } }).lean() : []
      rosterPlayers = docs
        .sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.name.localeCompare(b.name))
        .map((p) => {
          const mem = memMap.get(p._id)
          return {
            ...p,
            id: p._id,
            membershipStatus: mem?.status ?? 'ACTIVE',
            designation: mem?.designation ?? 'PLAYER',
            joinedAt: mem?.joinedAt ?? null,
          }
        })
    }

    const playerIds = new Set(rosterPlayers.map((p) => p.id))
    let allowedMatchIds: Set<string> | null = null
    if (seasonIdQuery) {
      const seasonMatches = await Match.find({ seasonId: seasonIdQuery }).select({ _id: 1 }).lean()
      allowedMatchIds = new Set(seasonMatches.map((m) => m._id))
    }

    const allInnings = await db.innings.findMany({
      where: { OR: [{ battingTeamId: id }, { bowlingTeamId: id }] },
      include: { match: { select: { id: true, status: true } }, balls: true },
    })
    const innings = allowedMatchIds ? allInnings.filter((inn) => allowedMatchIds!.has(inn.matchId)) : allInnings

    const availableSeasons = await Season.find({}).sort({ year: -1 }).lean()

    interface Career {
      matches: number
      inningsBatted: number
      runs: number
      ballsFaced: number
      fours: number
      sixes: number
      highest: number
      notOuts: number
      oversBowled: number
      runsConceded: number
      wickets: number
    }

    const stats = new Map<string, Career>()
    const ensure = (pid: string): Career => {
      let s = stats.get(pid)
      if (!s) {
        s = {
          matches: 0,
          inningsBatted: 0,
          runs: 0,
          ballsFaced: 0,
          fours: 0,
          sixes: 0,
          highest: 0,
          notOuts: 0,
          oversBowled: 0,
          runsConceded: 0,
          wickets: 0,
        }
        stats.set(pid, s)
      }
      return s
    }

    for (const p of rosterPlayers) ensure(p.id)

    for (const inn of innings) {
      const batting = inn.battingTeamId === id
      const matchBalls = inn.balls
      const touched = new Set<string>()

      for (const b of matchBalls) {
        for (const pid of [b.strikerId, b.nonStrikerId, b.bowlerId, b.dismissedId, b.assistId]) {
          if (pid && playerIds.has(pid)) touched.add(pid)
        }
        if (batting && playerIds.has(b.strikerId)) {
          const s = ensure(b.strikerId)
          if (!b.extraType || b.extraType !== 'WIDE') s.ballsFaced++
          s.runs += b.runsOffBat
          if (b.runsOffBat === 4) s.fours++
          if (b.runsOffBat === 6) s.sixes++
        }
        if (!batting && playerIds.has(b.bowlerId)) {
          const s = ensure(b.bowlerId)
          if (b.isLegal) s.oversBowled++
          if (b.extraType === 'WIDE' || b.extraType === 'NO_BALL') {
            s.runsConceded += b.runsOffBat + b.extraRuns
          } else {
            s.runsConceded += b.runsOffBat
          }
          if (b.isWicket && OFFICIAL_BOWLER_WICKETS.has(b.wicketType || '')) {
            s.wickets++
          }
        }
      }

      for (const pid of touched) ensure(pid).matches++

      if (batting) {
        const battedInInnings = new Set<string>()
        const dismissedInInnings = new Set<string>()
        const runsPerPlayer = new Map<string, number>()

        for (const b of matchBalls) {
          for (const pid of [b.strikerId, b.nonStrikerId]) {
            if (playerIds.has(pid)) battedInInnings.add(pid)
          }
          if (b.isWicket && b.wicketType !== 'RETIRED_HURT' && b.wicketType !== 'ABSENT') {
            const d = b.dismissedId || b.strikerId
            if (playerIds.has(d)) dismissedInInnings.add(d)
          }
          if (playerIds.has(b.strikerId)) {
            runsPerPlayer.set(b.strikerId, (runsPerPlayer.get(b.strikerId) ?? 0) + b.runsOffBat)
          }
        }

        for (const pid of battedInInnings) {
          const s = ensure(pid)
          s.inningsBatted++
          const r = runsPerPlayer.get(pid) ?? 0
          s.highest = Math.max(s.highest, r)
          if (!dismissedInInnings.has(pid)) s.notOuts++
        }
      }
    }

    return sendOk(res, {
      ...team,
      players: rosterPlayers,
      selectedSeasonId: seasonIdQuery,
      seasons: availableSeasons.map((s) => ({ id: s._id, name: s.name, code: s.code, year: s.year, status: s.status })),
      stats: Object.fromEntries([...stats.entries()].filter(([pid]) => playerIds.has(pid))),
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to fetch team', 500)
  }
})

// PATCH /api/teams/:id - Update team
router.patch('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const team = await db.team.findUnique({ where: { id } })
  if (!team) return sendFail(res, 'Team not found', 404)

  const body = req.body ?? {}
  const name = body.name?.trim()

  if (name && name !== team.name) {
    const exists = await db.team.findUnique({ where: { name } })
    if (exists) return sendFail(res, 'A team with this name already exists')
  }

  const shortName = body.shortName?.trim()
  if (shortName && shortName.length > 5) {
    return sendFail(res, 'Short name must be 5 characters or fewer')
  }

  const updated = await db.team.update({
    where: { id },
    data: {
      name: name || team.name,
      shortName: shortName ? shortName.toUpperCase() : team.shortName,
      color: body.color || team.color,
      logoUrl: body.logoUrl !== undefined ? body.logoUrl?.trim() || null : team.logoUrl,
      captain: body.captain !== undefined ? body.captain?.trim() || null : team.captain,
    },
  })
  return sendOk(res, updated)
})

// DELETE /api/teams/:id - Delete team
router.delete('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const matchCount = await db.match.count({ where: { OR: [{ teamAId: id }, { teamBId: id }] } })
  if (matchCount > 0) {
    return sendFail(res, `Cannot delete: this team has ${matchCount} match(es). Delete its matches first.`)
  }

  await TeamMembership.deleteMany({ teamId: id })
  await Player.updateMany({ teamId: id }, { $set: { teamId: null } })
  await db.team.delete({ where: { id } })
  return sendOk(res, { deleted: true })
})

export default router
