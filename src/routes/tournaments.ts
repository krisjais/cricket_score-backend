import { Router } from 'express'
import { connectDB, Season, Tournament } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import { ensureDefaultSeasonAndTournament } from '../lib/bootstrap'

const router = Router()

// GET /api/tournaments - List tournaments (optional seasonId filter)
router.get('/', async (req, res) => {
  try {
    await connectDB()
    await ensureDefaultSeasonAndTournament()
    const where: Record<string, any> = {}
    if (typeof req.query.seasonId === 'string' && req.query.seasonId) {
      where.seasonId = req.query.seasonId
    }
    const [tournaments, seasons] = await Promise.all([
      Tournament.find(where).sort({ createdAt: -1 }).lean(),
      Season.find({}).lean(),
    ])
    const sMap = new Map(seasons.map((s) => [s._id, s]))
    return sendOk(
      res,
      tournaments.map((t) => {
        const s = sMap.get(t.seasonId)
        return {
          ...t,
          id: t._id,
          season: s ? { id: s._id, name: s.name, year: s.year, code: s.code, status: s.status } : null,
        }
      })
    )
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load tournaments', 500)
  }
})

// POST /api/tournaments - Create tournament
router.post('/', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const body = req.body ?? {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const seasonId = String(body.seasonId ?? '').trim()
    if (!name) return sendFail(res, 'Tournament name is required')
    if (!seasonId) return sendFail(res, 'Season ID is required')

    const season = await Season.findById(seasonId).lean()
    if (!season) return sendFail(res, 'Season not found', 404)

    const shortName = (
      typeof body.shortName === 'string' && body.shortName.trim()
        ? body.shortName.trim()
        : name.slice(0, 8)
    ).toUpperCase()
    const format = ['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format) ? body.format : 'T20'
    const status = ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status) ? body.status : 'UPCOMING'

    const created = await Tournament.create({
      name,
      shortName,
      seasonId,
      format,
      status,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    })

    return sendOk(res, created.toObject(), 201)
  } catch (err: any) {
    if (err?.code === 11000) return sendFail(res, 'Tournament with this name already exists in this season', 409)
    return sendFail(res, err?.message || 'Failed to create tournament', 500)
  }
})

// PATCH /api/tournaments/:id
router.patch('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const t = await Tournament.findById(req.params.id)
    if (!t) return sendFail(res, 'Tournament not found', 404)

    const body = req.body ?? {}
    if (typeof body.name === 'string' && body.name.trim()) t.name = body.name.trim()
    if (typeof body.shortName === 'string' && body.shortName.trim()) t.shortName = body.shortName.trim().toUpperCase()
    if (body.format && ['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format)) t.format = body.format
    if (body.status && ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status)) t.status = body.status
    if (body.winnerTeamId !== undefined) t.winnerTeamId = body.winnerTeamId || null
    await t.save()

    return sendOk(res, t.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update tournament', 500)
  }
})

export default router

