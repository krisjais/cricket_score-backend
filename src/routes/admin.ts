import { Router } from 'express'
import { db } from '../lib/db'
import { requireAdmin } from '../lib/auth'
import { sendOk, sendFail, unauthorized } from '../lib/api-utils'
import { emitToRoom } from '../lib/broadcast'

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
    await notifyDeleted(matches.map((m) => m.id))
    return sendOk(res, { scope, matchesDeleted: matchCount, teamsDeleted: teamCount, playersDeleted: playerCount })
  }

  if (scope === 'matches') {
    const [matchCount, teams] = await Promise.all([db.match.count(), db.team.count()])
    const matches = await db.match.findMany({ select: { id: true } })
    await db.match.deleteMany()
    await notifyDeleted(matches.map((m) => m.id))
    return sendOk(res, { scope, matchesDeleted: matchCount, teamsDeleted: 0, playersDeleted: 0, teamsKept: teams })
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

export default router
