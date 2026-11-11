import { Router } from 'express'
import { connectDB, Season } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import { ensureDefaultSeasonAndTournament } from '../lib/bootstrap'

const router = Router()

// GET /api/seasons - List all seasons
router.get('/', async (_req, res) => {
  try {
    await connectDB()
    await ensureDefaultSeasonAndTournament()
    const seasons = await Season.find({}).sort({ year: -1, createdAt: -1 }).lean()
    return sendOk(res, seasons.map((s) => ({ ...s, id: s._id })))
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load seasons', 500)
  }
})

// POST /api/seasons - Create a new season
router.post('/', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const body = req.body ?? {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const year = Math.floor(Number(body.year))
    if (!name) return sendFail(res, 'Season name is required')
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      return sendFail(res, 'Season year must be between 1990 and 2100')
    }

    const code = (typeof body.code === 'string' && body.code.trim() ? body.code.trim() : `S${year}`).toUpperCase()
    const exists = await Season.findOne({ code }).select({ _id: 1 }).lean()
    if (exists) return sendFail(res, `Season code ${code} already exists`, 409)

    const status = ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status) ? body.status : 'UPCOMING'
    const isDefault = Boolean(body.isDefault)
    if (isDefault) {
      await Season.updateMany({}, { $set: { isDefault: false } })
    }

    const created = await Season.create({
      name,
      code,
      year,
      status,
      isDefault,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    })

    return sendOk(res, created.toObject(), 201)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to create season', 500)
  }
})

// PATCH /api/seasons/:id - Update season details / status / default flag
router.patch('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    await connectDB()
    const season = await Season.findById(req.params.id)
    if (!season) return sendFail(res, 'Season not found', 404)

    const body = req.body ?? {}
    if (typeof body.name === 'string' && body.name.trim()) season.name = body.name.trim()
    if (body.status && ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status)) {
      season.status = body.status
    }
    if (body.startDate !== undefined) season.startDate = body.startDate ? new Date(body.startDate) : null
    if (body.endDate !== undefined) season.endDate = body.endDate ? new Date(body.endDate) : null
    if (body.isDefault === true) {
      await Season.updateMany({ _id: { $ne: season._id } }, { $set: { isDefault: false } })
      season.isDefault = true
    }

    await season.save()
    return sendOk(res, season.toObject())
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update season', 500)
  }
})

export default router

