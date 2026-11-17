"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../src/lib/db");
const player_auth_1 = require("../src/lib/player-auth");
const notification_service_1 = require("../src/lib/notification-service");
const captains_1 = __importDefault(require("../src/routes/captains"));
const notifications_1 = __importDefault(require("../src/routes/notifications"));
async function api(baseUrl, method, path, body, cookieHeader) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
}
async function runTests() {
    console.log('\n=============================================================');
    console.log('NPL Team Announcement & Multi-Channel Notification Test Suite');
    console.log('=============================================================\n');
    await (0, db_1.connectDB)();
    const app = (0, express_1.default)();
    app.use((0, cookie_parser_1.default)());
    app.use(express_1.default.json());
    app.use('/api/captains', captains_1.default);
    app.use('/api/notifications', notifications_1.default);
    const server = node_http_1.default.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const runId = (0, node_crypto_1.randomUUID)().slice(0, 8);
    let testSeasonId = null;
    try {
        // -------------------------------------------------------------------------
        // 1. SETUP FIXTURE DATA: 1 Season, 2 Teams, Captain & Squad Players
        // -------------------------------------------------------------------------
        console.log('1. Setting up test fixtures...');
        const season = await db_1.Season.create({
            code: `S-${runId}`,
            name: `Test Season ${runId}`,
            year: 2026,
            status: 'ACTIVE',
        });
        testSeasonId = season._id;
        const teamA = await db_1.Team.create({
            name: `Royal Knights ${runId}`,
            shortName: `RK-${runId.slice(0, 3)}`,
            color: '#7A1426',
        });
        const teamB = await db_1.Team.create({
            name: `Thunder Bolts ${runId}`,
            shortName: `TB-${runId.slice(0, 3)}`,
            color: '#003366',
        });
        // Captain of Team A
        const captainPlayer = await db_1.Player.create({
            name: `Captain Alpha ${runId}`,
            role: 'ALL_ROUNDER',
            playerCode: `CAP-${runId}`,
        });
        const captainUser = await db_1.User.create({
            email: `captain.${runId}@test.local`,
            name: captainPlayer.name,
            playerId: captainPlayer._id,
            emailVerified: true,
            passwordHash: 'dummy-hash',
        });
        // Player 1 of Team A (Registered in Team A squad)
        const squadPlayer1 = await db_1.Player.create({
            name: `Squad Player 1 ${runId}`,
            role: 'BATTER',
            playerCode: `SQ1-${runId}`,
        });
        const squadUser1 = await db_1.User.create({
            email: `squad1.${runId}@test.local`,
            name: squadPlayer1.name,
            playerId: squadPlayer1._id,
            emailVerified: true,
            passwordHash: 'dummy-hash',
        });
        // Player 2 of Team A (Registered in Team A squad)
        const squadPlayer2 = await db_1.Player.create({
            name: `Squad Player 2 ${runId}`,
            role: 'BOWLER',
            playerCode: `SQ2-${runId}`,
        });
        const squadUser2 = await db_1.User.create({
            email: `squad2.${runId}@test.local`,
            name: squadPlayer2.name,
            playerId: squadPlayer2._id,
            emailVerified: true,
            passwordHash: 'dummy-hash',
        });
        // Player 3 of Team B (Different team - MUST NEVER receive Team A announcements)
        const teamBPlayer = await db_1.Player.create({
            name: `Team B Player ${runId}`,
            role: 'BATTER',
            playerCode: `TB1-${runId}`,
        });
        const teamBUser = await db_1.User.create({
            email: `teamb.${runId}@test.local`,
            name: teamBPlayer.name,
            playerId: teamBPlayer._id,
            emailVerified: true,
            passwordHash: 'dummy-hash',
        });
        // Register Team A squad memberships
        await db_1.TeamMembership.create({
            seasonId: season._id,
            teamId: teamA._id,
            playerId: captainPlayer._id,
            designation: 'CAPTAIN',
            status: 'ACTIVE',
        });
        await db_1.TeamMembership.create({
            seasonId: season._id,
            teamId: teamA._id,
            playerId: squadPlayer1._id,
            designation: 'PLAYER',
            status: 'ACTIVE',
        });
        await db_1.TeamMembership.create({
            seasonId: season._id,
            teamId: teamA._id,
            playerId: squadPlayer2._id,
            designation: 'PLAYER',
            status: 'ACTIVE',
        });
        // Register Team B squad membership
        await db_1.TeamMembership.create({
            seasonId: season._id,
            teamId: teamB._id,
            playerId: teamBPlayer._id,
            designation: 'PLAYER',
            status: 'ACTIVE',
        });
        // Assign Captaincy for Team A
        await db_1.CaptaincyAssignment.create({
            seasonId: season._id,
            teamId: teamA._id,
            playerId: captainPlayer._id,
            status: 'active',
            assignedBy: 'System Test',
            assignedAt: new Date(),
        });
        // Pre-create push subscription for squadPlayer1
        await db_1.PushSubscription.create({
            playerId: squadPlayer1._id,
            endpoint: `https://fcm.googleapis.com/fcm/send/test-endpoint-${runId}`,
            keys: {
                p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVYO2-0U0nodfFYqETC4XY9POUZFsPpNa20iSRupRM',
                auth: 'tBHItJI5svbpez7KI4CCXg',
            },
            deviceInfo: 'Chrome on macOS (Test)',
        });
        // Generate auth cookies
        const captainCookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${await (0, player_auth_1.createPlayerAccessToken)({
            userId: captainUser._id.toString(),
            playerId: captainPlayer._id.toString(),
            playerCode: captainPlayer.playerCode,
            role: 'PLAYER',
        })}`;
        const squad1Cookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${await (0, player_auth_1.createPlayerAccessToken)({
            userId: squadUser1._id.toString(),
            playerId: squadPlayer1._id.toString(),
            playerCode: squadPlayer1.playerCode,
            role: 'PLAYER',
        })}`;
        const squad2Cookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${await (0, player_auth_1.createPlayerAccessToken)({
            userId: squadUser2._id.toString(),
            playerId: squadPlayer2._id.toString(),
            playerCode: squadPlayer2.playerCode,
            role: 'PLAYER',
        })}`;
        const teamBCookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${await (0, player_auth_1.createPlayerAccessToken)({
            userId: teamBUser._id.toString(),
            playerId: teamBPlayer._id.toString(),
            playerCode: teamBPlayer.playerCode,
            role: 'PLAYER',
        })}`;
        console.log('✓ Fixtures successfully initialized.');
        // -------------------------------------------------------------------------
        // 2. TEST VAPID PUBLIC KEY ENDPOINT
        // -------------------------------------------------------------------------
        console.log('\n2. Testing VAPID public key endpoint...');
        const vapidRes = await api(baseUrl, 'GET', '/api/notifications/push/public-key');
        strict_1.default.equal(vapidRes.status, 200);
        strict_1.default.equal(typeof vapidRes.json?.data?.publicKey, 'string');
        strict_1.default.ok(vapidRes.json.data.publicKey.length > 20);
        console.log('✓ VAPID public key endpoint valid:', vapidRes.json.data.publicKey.slice(0, 16) + '...');
        // -------------------------------------------------------------------------
        // 3. CAPTAIN PUBLISHES ANNOUNCEMENT WITH METADATA
        // -------------------------------------------------------------------------
        console.log('\n3. Testing Captain announcement publication with full metadata...');
        const pubRes = await api(baseUrl, 'POST', '/api/captains/announcements', {
            title: 'Tactics Meeting & Net Session',
            content: 'Squad please report to Main Ground at 4:30 PM for match debrief and bowling drills.',
            priority: 'IMPORTANT',
            category: 'PRACTICE',
            eventDate: '2026-04-10',
            eventTime: '16:30',
            location: 'Main Ground - Nets 2 & 3',
            attachmentUrl: 'https://cricket.mediaiofficial.in/playbook-s9.pdf',
        }, captainCookie);
        strict_1.default.equal(pubRes.status, 201);
        const announcement = pubRes.json?.data;
        strict_1.default.ok(announcement?._id);
        strict_1.default.equal(announcement.title, 'Tactics Meeting & Net Session');
        strict_1.default.equal(announcement.priority, 'IMPORTANT');
        strict_1.default.equal(announcement.category, 'PRACTICE');
        strict_1.default.equal(announcement.status, 'published');
        strict_1.default.equal(announcement.location, 'Main Ground - Nets 2 & 3');
        console.log('✓ Announcement published successfully with ID:', announcement._id);
        // -------------------------------------------------------------------------
        // 4. VERIFY STRICT TEAM & SEASON PRIVACY & RECIPIENT ISOLATION
        // -------------------------------------------------------------------------
        console.log('\n4. Verifying strict team and season privacy...');
        // Team A squad members (captain, squadPlayer1, squadPlayer2) must each have 1 notification
        const [capNotifs, sq1Notifs, sq2Notifs, teamBNotifs] = await Promise.all([
            db_1.InAppNotification.find({ recipientPlayerId: captainPlayer._id, announcementId: announcement._id }),
            db_1.InAppNotification.find({ recipientPlayerId: squadPlayer1._id, announcementId: announcement._id }),
            db_1.InAppNotification.find({ recipientPlayerId: squadPlayer2._id, announcementId: announcement._id }),
            db_1.InAppNotification.find({ recipientPlayerId: teamBPlayer._id, announcementId: announcement._id }),
        ]);
        strict_1.default.equal(capNotifs.length, 1, 'Captain must receive own announcement notification');
        strict_1.default.equal(sq1Notifs.length, 1, 'Squad member 1 must receive notification');
        strict_1.default.equal(sq2Notifs.length, 1, 'Squad member 2 must receive notification');
        strict_1.default.equal(teamBNotifs.length, 0, 'Team B player must NEVER receive Team A announcement!');
        console.log('✓ Strict privacy verified: Team A squad received notices, Team B received 0.');
        // -------------------------------------------------------------------------
        // 5. VERIFY DURABLE DELIVERY QUEUE JOBS
        // -------------------------------------------------------------------------
        console.log('\n5. Verifying durable MongoDB delivery jobs...');
        const emailJobs = await db_1.NotificationDeliveryJob.find({
            announcementId: announcement._id,
            channel: 'email',
        });
        const pushJobs = await db_1.NotificationDeliveryJob.find({
            announcementId: announcement._id,
            channel: 'push',
        });
        console.log(`✓ Created ${emailJobs.length} email delivery jobs and ${pushJobs.length} push delivery jobs.`);
        strict_1.default.ok(emailJobs.length >= 2, 'Email jobs created for squad users');
        strict_1.default.ok(pushJobs.length >= 1, 'Push job created for player with active subscription');
        // -------------------------------------------------------------------------
        // 6. VERIFY DELIVERY REPORT ENDPOINT
        // -------------------------------------------------------------------------
        console.log('\n6. Verifying Captain delivery report endpoint...');
        const repRes = await api(baseUrl, 'GET', `/api/captains/announcements/${announcement._id}/delivery-report`, undefined, captainCookie);
        strict_1.default.equal(repRes.status, 200);
        const report = repRes.json?.data;
        strict_1.default.equal(report.announcementId, announcement._id);
        strict_1.default.equal(report.eligibleRecipientsCount, 3); // 3 members in Team A squad
        strict_1.default.equal(report.inAppCreatedCount, 3);
        strict_1.default.equal(report.inAppReadCount, 0);
        console.log('✓ Delivery report aggregated successfully:', {
            eligibleRecipients: report.eligibleRecipientsCount,
            inAppCreated: report.inAppCreatedCount,
            emailJobsQueued: report.emailJobsQueued,
            pushAttempts: report.pushAttempts,
        });
        // -------------------------------------------------------------------------
        // 7. VERIFY PLAYER NOTIFICATION ENDPOINTS & MARK AS READ
        // -------------------------------------------------------------------------
        console.log('\n7. Testing Player notification endpoints...');
        // Unread count
        const unreadRes = await api(baseUrl, 'GET', '/api/notifications/unread-count', undefined, squad1Cookie);
        strict_1.default.equal(unreadRes.status, 200);
        strict_1.default.equal(unreadRes.json?.data?.unreadCount, 1);
        // List notifications
        const listRes = await api(baseUrl, 'GET', '/api/notifications', undefined, squad1Cookie);
        strict_1.default.equal(listRes.status, 200);
        const notifs = listRes.json?.data?.notifications;
        strict_1.default.equal(notifs.length, 1);
        strict_1.default.equal(notifs[0].title, 'Tactics Meeting & Net Session');
        strict_1.default.equal(notifs[0].isRead, false);
        // Mark single notification as read
        const notifId = notifs[0].id;
        const readRes = await api(baseUrl, 'PATCH', `/api/notifications/${notifId}/read`, undefined, squad1Cookie);
        strict_1.default.equal(readRes.status, 200);
        strict_1.default.equal(readRes.json?.data?.unreadCount, 0);
        // Verify delivery report reflects the read
        const repRes2 = await api(baseUrl, 'GET', `/api/captains/announcements/${announcement._id}/delivery-report`, undefined, captainCookie);
        strict_1.default.equal(repRes2.json?.data?.inAppReadCount, 1);
        console.log('✓ Mark as read updated in-app status and captain delivery report.');
        // -------------------------------------------------------------------------
        // 8. TEST NOTIFICATION PREFERENCES
        // -------------------------------------------------------------------------
        console.log('\n8. Testing Notification Preferences GET & PUT...');
        const prefGet = await api(baseUrl, 'GET', '/api/notifications/preferences', undefined, squad2Cookie);
        strict_1.default.equal(prefGet.status, 200);
        strict_1.default.equal(prefGet.json?.data?.preferences?.emailEnabled, true);
        const prefPut = await api(baseUrl, 'PUT', '/api/notifications/preferences', {
            emailEnabled: false,
            pushEnabled: true,
            categoryPreferences: {
                GENERAL: false,
                PRACTICE: true,
                MATCH_REMINDER: true,
            },
        }, squad2Cookie);
        strict_1.default.equal(prefPut.status, 200);
        strict_1.default.equal(prefPut.json?.data?.preferences?.emailEnabled, false);
        strict_1.default.equal(prefPut.json?.data?.preferences?.categoryPreferences?.GENERAL, false);
        strict_1.default.equal(prefPut.json?.data?.preferences?.categoryPreferences?.EMERGENCY, true); // locked true
        console.log('✓ Preferences updated and verified.');
        // -------------------------------------------------------------------------
        // 9. TEST CAPTAIN EDIT & ARCHIVE ACTIONS
        // -------------------------------------------------------------------------
        console.log('\n9. Testing Captain Edit & Archive endpoints...');
        const editRes = await api(baseUrl, 'PUT', `/api/captains/announcements/${announcement._id}`, {
            title: 'Tactics Meeting & Net Session [UPDATED]',
            content: 'Squad please report at 5:00 PM instead of 4:30 PM.',
            priority: 'URGENT',
        }, captainCookie);
        strict_1.default.equal(editRes.status, 200);
        strict_1.default.equal(editRes.json?.data?.title, 'Tactics Meeting & Net Session [UPDATED]');
        strict_1.default.equal(editRes.json?.data?.priority, 'URGENT');
        // Archive announcement
        const arcRes = await api(baseUrl, 'PATCH', `/api/captains/announcements/${announcement._id}/archive`, undefined, captainCookie);
        strict_1.default.equal(arcRes.status, 200);
        strict_1.default.equal(arcRes.json?.data?.status, 'archived');
        // Filter by archived
        const arcList = await api(baseUrl, 'GET', '/api/captains/announcements?status=archived', undefined, captainCookie);
        strict_1.default.equal(arcList.status, 200);
        strict_1.default.ok(arcList.json?.data?.some((a) => a.id === announcement._id));
        console.log('✓ Announcement edit and archive verified.');
        // -------------------------------------------------------------------------
        // 10. TEST SERVER RECOVERY FOR INTERRUPTED JOBS
        // -------------------------------------------------------------------------
        console.log('\n10. Testing server startup recovery for interrupted queue jobs...');
        const recoveryAnnouncementId = (0, node_crypto_1.randomUUID)();
        const stuckJob = await db_1.NotificationDeliveryJob.create({
            announcementId: recoveryAnnouncementId,
            recipientPlayerId: squadPlayer1._id,
            channel: 'email',
            recipientEmail: 'stuck@test.local',
            status: 'processing',
            attempts: 1,
        });
        await (0, notification_service_1.recoverPendingDeliveryJobs)();
        const recovered = await db_1.NotificationDeliveryJob.findById(stuckJob._id);
        strict_1.default.equal(recovered?.status, 'pending');
        console.log('✓ Stuck processing jobs successfully recovered to pending on restart.');
        console.log('\n=============================================================');
        console.log('🎉 ALL NOTIFICATION SYSTEM VERIFICATION TESTS PASSED!');
        console.log('=============================================================\n');
    }
    finally {
        console.log('\nCleaning up test fixtures for runId:', runId);
        await Promise.allSettled([
            db_1.Season.deleteMany({ code: `S-${runId}` }),
            db_1.Team.deleteMany({ name: new RegExp(runId, 'i') }),
            db_1.Player.deleteMany({ name: new RegExp(runId, 'i') }),
            db_1.User.deleteMany({ email: new RegExp(runId, 'i') }),
            ...(testSeasonId
                ? [
                    db_1.TeamMembership.deleteMany({ seasonId: testSeasonId }),
                    db_1.CaptaincyAssignment.deleteMany({ seasonId: testSeasonId }),
                    db_1.TeamAnnouncement.deleteMany({ seasonId: testSeasonId }),
                ]
                : []),
            db_1.InAppNotification.deleteMany({ title: new RegExp(runId, 'i') }),
            db_1.PushSubscription.deleteMany({ endpoint: new RegExp(runId, 'i') }),
        ]);
        server.close();
    }
}
runTests().catch((err) => {
    console.error('\n❌ Test suite failed with error:', err);
    process.exit(1);
});
