import { Router } from 'express'
import { db } from '../lib/db'
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

// GET /api/teams/:id - Team detail with career stats
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const team = await db.team.findUnique({
      where: { id },
      include: { players: { orderBy: [{ jerseyNumber: 'asc' }, { name: 'asc' }] } },
    })
    if (!team) return sendFail(res, 'Team not found', 404)

    const playerIds = new Set(team.players.map((p) => p.id))
    const innings = await db.innings.findMany({
      where: { OR: [{ battingTeamId: id }, { bowlingTeamId: id }] },
      include: { match: { select: { id: true, status: true } }, balls: true },
    })

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

    for (let i = 0; i < team.players.length; i++) ensure(team.players[i].id)

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
          if (
            b.isWicket &&
            ['BOWLED', 'CAUGHT', 'CAUGHT_AND_BOWLED', 'LBW', 'STUMPED', 'HIT_WICKET'].includes(
              b.wicketType || ''
            )
          ) {
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
          if (b.isWicket) {
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

  await db.team.delete({ where: { id } })
  return sendOk(res, { deleted: true })
})

export default router
