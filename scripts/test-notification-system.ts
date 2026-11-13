import 'dotenv/config'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'

import {
  connectDB,
  User,
  Player,
  Team,
  Season,
  TeamMembership,
  CaptaincyAssignment,
  TeamAnnouncement,
  InAppNotification,
  NotificationPreferences,
  NotificationDeliveryJob,
  PushSubscription,
} from '../src/lib/db'
import { createPlayerAccessToken, PLAYER_ACCESS_COOKIE } from '../src/lib/player-auth'
import { recoverPendingDeliveryJobs } from '../src/lib/notification-service'

import captainsRouter from '../src/routes/captains'
import notificationsRouter from '../src/routes/notifications'

interface HttpRes {
  status: number
  json: any
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
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function runTests() {
  console.log('\n=============================================================')
  console.log('NPL Team Announcement & Multi-Channel Notification Test Suite')
  console.log('=============================================================\n')

  await connectDB()

  const app = express()
  app.use(cookieParser())
  app.use(express.json())
  app.use('/api/captains', captainsRouter)
  app.use('/api/notifications', notificationsRouter)

  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as any).port
  const baseUrl = `http://127.0.0.1:${port}`

  const runId = randomUUID().slice(0, 8)

  try {
    // -------------------------------------------------------------------------
    // 1. SETUP FIXTURE DATA: 1 Season, 2 Teams, Captain & Squad Players
    // -------------------------------------------------------------------------
    console.log('1. Setting up test fixtures...')

    const season = await Season.create({
      code: `S-${runId}`,
      name: `Test Season ${runId}`,
      year: 2026,
      status: 'ACTIVE',
    })

    const teamA = await Team.create({
      name: `Royal Knights ${runId}`,
      shortName: `RK-${runId.slice(0, 3)}`,
      color: '#7A1426',
    })

    const teamB = await Team.create({
      name: `Thunder Bolts ${runId}`,
      shortName: `TB-${runId.slice(0, 3)}`,
      color: '#003366',
    })

    // Captain of Team A
    const captainPlayer = await Player.create({
      name: `Captain Alpha ${runId}`,
      role: 'ALL_ROUNDER',
      playerCode: `CAP-${runId}`,
    })
    const captainUser = await User.create({
      email: `captain.${runId}@test.local`,
      name: captainPlayer.name,
      playerId: captainPlayer._id,
      emailVerified: true,
      passwordHash: 'dummy-hash',
    })

    // Player 1 of Team A (Registered in Team A squad)
    const squadPlayer1 = await Player.create({
      name: `Squad Player 1 ${runId}`,
      role: 'BATTER',
      playerCode: `SQ1-${runId}`,
    })
    const squadUser1 = await User.create({
      email: `squad1.${runId}@test.local`,
      name: squadPlayer1.name,
      playerId: squadPlayer1._id,
      emailVerified: true,
      passwordHash: 'dummy-hash',
    })

    // Player 2 of Team A (Registered in Team A squad)
    const squadPlayer2 = await Player.create({
      name: `Squad Player 2 ${runId}`,
      role: 'BOWLER',
      playerCode: `SQ2-${runId}`,
    })
    const squadUser2 = await User.create({
      email: `squad2.${runId}@test.local`,
      name: squadPlayer2.name,
      playerId: squadPlayer2._id,
      emailVerified: true,
      passwordHash: 'dummy-hash',
    })

    // Player 3 of Team B (Different team - MUST NEVER receive Team A announcements)
    const teamBPlayer = await Player.create({
      name: `Team B Player ${runId}`,
      role: 'BATTER',
      playerCode: `TB1-${runId}`,
    })
    const teamBUser = await User.create({
      email: `teamb.${runId}@test.local`,
      name: teamBPlayer.name,
      playerId: teamBPlayer._id,
      emailVerified: true,
      passwordHash: 'dummy-hash',
    })

    // Register Team A squad memberships
    await TeamMembership.create({
      seasonId: season._id,
      teamId: teamA._id,
      playerId: captainPlayer._id,
      designation: 'CAPTAIN',
      status: 'ACTIVE',
    })
    await TeamMembership.create({
      seasonId: season._id,
      teamId: teamA._id,
      playerId: squadPlayer1._id,
      designation: 'PLAYER',
      status: 'ACTIVE',
    })
    await TeamMembership.create({
      seasonId: season._id,
      teamId: teamA._id,
      playerId: squadPlayer2._id,
      designation: 'PLAYER',
      status: 'ACTIVE',
    })

    // Register Team B squad membership
    await TeamMembership.create({
      seasonId: season._id,
      teamId: teamB._id,
      playerId: teamBPlayer._id,
      designation: 'PLAYER',
      status: 'ACTIVE',
    })

    // Assign Captaincy for Team A
    await CaptaincyAssignment.create({
      seasonId: season._id,
      teamId: teamA._id,
      playerId: captainPlayer._id,
      status: 'active',
      assignedBy: 'System Test',
      assignedAt: new Date(),
    })

    // Pre-create push subscription for squadPlayer1
    await PushSubscription.create({
      playerId: squadPlayer1._id,
      endpoint: `https://fcm.googleapis.com/fcm/send/test-endpoint-${runId}`,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVYO2-0U0nodfFYqETC4XY9POUZFsPpNa20iSRupRM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
      deviceInfo: 'Chrome on macOS (Test)',
    })

    // Generate auth cookies
    const captainCookie = `${PLAYER_ACCESS_COOKIE}=${await createPlayerAccessToken({
      userId: captainUser._id.toString(),
      playerId: captainPlayer._id.toString(),
      playerCode: captainPlayer.playerCode,
      role: 'PLAYER',
    })}`
    const squad1Cookie = `${PLAYER_ACCESS_COOKIE}=${await createPlayerAccessToken({
      userId: squadUser1._id.toString(),
      playerId: squadPlayer1._id.toString(),
      playerCode: squadPlayer1.playerCode,
      role: 'PLAYER',
    })}`
    const squad2Cookie = `${PLAYER_ACCESS_COOKIE}=${await createPlayerAccessToken({
      userId: squadUser2._id.toString(),
      playerId: squadPlayer2._id.toString(),
      playerCode: squadPlayer2.playerCode,
      role: 'PLAYER',
    })}`
    const teamBCookie = `${PLAYER_ACCESS_COOKIE}=${await createPlayerAccessToken({
      userId: teamBUser._id.toString(),
      playerId: teamBPlayer._id.toString(),
      playerCode: teamBPlayer.playerCode,
      role: 'PLAYER',
    })}`

    console.log('✓ Fixtures successfully initialized.');

    // -------------------------------------------------------------------------
    // 2. TEST VAPID PUBLIC KEY ENDPOINT
    // -------------------------------------------------------------------------
    console.log('\n2. Testing VAPID public key endpoint...');
    const vapidRes = await api(baseUrl, 'GET', '/api/notifications/push/public-key')
    assert.equal(vapidRes.status, 200)
    assert.equal(typeof vapidRes.json?.data?.publicKey, 'string')
    assert.ok(vapidRes.json.data.publicKey.length > 20)
    console.log('✓ VAPID public key endpoint valid:', vapidRes.json.data.publicKey.slice(0, 16) + '...')

    // -------------------------------------------------------------------------
    // 3. CAPTAIN PUBLISHES ANNOUNCEMENT WITH METADATA
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Captain announcement publication with full metadata...')
    const pubRes = await api(
      baseUrl,
      'POST',
      '/api/captains/announcements',
      {
        title: 'Tactics Meeting & Net Session',
        content: 'Squad please report to Main Ground at 4:30 PM for match debrief and bowling drills.',
        priority: 'IMPORTANT',
        category: 'PRACTICE',
        eventDate: '2026-04-10',
        eventTime: '16:30',
        location: 'Main Ground - Nets 2 & 3',
        attachmentUrl: 'https://cricket.mediaiofficial.in/playbook-s9.pdf',
      },
      captainCookie
    )

    assert.equal(pubRes.status, 201)
    const announcement = pubRes.json?.data
    assert.ok(announcement?._id)
    assert.equal(announcement.title, 'Tactics Meeting & Net Session')
    assert.equal(announcement.priority, 'IMPORTANT')
    assert.equal(announcement.category, 'PRACTICE')
    assert.equal(announcement.status, 'published')
    assert.equal(announcement.location, 'Main Ground - Nets 2 & 3')
    console.log('✓ Announcement published successfully with ID:', announcement._id)

    // -------------------------------------------------------------------------
    // 4. VERIFY STRICT TEAM & SEASON PRIVACY & RECIPIENT ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n4. Verifying strict team and season privacy...')

    // Team A squad members (captain, squadPlayer1, squadPlayer2) must each have 1 notification
    const [capNotifs, sq1Notifs, sq2Notifs, teamBNotifs] = await Promise.all([
      InAppNotification.find({ recipientPlayerId: captainPlayer._id, announcementId: announcement._id }),
      InAppNotification.find({ recipientPlayerId: squadPlayer1._id, announcementId: announcement._id }),
      InAppNotification.find({ recipientPlayerId: squadPlayer2._id, announcementId: announcement._id }),
      InAppNotification.find({ recipientPlayerId: teamBPlayer._id, announcementId: announcement._id }),
    ])

    assert.equal(capNotifs.length, 1, 'Captain must receive own announcement notification')
    assert.equal(sq1Notifs.length, 1, 'Squad member 1 must receive notification')
    assert.equal(sq2Notifs.length, 1, 'Squad member 2 must receive notification')
    assert.equal(teamBNotifs.length, 0, 'Team B player must NEVER receive Team A announcement!')
    console.log('✓ Strict privacy verified: Team A squad received notices, Team B received 0.')

    // -------------------------------------------------------------------------
    // 5. VERIFY DURABLE DELIVERY QUEUE JOBS
    // -------------------------------------------------------------------------
    console.log('\n5. Verifying durable MongoDB delivery jobs...')
    const emailJobs = await NotificationDeliveryJob.find({
      announcementId: announcement._id,
      channel: 'email',
    })
    const pushJobs = await NotificationDeliveryJob.find({
      announcementId: announcement._id,
      channel: 'push',
    })

    console.log(`✓ Created ${emailJobs.length} email delivery jobs and ${pushJobs.length} push delivery jobs.`)
    assert.ok(emailJobs.length >= 2, 'Email jobs created for squad users')
    assert.ok(pushJobs.length >= 1, 'Push job created for player with active subscription')

    // -------------------------------------------------------------------------
    // 6. VERIFY DELIVERY REPORT ENDPOINT
    // -------------------------------------------------------------------------
    console.log('\n6. Verifying Captain delivery report endpoint...')
    const repRes = await api(
      baseUrl,
      'GET',
      `/api/captains/announcements/${announcement._id}/delivery-report`,
      undefined,
      captainCookie
    )

    assert.equal(repRes.status, 200)
    const report = repRes.json?.data
    assert.equal(report.announcementId, announcement._id)
    assert.equal(report.eligibleRecipientsCount, 3) // 3 members in Team A squad
    assert.equal(report.inAppCreatedCount, 3)
    assert.equal(report.inAppReadCount, 0)
    console.log('✓ Delivery report aggregated successfully:', {
      eligibleRecipients: report.eligibleRecipientsCount,
      inAppCreated: report.inAppCreatedCount,
      emailJobsQueued: report.emailJobsQueued,
      pushAttempts: report.pushAttempts,
    })

    // -------------------------------------------------------------------------
    // 7. VERIFY PLAYER NOTIFICATION ENDPOINTS & MARK AS READ
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Player notification endpoints...')
    // Unread count
    const unreadRes = await api(baseUrl, 'GET', '/api/notifications/unread-count', undefined, squad1Cookie)
    assert.equal(unreadRes.status, 200)
    assert.equal(unreadRes.json?.data?.unreadCount, 1)

    // List notifications
    const listRes = await api(baseUrl, 'GET', '/api/notifications', undefined, squad1Cookie)
    assert.equal(listRes.status, 200)
    const notifs = listRes.json?.data?.notifications
    assert.equal(notifs.length, 1)
    assert.equal(notifs[0].title, 'Tactics Meeting & Net Session')
    assert.equal(notifs[0].isRead, false)

    // Mark single notification as read
    const notifId = notifs[0].id
    const readRes = await api(baseUrl, 'PATCH', `/api/notifications/${notifId}/read`, undefined, squad1Cookie)
    assert.equal(readRes.status, 200)
    assert.equal(readRes.json?.data?.unreadCount, 0)

    // Verify delivery report reflects the read
    const repRes2 = await api(
      baseUrl,
      'GET',
      `/api/captains/announcements/${announcement._id}/delivery-report`,
      undefined,
      captainCookie
    )
    assert.equal(repRes2.json?.data?.inAppReadCount, 1)
    console.log('✓ Mark as read updated in-app status and captain delivery report.')

    // -------------------------------------------------------------------------
    // 8. TEST NOTIFICATION PREFERENCES
    // -------------------------------------------------------------------------
    console.log('\n8. Testing Notification Preferences GET & PUT...')
    const prefGet = await api(baseUrl, 'GET', '/api/notifications/preferences', undefined, squad2Cookie)
    assert.equal(prefGet.status, 200)
    assert.equal(prefGet.json?.data?.preferences?.emailEnabled, true)

    const prefPut = await api(
      baseUrl,
      'PUT',
      '/api/notifications/preferences',
      {
        emailEnabled: false,
        pushEnabled: true,
        categoryPreferences: {
          GENERAL: false,
          PRACTICE: true,
          MATCH_REMINDER: true,
        },
      },
      squad2Cookie
    )
    assert.equal(prefPut.status, 200)
    assert.equal(prefPut.json?.data?.preferences?.emailEnabled, false)
    assert.equal(prefPut.json?.data?.preferences?.categoryPreferences?.GENERAL, false)
    assert.equal(prefPut.json?.data?.preferences?.categoryPreferences?.EMERGENCY, true) // locked true
    console.log('✓ Preferences updated and verified.')

    // -------------------------------------------------------------------------
    // 9. TEST CAPTAIN EDIT & ARCHIVE ACTIONS
    // -------------------------------------------------------------------------
    console.log('\n9. Testing Captain Edit & Archive endpoints...')
    const editRes = await api(
      baseUrl,
      'PUT',
      `/api/captains/announcements/${announcement._id}`,
      {
        title: 'Tactics Meeting & Net Session [UPDATED]',
        content: 'Squad please report at 5:00 PM instead of 4:30 PM.',
        priority: 'URGENT',
      },
      captainCookie
    )
    assert.equal(editRes.status, 200)
    assert.equal(editRes.json?.data?.title, 'Tactics Meeting & Net Session [UPDATED]')
    assert.equal(editRes.json?.data?.priority, 'URGENT')

    // Archive announcement
    const arcRes = await api(
      baseUrl,
      'PATCH',
      `/api/captains/announcements/${announcement._id}/archive`,
      undefined,
      captainCookie
    )
    assert.equal(arcRes.status, 200)
    assert.equal(arcRes.json?.data?.status, 'archived')

    // Filter by archived
    const arcList = await api(
      baseUrl,
      'GET',
      '/api/captains/announcements?status=archived',
      undefined,
      captainCookie
    )
    assert.equal(arcList.status, 200)
    assert.ok(arcList.json?.data?.some((a: any) => a.id === announcement._id))
    console.log('✓ Announcement edit and archive verified.')

    // -------------------------------------------------------------------------
    // 10. TEST SERVER RECOVERY FOR INTERRUPTED JOBS
    // -------------------------------------------------------------------------
    console.log('\n10. Testing server startup recovery for interrupted queue jobs...')
    const recoveryAnnouncementId = randomUUID()
    const stuckJob = await NotificationDeliveryJob.create({
      announcementId: recoveryAnnouncementId,
      recipientPlayerId: squadPlayer1._id,
      channel: 'email',
      recipientEmail: 'stuck@test.local',
      status: 'processing',
      attempts: 1,
    })

    await recoverPendingDeliveryJobs()

    const recovered = await NotificationDeliveryJob.findById(stuckJob._id)
    assert.equal(recovered?.status, 'pending')
    console.log('✓ Stuck processing jobs successfully recovered to pending on restart.')

    console.log('\n=============================================================')
    console.log('🎉 ALL NOTIFICATION SYSTEM VERIFICATION TESTS PASSED!')
    console.log('=============================================================\n')
  } finally {
    server.close()
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err)
  process.exit(1)
})
