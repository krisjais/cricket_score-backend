import { Router } from 'express'
import { db } from '../lib/db'
import { sendOk, sendFail } from '../lib/api-utils'
import { maxWicketsFor } from '../lib/cricket'

const router = Router()

export interface StandingsRow {
  teamId: string
  name: string
  shortName: string
  color: string
  logoUrl: string | null
  played: number
  won: number
  lost: number
  tied: number
  noResult: number
  points: number
  runsFor: number
  ballsFor: number
  runsAgainst: number
  ballsAgainst: number
  forDisplay: string
  againstDisplay: string
  nrr: number
  recentForm: ('W' | 'L' | 'T' | 'NR')[]
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

const oversStr = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`

// GET /api/standings - Dynamic Points Table calculated from MongoDB matches
router.get('/', async (_req, res) => {
  try {
    const [teams, matches] = await Promise.all([
      db.team.findMany({
        orderBy: { name: 'asc' },
        include: { players: { select: { id: true } } },
      }),
      db.match.findMany({
        orderBy: { createdAt: 'desc' },
        include: { innings: { include: { balls: true } } },
      }),
    ])

    const rows = new Map<string, StandingsRow>()
    const squadSizes = new Map<string, number>()

    for (const t of teams) {
      squadSizes.set(t.id, Array.isArray(t.players) ? t.players.length : 0)
      rows.set(t.id, {
        teamId: t.id,
        name: t.name,
        shortName: t.shortName,
        color: t.color || '#7A1426',
        logoUrl: t.logoUrl ?? null,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        points: 0,
        runsFor: 0,
        ballsFor: 0,
        runsAgainst: 0,
        ballsAgainst: 0,
        forDisplay: '0/0.0',
        againstDisplay: '0/0.0',
        nrr: 0,
        recentForm: [],
      })
    }

    for (const m of matches) {
      if (m.status !== 'COMPLETED' && m.status !== 'ABANDONED') continue

      const rowA = rows.get(m.teamAId)
      const rowB = rows.get(m.teamBId)
      if (!rowA || !rowB) continue

      rowA.played++
      rowB.played++

      if (m.status === 'ABANDONED') {
        rowA.noResult++
        rowB.noResult++
        rowA.points += 1
        rowB.points += 1
        rowA.recentForm.push('NR')
        rowB.recentForm.push('NR')
        continue
      }

      // COMPLETED match
      if (m.winnerId === m.teamAId) {
        rowA.won++
        rowA.points += 2
        rowB.lost++
        rowA.recentForm.push('W')
        rowB.recentForm.push('L')
      } else if (m.winnerId === m.teamBId) {
        rowB.won++
        rowB.points += 2
        rowA.lost++
        rowB.recentForm.push('W')
        rowA.recentForm.push('L')
      } else {
        // Tie
        rowA.tied++
        rowB.tied++
        rowA.points += 1
        rowB.points += 1
        rowA.recentForm.push('T')
        rowB.recentForm.push('T')
      }

      // Aggregate runs & overs for Net Run Rate (NRR)
      for (const inn of m.innings || []) {
        const batRow = rows.get(inn.battingTeamId)
        const bowlRow = rows.get(inn.bowlingTeamId)
        if (!batRow || !bowlRow) continue

        let runs = 0
        let wickets = 0
        let legal = 0
        for (const b of inn.balls || []) {
          runs += (b.runsOffBat ?? 0) + (b.extraRuns ?? 0)
          if (b.isWicket) wickets++
          if (b.isLegal) legal++
        }

        const batSquadSize = squadSizes.get(inn.battingTeamId) ?? 0
        const maxWkts = maxWicketsFor(batSquadSize)
        const allOut = batSquadSize > 1 && wickets >= maxWkts
        const nrrBalls = allOut ? Math.max(legal, m.totalOvers * 6) : legal

        batRow.runsFor += runs
        batRow.ballsFor += nrrBalls
        bowlRow.runsAgainst += runs
        bowlRow.ballsAgainst += nrrBalls
      }
    }

    const table = [...rows.values()].map((r) => {
      const rateFor = r.ballsFor > 0 ? r.runsFor / (r.ballsFor / 6) : 0
      const rateAgainst = r.ballsAgainst > 0 ? r.runsAgainst / (r.ballsAgainst / 6) : 0
      return {
        ...r,
        forDisplay: `${r.runsFor} (${oversStr(r.ballsFor)} ov)`,
        againstDisplay: `${r.runsAgainst} (${oversStr(r.ballsAgainst)} ov)`,
        nrr: r.ballsFor > 0 && r.ballsAgainst > 0 ? round3(rateFor - rateAgainst) : 0,
        recentForm: r.recentForm.slice(0, 5),
      }
    })

    table.sort(
      (a, b) =>
        b.points - a.points ||
        b.won - a.won ||
        b.nrr - a.nrr ||
        a.name.localeCompare(b.name)
    )

    return sendOk(res, table)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to calculate points table', 500)
  }
})

export default router
