import 'dotenv/config'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'

import {
  connectDB,
  Admin,
  User,
  Player,
  Team,
  Season,
  Tournament,
  Match,
  TeamMembership,
  CaptaincyAssignment,
  CaptaincyAuditLog,
  TeamAnnouncement,
  PlayingXISubmission,
  PlayerAvailability,
} from '../src/lib/db'
import { ADMIN_COOKIE, createSessionToken, ensureDefaultAdmin } from '../src/lib/auth'
import { createPlayerAccessToken, PLAYER_ACCESS_COOKIE } from '../src/lib/player-auth'
import { ensurePlayerSystemBootstrap } from '../src/lib/bootstrap'

import authRouter from '../src/routes/auth'
import playerAuthRouter from '../src/routes/player-auth'
import matchesRouter from '../src/routes/matches'
import playersRouter from '../src/routes/players'
import teamsRouter from '../src/routes/teams'
import adminRouter from '../src/routes/admin'
import awardsRouter from '../src/routes/awards'
import standingsRouter from '../src/routes/standings'
import seasonsRouter from '../src/routes/seasons'
import tournamentsRouter from '../src/routes/tournaments'
import membershipsRouter from '../src/routes/memberships'
import leaderboardsRouter from '../src/routes/leaderboards'
import captainsRouter from '../src/routes/captains'

interface HttpRes {
  status: number
  json: any
  setCookies: string[]
}

function cookieValue(setCookies: string[], name: string): string | null {
  for (const line of setCookies) {
    const first = line.split(';')[0]
    const eq = first.indexOf('=')
    if (eq > 0 && first.slice(0, eq).trim() === name) {
      return decodeURIComponent(first.slice(eq + 1))
    }
  }
  return null
}

async function api(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  cookieHeader?: string
): Promise<HttpRes> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return { status: res.status, json, setCookies }
}

async function run() {
  console.log('Connecting to database...')
  await connectDB()
  await CaptaincyAssignment.syncIndexes()
  await ensureDefaultAdmin()
  await ensurePlayerSystemBootstrap()

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())
  app.use('/api/auth', authRouter)
  app.use('/api/player-auth', playerAuthRouter)
  app.use('/api/matches', matchesRouter)
  app.use('/api/players', playersRouter)
  app.use('/api/teams', teamsRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/awards', awardsRouter)
  app.use('/api/standings', standingsRouter)
  app.use('/api/seasons', seasonsRouter)
  app.use('/api/tournaments', tournamentsRouter)
  app.use('/api/memberships', membershipsRouter)
  app.use('/api/leaderboards', leaderboardsRouter)
  app.use('/api/captains', captainsRouter)

  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${addr.port}`

  const defaultAdmin = await Admin.findOne({ username: 'admin' }).lean()
  const adminToken = await createSessionToken(defaultAdmin ? defaultAdmin._id : 'test-admin', 'admin')
  const adminCookie = `${ADMIN_COOKIE}=${encodeURIComponent(adminToken)}`

  const stamp = Date.now()
  const tracked = {
    userIds: [] as string[],
    playerIds: [] as string[],
    teamIds: [] as string[],
    seasonIds: [] as string[],
    tournamentIds: [] as string[],
    matchIds: [] as string[],
    assignmentIds: [] as string[],
    announcementIds: [] as string[],
  }

  try {
    console.log('\n--- Setup Test Data ---')
    // 1. Create Season 1 (2025)
    const season1 = await Season.create({
      name: `NPL Season 2025 (${stamp})`,
      code: `S25_${stamp}`,
      year: 2025,
      status: 'ACTIVE',
      isDefault: false,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    })
    tracked.seasonIds.push(season1._id)

    // 2. Create Teams
    const team1 = await Team.create({
      name: `Nex-Bitz ${stamp}`,
      shortName: 'NXB',
      color: '#7A1426',
    })
    tracked.teamIds.push(team1._id)

    const team2 = await Team.create({
      name: `Mavericks ${stamp}`,
      shortName: 'MAV',
      color: '#2563EB',
    })
    tracked.teamIds.push(team2._id)

    // 3. Create Players & Users
    // Player 1: Taha (Will be Captain P1)
    const p1 = await Player.create({
      name: `Taha Choudhary ${stamp}`,
      role: 'ALL_ROUNDER',
      battingStyle: 'RIGHT_HAND',
      bowlingStyle: 'RIGHT_ARM_FAST',
      isVerified: true,
    })
    tracked.playerIds.push(p1._id)

    const u1 = await User.create({
      email: `taha.${stamp}@test.local`,
      name: p1.name,
      passwordHash: 'hash',
      role: 'PLAYER',
      playerId: p1._id,
      emailVerified: true,
      isActive: true,
    })
    tracked.userIds.push(u1._id)
    p1.userId = u1._id
    await p1.save()

    // Player 2: Hammad (Will be Replacement Captain P2)
    const p2 = await Player.create({
      name: `Hammad Choudhary ${stamp}`,
      role: 'BATTER',
      battingStyle: 'RIGHT_HAND',
      isVerified: true,
    })
    tracked.playerIds.push(p2._id)

    const u2 = await User.create({
      email: `hammad.${stamp}@test.local`,
      name: p2.name,
      passwordHash: 'hash',
      role: 'PLAYER',
      playerId: p2._id,
      emailVerified: true,
      isActive: true,
    })
    tracked.userIds.push(u2._id)
    p2.userId = u2._id
    await p2.save()

    // Squad memberships for Season 1: Both in Team 1
    const m1 = await TeamMembership.create({
      playerId: p1._id,
      teamId: team1._id,
      seasonId: season1._id,
      joinedAt: new Date(),
      status: 'ACTIVE',
      designation: 'PLAYER',
    })

    const m2 = await TeamMembership.create({
      playerId: p2._id,
      teamId: team1._id,
      seasonId: season1._id,
      joinedAt: new Date(),
      status: 'ACTIVE',
      designation: 'PLAYER',
    })

    // Player session tokens
    const p1Token = await createPlayerAccessToken({
      userId: u1._id,
      playerId: p1._id,
      playerCode: p1.playerCode,
      role: 'PLAYER',
    })
    const p1Cookie = `${PLAYER_ACCESS_COOKIE}=${encodeURIComponent(p1Token)}`

    const p2Token = await createPlayerAccessToken({
      userId: u2._id,
      playerId: p2._id,
      playerCode: p2.playerCode,
      role: 'PLAYER',
    })
    const p2Cookie = `${PLAYER_ACCESS_COOKIE}=${encodeURIComponent(p2Token)}`

    // =========================================================================
    // Scenario 1: Normal player login -> no Captain's Corner
    // =========================================================================
    console.log('\n[Scenario 1] Normal player login -> no Captain\'s Corner');
    const s1Dash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie)
    assert.equal(s1Dash.status, 200)
    assert.equal(s1Dash.json.data.activeCaptaincy, null)

    const s1Status = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie)
    assert.equal(s1Status.status, 200)
    assert.equal(s1Status.json.data.isCaptain, false)

    // Captain endpoints must reject normal player
    const s1Forbidden = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie)
    assert.equal(s1Forbidden.status, 403, 'Normal player must be denied access to captain team squad')
    console.log('✔ Normal player correctly sees no Captain\'s Corner and is denied captain routes (403)');

    // =========================================================================
    // Scenario 2: Admin appoints player as captain
    // =========================================================================
    console.log('\n[Scenario 2] Admin appoints player as captain');
    const assignRes = await api(
      baseUrl,
      'POST',
      '/api/captains/admin/assign',
      {
        seasonId: season1._id,
        teamId: team1._id,
        playerId: p1._id,
        notes: 'Official 2025 Captain',
      },
      adminCookie
    )
    assert.ok(assignRes.status === 200 || assignRes.status === 201, `Assign captain failed: ${JSON.stringify(assignRes.json)}`)
    assert.equal(assignRes.json.data.status, 'active')
    assert.equal(assignRes.json.data.playerId, p1._id)
    assert.equal(assignRes.json.data.teamId, team1._id)
    tracked.assignmentIds.push(assignRes.json.data.id)

    // Verify audit log
    const auditLogsRes = await api(
      baseUrl,
      'GET',
      `/api/captains/admin/audit-logs?seasonId=${season1._id}&teamId=${team1._id}`,
      undefined,
      adminCookie
    )
    assert.equal(auditLogsRes.status, 200)
    const logs = auditLogsRes.json.data
    assert.ok(logs.length >= 1)
    assert.equal(logs[0].action, 'ASSIGN')
    assert.equal(logs[0].newCaptainId, p1._id)
    console.log('✔ Admin successfully appointed captain with audit log record');

    // =========================================================================
    // Scenario 3: Player sees Captain's Corner and Captain badge
    // =========================================================================
    console.log('\n[Scenario 3] Player sees Captain\'s Corner and Captain badge');
    const p1Me = await api(baseUrl, 'GET', '/api/player-auth/me', undefined, p1Cookie)
    assert.equal(p1Me.status, 200)
    assert.equal(p1Me.json.data.activeCaptaincy.isCaptain, true)
    assert.equal(p1Me.json.data.activeCaptaincy.team.id, team1._id)

    const p1Dash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie)
    assert.equal(p1Dash.status, 200)
    assert.equal(p1Dash.json.data.activeCaptaincy.isCaptain, true)
    assert.equal(p1Dash.json.data.activeCaptaincy.team.name, team1.name)

    // Check badges in dashboard achievements
    const badges = p1Dash.json.data.achievements
    const currentCaptainBadge = badges.find((b: any) => b.key === 'CURRENT_CAPTAIN' || b.id === 'CURRENT_CAPTAIN')
    assert.ok(currentCaptainBadge, 'Expected CURRENT_CAPTAIN badge in achievements')

    // Public profile
    const p1Pub = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`)
    assert.equal(p1Pub.status, 200)
    assert.equal(p1Pub.json.data.activeCaptaincy.isCaptain, true)
    const pubBadge = p1Pub.json.data.captainBadges.find((b: any) => b.key === 'CURRENT_CAPTAIN')
    assert.ok(pubBadge, 'Expected CURRENT_CAPTAIN badge in public profile')
    console.log('✔ Captain sees active Captain\'s Corner, active status, and CURRENT_CAPTAIN badge');

    // =========================================================================
    // Scenario 4: Captain manages squad, fixtures, Playing XI, availability, announcements
    // =========================================================================
    console.log('\n[Scenario 4] Captain manages squad, fixtures, Playing XI, availability, announcements');
    // Team squad
    const squadRes = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie)
    assert.equal(squadRes.status, 200)
    assert.ok(squadRes.json.data.length >= 2, 'Squad should contain both P1 and P2')

    // Create tournament and match
    const tourn = await Tournament.create({
      name: `NPL Championship ${stamp}`,
      shortName: `CHP${String(stamp).slice(-4)}`,
      format: 'T20',
      status: 'ACTIVE',
      seasonId: season1._id,
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-03-15'),
    })
    tracked.tournamentIds.push(tourn._id)

    const match = await Match.create({
      tournamentId: tourn._id,
      seasonId: season1._id,
      teamAId: team1._id,
      teamBId: team2._id,
      format: 'T20',
      totalOvers: 20,
      status: 'SCHEDULED',
      venue: 'Nexcore Stadium',
      matchDate: new Date('2025-03-05T14:00:00Z'),
    })
    tracked.matchIds.push(match._id)

    // Team fixtures
    const fixRes = await api(baseUrl, 'GET', '/api/captains/fixtures', undefined, p1Cookie)
    assert.equal(fixRes.status, 200)
    assert.ok(fixRes.json.data.some((f: any) => f.id === match._id))

    // Captain creates announcement
    const annRes = await api(
      baseUrl,
      'POST',
      '/api/captains/announcements',
      {
        title: 'Team Strategy Meeting',
        content: 'Meeting at 6 PM sharp on Google Meet.',
        priority: 'URGENT',
        category: 'MEETING',
      },
      p1Cookie
    )
    assert.equal(annRes.status, 201)
    tracked.announcementIds.push(annRes.json.data.id)

    // Squad member P2 views announcements
    const playerAnnRes = await api(baseUrl, 'GET', '/api/captains/player-announcements', undefined, p2Cookie)
    assert.equal(playerAnnRes.status, 200)
    const pAnnList = Array.isArray(playerAnnRes.json.data)
      ? playerAnnRes.json.data
      : playerAnnRes.json.data.announcements
    assert.ok(pAnnList.some((a: any) => a.id === annRes.json.data.id))

    // Captain saves draft Playing XI
    const lineupDraft = await api(
      baseUrl,
      'POST',
      `/api/captains/lineup/${match._id}`,
      {
        playingXI: [p1._id, p2._id],
        substitutes: [],
        notes: 'P1 and P2 leading the XI',
      },
      p1Cookie
    )
    assert.equal(lineupDraft.status, 200)
    assert.equal(lineupDraft.json.data.status, 'DRAFT')

    // Player P2 marks availability
    const availRes = await api(
      baseUrl,
      'POST',
      `/api/captains/player-availability/${match._id}`,
      {
        status: 'AVAILABLE',
        note: 'Ready to open batting',
      },
      p2Cookie
    )
    assert.equal(availRes.status, 200)

    // Captain views team availability
    const captAvailRes = await api(baseUrl, 'GET', `/api/captains/availability/${match._id}`, undefined, p1Cookie)
    assert.equal(captAvailRes.status, 200)
    assert.equal(captAvailRes.json.data.summary.availableCount, 1)

    // Captain views team performance
    const perfRes = await api(baseUrl, 'GET', '/api/captains/performance', undefined, p1Cookie)
    assert.equal(perfRes.status, 200)
    assert.ok(perfRes.json.data !== null, 'Performance stats should be returned')
    console.log('✔ Captain successfully managed squad, fixtures, Playing XI, availability, and announcements');

    // =========================================================================
    // Scenario 5: Admin replaces captain
    // =========================================================================
    console.log('\n[Scenario 5] Admin replaces captain');
    const replaceRes = await api(
      baseUrl,
      'POST',
      '/api/captains/admin/replace',
      {
        seasonId: season1._id,
        teamId: team1._id,
        newPlayerId: p2._id,
        notes: 'Tactical captaincy change mid-season',
      },
      adminCookie
    )
    assert.equal(replaceRes.status, 200, `Replace captain failed: ${JSON.stringify(replaceRes.json)}`)
    assert.equal(replaceRes.json.data.playerId, p2._id)
    assert.equal(replaceRes.json.data.status, 'active')
    tracked.assignmentIds.push(replaceRes.json.data.id)

    // Verify audit log has REPLACE action
    const replaceAudit = await api(
      baseUrl,
      'GET',
      `/api/captains/admin/audit-logs?seasonId=${season1._id}&teamId=${team1._id}`,
      undefined,
      adminCookie
    )
    assert.equal(replaceAudit.status, 200)
    const replaceLog = replaceAudit.json.data.find((l: any) => l.action === 'REPLACE')
    assert.ok(replaceLog, 'Expected REPLACE audit log')
    assert.equal(replaceLog.previousCaptainId, p1._id)
    assert.equal(replaceLog.newCaptainId, p2._id)
    console.log('✔ Admin replaced captain, recorded audit log with previous and new captain IDs');

    // =========================================================================
    // Scenario 6: Previous captain loses captain permissions immediately
    // =========================================================================
    console.log('\n[Scenario 6] Previous captain loses captain permissions immediately');
    const p1StatusAfter = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie)
    assert.equal(p1StatusAfter.status, 200)
    assert.equal(p1StatusAfter.json.data.isCaptain, false)

    const p1SquadAfter = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie)
    assert.equal(p1SquadAfter.status, 403, 'Previous captain must be denied access to captain team squad (403)')

    const p1PostAnnAfter = await api(
      baseUrl,
      'POST',
      '/api/captains/announcements',
      { title: 'Test', content: 'Not allowed' },
      p1Cookie
    )
    assert.equal(p1PostAnnAfter.status, 403, 'Previous captain must be denied posting announcements (403)')
    console.log('✔ Previous captain immediately lost all captain permissions (403)');

    // =========================================================================
    // Scenario 7: Previous captain retains historical captaincy records
    // =========================================================================
    console.log('\n[Scenario 7] Previous captain retains historical captaincy records');
    const p1DashAfter = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie)
    assert.equal(p1DashAfter.status, 200)
    assert.equal(p1DashAfter.json.data.activeCaptaincy, null)
    assert.ok(p1DashAfter.json.data.captaincyHistory.length >= 1)
    const prevTenure = p1DashAfter.json.data.captaincyHistory[0]
    assert.equal(prevTenure.teamId, team1._id)
    assert.equal(prevTenure.status, 'completed')
    assert.ok(prevTenure.endedAt !== null)

    // Check FORMER_CAPTAIN badge
    const p1PubAfter = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`)
    assert.equal(p1PubAfter.status, 200)
    assert.equal(p1PubAfter.json.data.activeCaptaincy, null)
    const formerBadge = p1PubAfter.json.data.captainBadges.find((b: any) => b.key === 'FORMER_CAPTAIN')
    assert.ok(formerBadge, 'Expected FORMER_CAPTAIN badge for player with completed tenure')
    console.log('✔ Previous captain permanently retains tenure history and has FORMER_CAPTAIN badge');

    // =========================================================================
    // Scenario 8: New captain receives captain permissions
    // =========================================================================
    console.log('\n[Scenario 8] New captain receives captain permissions');
    const p2Status = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p2Cookie)
    assert.equal(p2Status.status, 200)
    assert.equal(p2Status.json.data.isCaptain, true)
    assert.equal(p2Status.json.data.teamId, team1._id)

    const p2Squad = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie)
    assert.equal(p2Squad.status, 200)
    assert.ok(p2Squad.json.data.length >= 2)
    console.log('✔ New captain received full captain permissions immediately');

    // =========================================================================
    // Scenario 9: Season completes -> active captaincy auto-expires
    // =========================================================================
    console.log('\n[Scenario 9] Season completes -> active captaincy auto-expires');
    const completeSeasonRes = await api(
      baseUrl,
      'PATCH',
      `/api/seasons/${season1._id}`,
      { status: 'COMPLETED' },
      adminCookie
    )
    assert.equal(completeSeasonRes.status, 200)

    const p2StatusAfterSeasonEnd = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p2Cookie)
    assert.equal(p2StatusAfterSeasonEnd.status, 200)
    assert.equal(p2StatusAfterSeasonEnd.json.data.isCaptain, false, 'Captaincy must auto-expire on completed season')

    const p2SquadAfter = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie)
    assert.equal(p2SquadAfter.status, 403, 'Expired captain must be denied access (403)')
    console.log('✔ Season completion auto-expired active captaincy permissions');

    // =========================================================================
    // Scenario 10: Previous captain participates as normal player in new season
    // =========================================================================
    console.log('\n[Scenario 10] Previous captain participates as normal player in new season');
    const season2 = await Season.create({
      name: `NPL Season 2026 (${stamp})`,
      code: `S26_${stamp}`,
      year: 2026,
      status: 'ACTIVE',
      isDefault: false,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    })
    tracked.seasonIds.push(season2._id)

    // Add P1 to Team 2 in Season 2 as normal player
    const m3 = await TeamMembership.create({
      playerId: p1._id,
      teamId: team2._id,
      seasonId: season2._id,
      joinedAt: new Date(),
      status: 'ACTIVE',
      designation: 'PLAYER',
    })

    const p1InSeason2 = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie)
    assert.equal(p1InSeason2.status, 200)
    assert.equal(p1InSeason2.json.data.activeCaptaincy, null)
    assert.equal(p1InSeason2.json.data.captaincyHistory.length, 1)
    console.log('✔ Player participates as normal player in new season with past captaincy history intact');

    // =========================================================================
    // Scenario 11: Player becomes captain of different team in future season
    // =========================================================================
    console.log('\n[Scenario 11] Player becomes captain of different team in future season -> both records preserved');
    const assign2Res = await api(
      baseUrl,
      'POST',
      '/api/captains/admin/assign',
      {
        seasonId: season2._id,
        teamId: team2._id,
        playerId: p1._id,
        notes: '2026 Mavericks Captain',
      },
      adminCookie
    )
    assert.ok(assign2Res.status === 200 || assign2Res.status === 201, `Assign 2 failed: ${JSON.stringify(assign2Res.json)}`)
    tracked.assignmentIds.push(assign2Res.json.data.id)

    const p1NewSeasonCapt = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie)
    assert.equal(p1NewSeasonCapt.status, 200)
    assert.equal(p1NewSeasonCapt.json.data.isCaptain, true)
    assert.equal(p1NewSeasonCapt.json.data.teamId, team2._id)

    const p1PubFuture = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`)
    assert.equal(p1PubFuture.status, 200)
    assert.equal(p1PubFuture.json.data.activeCaptaincy.isCaptain, true)
    assert.equal(p1PubFuture.json.data.activeCaptaincy.team.id, team2._id)
    assert.equal(p1PubFuture.json.data.captaincyHistory.length, 2)
    // Multiple-time captain badge
    const multiBadge = p1PubFuture.json.data.captainBadges.find((b: any) => b.key === 'MULTIPLE_TIME_CAPTAIN')
    assert.ok(multiBadge, 'Expected MULTIPLE_TIME_CAPTAIN badge for player with 2 distinct season tenures')
    console.log('✔ Both records preserved across seasons and MULTIPLE_TIME_CAPTAIN badge earned');

    // =========================================================================
    // Scenario 12: Championship-winning captain retains badge and achievement
    // =========================================================================
    console.log('\n[Scenario 12] Championship-winning captain retains badge and achievement');
    // Set tournament winner to Team 1 for Tournament 1 in Season 1 (where P1 or P2 was captain)
    tourn.winnerTeamId = team1._id
    tourn.status = 'COMPLETED'
    await tourn.save()

    const p1BadgesWithChampionship = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`)
    assert.equal(p1BadgesWithChampionship.status, 200)
    const winBadge = p1BadgesWithChampionship.json.data.captainBadges.find(
      (b: any) => b.key === 'CHAMPIONSHIP_WINNING_CAPTAIN' || b.key === 'WINNING_CAPTAIN'
    )
    assert.ok(winBadge, 'Expected CHAMPIONSHIP_WINNING_CAPTAIN or WINNING_CAPTAIN badge')
    console.log('✔ Championship-winning captain badge successfully computed and verified');

    // =========================================================================
    // Scenario 13: Unauthorized requests to captain endpoints return 401/403
    // =========================================================================
    console.log('\n[Scenario 13] Unauthorized requests return 401/403');
    const anonRes = await api(baseUrl, 'GET', '/api/captains/my-status')
    assert.equal(anonRes.status, 401, 'Anonymous request must return 401')

    const anonSquad = await api(baseUrl, 'GET', '/api/captains/team-squad')
    assert.equal(anonSquad.status, 401, 'Anonymous request must return 401')

    // P2 is no longer captain (season completed)
    const p2Denied = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie)
    assert.equal(p2Denied.status, 403, 'Non-captain must return 403')
    console.log('✔ Unauthorized and unauthenticated access properly blocked (401/403)');

    // =========================================================================
    // Scenario 14: Captain cannot access other teams' lineups or private captain features
    // =========================================================================
    console.log('\n[Scenario 14] Captain cross-team isolation');
    // P1 is captain of Team 2 in Season 2.
    // Try to submit lineup for a match involving Team 1 vs another team as Team 1
    const p1CrossTeam = await api(
      baseUrl,
      'POST',
      `/api/captains/lineup/${match._id}`,
      { playingXI: [p1._id], substitutes: [] },
      p1Cookie
    )
    // Match 1 is in Season 1, where P1's captaincy ended. P1 is only captain of Team 2 in Season 2.
    assert.equal(p1CrossTeam.status, 403, 'Captain cannot manage lineups for other seasons/teams')
    console.log('✔ Captain cannot manage lineups outside their active team and season');

    // =========================================================================
    // Scenario 15: Database partial unique index prevents concurrent duplicate active captains
    // =========================================================================
    console.log('\n[Scenario 15] Database partial unique index verification');
    // Team 2 in Season 2 already has P1 as active captain.
    // Attempt direct database insert of another active captain for Team 2 in Season 2:
    let duplicateTeamError = false
    try {
      await CaptaincyAssignment.create({
        seasonId: season2._id,
        teamId: team2._id,
        playerId: p2._id,
        assignedBy: 'admin',
        status: 'active',
      })
    } catch (err: any) {
      duplicateTeamError = err.code === 11000 || String(err.message).includes('duplicate') || String(err.message).includes('E11000')
    }
    assert.ok(duplicateTeamError, 'Expected duplicate key error (E11000) for two active captains on same team & season')

    // Attempt direct database insert of P1 being active captain for two different teams in same season:
    let duplicatePlayerError = false
    try {
      await CaptaincyAssignment.create({
        seasonId: season2._id,
        teamId: team1._id,
        playerId: p1._id,
        assignedBy: 'admin',
        status: 'active',
      })
    } catch (err: any) {
      duplicatePlayerError = err.code === 11000 || String(err.message).includes('duplicate') || String(err.message).includes('E11000')
    }
    assert.ok(duplicatePlayerError, 'Expected duplicate key error (E11000) for same player captaining two teams in same season')
    console.log('✔ Database partial unique indexes strictly enforce 1 active captain per team and prevent dual-captaincy in same season');

    console.log('\n======================================================');
    console.log('🎉 ALL 15 CAPTAINCY SYSTEM SCENARIOS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } finally {
    // Cleanup tracked test artifacts
    if (tracked.assignmentIds.length > 0) {
      await CaptaincyAssignment.deleteMany({ _id: { $in: tracked.assignmentIds } })
    }
    if (tracked.announcementIds.length > 0) {
      await TeamAnnouncement.deleteMany({ _id: { $in: tracked.announcementIds } })
    }
    if (tracked.matchIds.length > 0) {
      await Match.deleteMany({ _id: { $in: tracked.matchIds } })
      await PlayingXISubmission.deleteMany({ matchId: { $in: tracked.matchIds } })
      await PlayerAvailability.deleteMany({ matchId: { $in: tracked.matchIds } })
    }
    if (tracked.tournamentIds.length > 0) {
      await Tournament.deleteMany({ _id: { $in: tracked.tournamentIds } })
    }
    if (tracked.seasonIds.length > 0) {
      await Season.deleteMany({ _id: { $in: tracked.seasonIds } })
      await TeamMembership.deleteMany({ seasonId: { $in: tracked.seasonIds } })
      await CaptaincyAuditLog.deleteMany({ seasonId: { $in: tracked.seasonIds } })
    }
    if (tracked.teamIds.length > 0) {
      await Team.deleteMany({ _id: { $in: tracked.teamIds } })
    }
    if (tracked.playerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: tracked.playerIds } })
    }
    if (tracked.userIds.length > 0) {
      await User.deleteMany({ _id: { $in: tracked.userIds } })
    }
    server.close()
    process.exit(0)
  }
}

run().catch((err) => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
