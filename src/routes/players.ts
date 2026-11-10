import { Router } from 'express'
import { db } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'

const router = Router()

function parseGender(input?: string | null): 'MALE' | 'FEMALE' {
  const s = (input ?? '').trim().toLowerCase()
  if (s === 'female' || s === 'f' || s === 'woman' || s === 'women' || s.startsWith('fem')) {
    return 'FEMALE'
  }
  return 'MALE'
}

// GET /api/players - List players (optionally by teamId)
router.get('/', async (req, res) => {
  try {
    const teamId = req.query.teamId as string | undefined
    const players = await db.player.findMany({
      where: teamId ? { teamId } : undefined,
      orderBy: [{ teamId: 'asc' }, { jerseyNumber: 'asc' }, { name: 'asc' }],
      include: { team: { select: { id: true, name: true, shortName: true } } },
    })
    return sendOk(res, players)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to list players', 500)
  }
})

// POST /api/players - Create a player
router.post('/', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const body = req.body ?? {}
  const name = body.name?.trim()

  if (!name) return sendFail(res, 'Player name is required')

  let teamId: string | null = null
  if (body.teamId && body.teamId !== 'none' && body.teamId !== 'unassigned') {
    const team = await db.team.findUnique({ where: { id: body.teamId } })
    if (!team) return sendFail(res, 'Team not found', 404)
    teamId = body.teamId
  }

  const role = body.role && ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)
    ? body.role
    : 'ALL_ROUNDER'

  const gender = parseGender(body.gender)

  const jerseyNumber =
    body.jerseyNumber !== undefined && body.jerseyNumber !== null && !Number.isNaN(Number(body.jerseyNumber))
      ? Math.floor(Number(body.jerseyNumber))
      : null

  const avatarUrl = body.avatarUrl?.trim() || null

  const player = await db.player.create({ data: { teamId, name, role, gender, jerseyNumber, avatarUrl } })
  return sendOk(res, player, 201)
})

// PATCH /api/players/:id - Update player
router.patch('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const player = await db.player.findUnique({ where: { id } })
  if (!player) return sendFail(res, 'Player not found', 404)

  const body = req.body ?? {}
  const role =
    body.role && ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)
      ? body.role
      : player.role

  const gender = body.gender !== undefined ? parseGender(body.gender) : (player.gender || 'MALE')

  const jerseyNumber =
    body.jerseyNumber === undefined
      ? player.jerseyNumber
      : body.jerseyNumber === null || Number.isNaN(Number(body.jerseyNumber))
        ? null
        : Math.floor(Number(body.jerseyNumber))

  let targetTeamId = player.teamId
  if (body.teamId !== undefined) {
    if (body.teamId && body.teamId !== 'none' && body.teamId !== 'unassigned') {
      const team = await db.team.findUnique({ where: { id: body.teamId } })
      if (!team) return sendFail(res, 'Team not found', 404)
      targetTeamId = body.teamId
    } else {
      targetTeamId = null
    }
  }

  const avatarUrl = body.avatarUrl !== undefined ? body.avatarUrl?.trim() || null : player.avatarUrl

  const updated = await db.player.update({
    where: { id },
    data: {
      name: body.name?.trim() || player.name,
      role,
      gender,
      jerseyNumber,
      teamId: targetTeamId,
      avatarUrl,
    },
  })
  return sendOk(res, updated)
})

async function handleDeleteAllPlayers(req: any, res: any) {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const force = req.query.force === 'true' || req.body?.force === true
  if (!force) {
    const ballsCount = await db.ball.count()
    if (ballsCount > 0) {
      return sendFail(
        res,
        `Cannot delete players: ${ballsCount} delivery events are currently recorded in matches. Reset match history first or confirm force deletion.`
      )
    }
  }

  const result = await db.player.deleteMany({})
  return sendOk(res, { deletedCount: result.count })
}

// DELETE /api/players/all - Delete all players
router.delete('/all', handleDeleteAllPlayers)

// DELETE /api/players - Delete all players (bulk collection deletion)
router.delete('/', handleDeleteAllPlayers)

// DELETE /api/players/:id - Delete single player
router.delete('/:id', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  const { id } = req.params
  const used = await db.ball.count({
    where: { OR: [{ strikerId: id }, { nonStrikerId: id }, { bowlerId: id }, { dismissedId: id }, { assistId: id }] },
  })
  if (used > 0) {
    return sendFail(
      res,
      `Cannot delete: this player has recorded deliveries in ${used} ball event(s). Remove the match history first.`
    )
  }

  await db.player.delete({ where: { id } })
  return sendOk(res, { deleted: true })
})

// Helper to parse CSV string into objects
function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const parseRow = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const rawHeaders = parseRow(lines[0])
  const headers = rawHeaders.map((h) => h.replace(/^["']|["']$/g, '').trim())

  const records: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i])
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue
    const rec: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j]
      const val = (values[j] ?? '').replace(/^["']|["']$/g, '').trim()
      rec[h] = val
    }
    records.push(rec)
  }
  return records
}

function parseSkillToRole(skills?: string): 'BATTER' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKETKEEPER' {
  if (!skills) return 'BATTER'
  const s = skills.toLowerCase()
  if (s.includes('wicket') || s.includes('keeper') || s.includes('wk')) return 'WICKETKEEPER'
  if (s.includes('all') || s.includes('all-rounder') || s.includes('all rounder')) return 'ALL_ROUNDER'
  if (s.includes('bowl')) return 'BOWLER'
  if (s.includes('bat') || s.includes('batsman')) return 'BATTER'
  return 'BATTER'
}

function generateShortCode(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9\s]/g, '')
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const letters = words.map((w) => w[0].toUpperCase()).join('')
    return letters.slice(0, 5)
  }
  return clean.slice(0, 4).toUpperCase() || 'TEAM'
}

// POST /api/players/import - Bulk import players from CSV or array
router.post('/import', async (req, res) => {
  const session = await requireAdmin(req)
  if (!session) return unauthorized(res)

  try {
    const body = req.body ?? {}
    const autoCreateTeams = body.autoCreateTeams !== false
    let rawItems: any[] = []

    if (typeof body.rawCsv === 'string' && body.rawCsv.trim()) {
      const parsed = parseCSV(body.rawCsv)
      rawItems = parsed.map((row) => ({
        name: row['Name'] || row['name'] || row['Player Name'] || '',
        skills: row['Skills'] || row['skills'] || row['Role'] || '',
        gender: row['Gender'] || row['gender'] || row['Category'] || row['category'] || '',
        soldTo: row['Sold To'] || row['sold to'] || row['Team'] || row['team'] || '',
        photoUrl: row['Photo URL'] || row['photo url'] || row['Photo'] || row['avatarUrl'] || '',
        jerseyNumber: row['Jersey Number'] || row['Jersey'] || row['jerseyNumber'] || null,
      }))
    } else if (Array.isArray(body.players)) {
      rawItems = body.players
    } else {
      return sendFail(res, 'Please provide either rawCsv string or players array')
    }

    if (rawItems.length === 0) {
      return sendFail(res, 'No valid player rows found in the import data')
    }

    // Load existing teams to match by name
    const existingTeams = await db.team.findMany()
    const teamMap = new Map<string, any>()
    for (const t of existingTeams) {
      teamMap.set(t.name.toLowerCase().trim(), t)
      teamMap.set(t.shortName.toLowerCase().trim(), t)
    }

    let createdTeamsCount = 0
    const newTeamNames: string[] = []

    // Pre-create any missing teams if autoCreateTeams is true
    if (autoCreateTeams) {
      const distinctTeamNames = new Set<string>()
      for (const item of rawItems) {
        const teamName = (item.soldTo || item.team || '').trim()
        if (teamName && !teamMap.has(teamName.toLowerCase())) {
          distinctTeamNames.add(teamName)
        }
      }

      for (const tName of distinctTeamNames) {
        let short = generateShortCode(tName)
        // Ensure unique short code
        let counter = 1
        let candidate = short
        while ([...teamMap.values()].some((t) => t.shortName === candidate)) {
          candidate = `${short.slice(0, 3)}${counter}`
          counter++
        }
        short = candidate

        const newTeam = await db.team.create({
          data: {
            name: tName,
            shortName: short,
            color: '#0d3a24',
          },
        })
        teamMap.set(tName.toLowerCase(), newTeam)
        teamMap.set(short.toLowerCase(), newTeam)
        createdTeamsCount++
        newTeamNames.push(tName)
      }
    }

    // Load existing players to prevent duplicates & backfill gender on re-import
    const existingPlayers = await db.player.findMany()
    const existingMap = new Map<string, any>()
    for (const p of existingPlayers) {
      existingMap.set(`${p.name.toLowerCase().trim()}::${p.teamId || ''}`, p)
    }

    // Insert or update players
    let createdCount = 0
    let updatedCount = 0
    for (const item of rawItems) {
      const name = (item.name || '').trim()
      if (!name) continue

      const teamName = (item.soldTo || item.team || '').trim()
      let teamId: string | null = null
      if (teamName && teamMap.has(teamName.toLowerCase())) {
        teamId = teamMap.get(teamName.toLowerCase()).id
      }

      const role = parseSkillToRole(item.skills || item.role)
      const gender = parseGender(item.gender)
      const avatarUrl = (item.photoUrl || item.avatarUrl || '').trim() || null
      const jNum =
        item.jerseyNumber !== undefined && item.jerseyNumber !== null && !Number.isNaN(Number(item.jerseyNumber))
          ? Math.floor(Number(item.jerseyNumber))
          : null

      const key = `${name.toLowerCase()}::${teamId || ''}`
      const existing = existingMap.get(key)
      if (existing) {
        await db.player.update({
          where: { id: existing.id },
          data: {
            role,
            gender,
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(jNum !== null ? { jerseyNumber: jNum } : {}),
          },
        })
        updatedCount++
      } else {
        const created = await db.player.create({
          data: {
            name,
            role,
            gender,
            jerseyNumber: jNum,
            teamId,
            avatarUrl,
          },
        })
        existingMap.set(key, created)
        createdCount++
      }
    }

    const totalCount = await db.player.count()
    return sendOk(res, {
      importedCount: createdCount + updatedCount,
      createdCount,
      updatedCount,
      teamsCreated: createdTeamsCount,
      createdTeamNames: newTeamNames,
      totalPlayers: totalCount,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to import players', 500)
  }
})

export default router
