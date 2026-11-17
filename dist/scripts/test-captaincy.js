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
const db_1 = require("../src/lib/db");
const auth_1 = require("../src/lib/auth");
const player_auth_1 = require("../src/lib/player-auth");
const bootstrap_1 = require("../src/lib/bootstrap");
const auth_2 = __importDefault(require("../src/routes/auth"));
const player_auth_2 = __importDefault(require("../src/routes/player-auth"));
const matches_1 = __importDefault(require("../src/routes/matches"));
const players_1 = __importDefault(require("../src/routes/players"));
const teams_1 = __importDefault(require("../src/routes/teams"));
const admin_1 = __importDefault(require("../src/routes/admin"));
const awards_1 = __importDefault(require("../src/routes/awards"));
const standings_1 = __importDefault(require("../src/routes/standings"));
const seasons_1 = __importDefault(require("../src/routes/seasons"));
const tournaments_1 = __importDefault(require("../src/routes/tournaments"));
const memberships_1 = __importDefault(require("../src/routes/memberships"));
const leaderboards_1 = __importDefault(require("../src/routes/leaderboards"));
const captains_1 = __importDefault(require("../src/routes/captains"));
function cookieValue(setCookies, name) {
    for (const line of setCookies) {
        const first = line.split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0 && first.slice(0, eq).trim() === name) {
            return decodeURIComponent(first.slice(eq + 1));
        }
    }
    return null;
}
async function api(baseUrl, method, path, body, cookieHeader) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = { raw: text };
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { status: res.status, json, setCookies };
}
async function run() {
    console.log('Connecting to database...');
    await (0, db_1.connectDB)();
    await db_1.CaptaincyAssignment.syncIndexes();
    await (0, auth_1.ensureDefaultAdmin)();
    await (0, bootstrap_1.ensurePlayerSystemBootstrap)();
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use((0, cookie_parser_1.default)());
    app.use('/api/auth', auth_2.default);
    app.use('/api/player-auth', player_auth_2.default);
    app.use('/api/matches', matches_1.default);
    app.use('/api/players', players_1.default);
    app.use('/api/teams', teams_1.default);
    app.use('/api/admin', admin_1.default);
    app.use('/api/awards', awards_1.default);
    app.use('/api/standings', standings_1.default);
    app.use('/api/seasons', seasons_1.default);
    app.use('/api/tournaments', tournaments_1.default);
    app.use('/api/memberships', memberships_1.default);
    app.use('/api/leaderboards', leaderboards_1.default);
    app.use('/api/captains', captains_1.default);
    const server = node_http_1.default.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const defaultAdmin = await db_1.Admin.findOne({ username: 'admin' }).lean();
    const adminToken = await (0, auth_1.createSessionToken)(defaultAdmin ? defaultAdmin._id : 'test-admin', 'admin');
    const adminCookie = `${auth_1.ADMIN_COOKIE}=${encodeURIComponent(adminToken)}`;
    const stamp = Date.now();
    const tracked = {
        userIds: [],
        playerIds: [],
        teamIds: [],
        seasonIds: [],
        tournamentIds: [],
        matchIds: [],
        assignmentIds: [],
        announcementIds: [],
    };
    try {
        console.log('\n--- Setup Test Data ---');
        // 1. Create Season 1 (2025)
        const season1 = await db_1.Season.create({
            name: `NPL Season 2025 (${stamp})`,
            code: `S25_${stamp}`,
            year: 2025,
            status: 'ACTIVE',
            isDefault: false,
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-12-31'),
        });
        tracked.seasonIds.push(season1._id);
        // 2. Create Teams
        const team1 = await db_1.Team.create({
            name: `Nex-Bitz ${stamp}`,
            shortName: 'NXB',
            color: '#7A1426',
        });
        tracked.teamIds.push(team1._id);
        const team2 = await db_1.Team.create({
            name: `Mavericks ${stamp}`,
            shortName: 'MAV',
            color: '#2563EB',
        });
        tracked.teamIds.push(team2._id);
        // 3. Create Players & Users
        // Player 1: Taha (Will be Captain P1)
        const p1 = await db_1.Player.create({
            name: `Taha Choudhary ${stamp}`,
            role: 'ALL_ROUNDER',
            battingStyle: 'RIGHT_HAND',
            bowlingStyle: 'RIGHT_ARM_FAST',
            isVerified: true,
        });
        tracked.playerIds.push(p1._id);
        const u1 = await db_1.User.create({
            email: `taha.${stamp}@test.local`,
            name: p1.name,
            passwordHash: 'hash',
            role: 'PLAYER',
            playerId: p1._id,
            emailVerified: true,
            isActive: true,
        });
        tracked.userIds.push(u1._id);
        p1.userId = u1._id;
        await p1.save();
        // Player 2: Hammad (Will be Replacement Captain P2)
        const p2 = await db_1.Player.create({
            name: `Hammad Choudhary ${stamp}`,
            role: 'BATTER',
            battingStyle: 'RIGHT_HAND',
            isVerified: true,
        });
        tracked.playerIds.push(p2._id);
        const u2 = await db_1.User.create({
            email: `hammad.${stamp}@test.local`,
            name: p2.name,
            passwordHash: 'hash',
            role: 'PLAYER',
            playerId: p2._id,
            emailVerified: true,
            isActive: true,
        });
        tracked.userIds.push(u2._id);
        p2.userId = u2._id;
        await p2.save();
        // Squad memberships for Season 1: Both in Team 1
        const m1 = await db_1.TeamMembership.create({
            playerId: p1._id,
            teamId: team1._id,
            seasonId: season1._id,
            joinedAt: new Date(),
            status: 'ACTIVE',
            designation: 'PLAYER',
        });
        const m2 = await db_1.TeamMembership.create({
            playerId: p2._id,
            teamId: team1._id,
            seasonId: season1._id,
            joinedAt: new Date(),
            status: 'ACTIVE',
            designation: 'PLAYER',
        });
        // Player session tokens
        const p1Token = await (0, player_auth_1.createPlayerAccessToken)({
            userId: u1._id,
            playerId: p1._id,
            playerCode: p1.playerCode,
            role: 'PLAYER',
        });
        const p1Cookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${encodeURIComponent(p1Token)}`;
        const p2Token = await (0, player_auth_1.createPlayerAccessToken)({
            userId: u2._id,
            playerId: p2._id,
            playerCode: p2.playerCode,
            role: 'PLAYER',
        });
        const p2Cookie = `${player_auth_1.PLAYER_ACCESS_COOKIE}=${encodeURIComponent(p2Token)}`;
        // =========================================================================
        // Scenario 1: Normal player login -> no Captain's Corner
        // =========================================================================
        console.log('\n[Scenario 1] Normal player login -> no Captain\'s Corner');
        const s1Dash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie);
        strict_1.default.equal(s1Dash.status, 200);
        strict_1.default.equal(s1Dash.json.data.activeCaptaincy, null);
        const s1Status = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie);
        strict_1.default.equal(s1Status.status, 200);
        strict_1.default.equal(s1Status.json.data.isCaptain, false);
        // Captain endpoints must reject normal player
        const s1Forbidden = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie);
        strict_1.default.equal(s1Forbidden.status, 403, 'Normal player must be denied access to captain team squad');
        console.log('✔ Normal player correctly sees no Captain\'s Corner and is denied captain routes (403)');
        // =========================================================================
        // Scenario 2: Admin appoints player as captain
        // =========================================================================
        console.log('\n[Scenario 2] Admin appoints player as captain');
        const assignRes = await api(baseUrl, 'POST', '/api/captains/admin/assign', {
            seasonId: season1._id,
            teamId: team1._id,
            playerId: p1._id,
            notes: 'Official 2025 Captain',
        }, adminCookie);
        strict_1.default.ok(assignRes.status === 200 || assignRes.status === 201, `Assign captain failed: ${JSON.stringify(assignRes.json)}`);
        strict_1.default.equal(assignRes.json.data.status, 'active');
        strict_1.default.equal(assignRes.json.data.playerId, p1._id);
        strict_1.default.equal(assignRes.json.data.teamId, team1._id);
        tracked.assignmentIds.push(assignRes.json.data.id);
        // Verify audit log
        const auditLogsRes = await api(baseUrl, 'GET', `/api/captains/admin/audit-logs?seasonId=${season1._id}&teamId=${team1._id}`, undefined, adminCookie);
        strict_1.default.equal(auditLogsRes.status, 200);
        const logs = auditLogsRes.json.data;
        strict_1.default.ok(logs.length >= 1);
        strict_1.default.equal(logs[0].action, 'ASSIGN');
        strict_1.default.equal(logs[0].newCaptainId, p1._id);
        console.log('✔ Admin successfully appointed captain with audit log record');
        // =========================================================================
        // Scenario 3: Player sees Captain's Corner and Captain badge
        // =========================================================================
        console.log('\n[Scenario 3] Player sees Captain\'s Corner and Captain badge');
        const p1Me = await api(baseUrl, 'GET', '/api/player-auth/me', undefined, p1Cookie);
        strict_1.default.equal(p1Me.status, 200);
        strict_1.default.equal(p1Me.json.data.activeCaptaincy.isCaptain, true);
        strict_1.default.equal(p1Me.json.data.activeCaptaincy.team.id, team1._id);
        const p1Dash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie);
        strict_1.default.equal(p1Dash.status, 200);
        strict_1.default.equal(p1Dash.json.data.activeCaptaincy.isCaptain, true);
        strict_1.default.equal(p1Dash.json.data.activeCaptaincy.team.name, team1.name);
        // Check badges in dashboard achievements
        const badges = p1Dash.json.data.achievements;
        const currentCaptainBadge = badges.find((b) => b.key === 'CURRENT_CAPTAIN' || b.id === 'CURRENT_CAPTAIN');
        strict_1.default.ok(currentCaptainBadge, 'Expected CURRENT_CAPTAIN badge in achievements');
        // Public profile
        const p1Pub = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`);
        strict_1.default.equal(p1Pub.status, 200);
        strict_1.default.equal(p1Pub.json.data.activeCaptaincy.isCaptain, true);
        const pubBadge = p1Pub.json.data.captainBadges.find((b) => b.key === 'CURRENT_CAPTAIN');
        strict_1.default.ok(pubBadge, 'Expected CURRENT_CAPTAIN badge in public profile');
        console.log('✔ Captain sees active Captain\'s Corner, active status, and CURRENT_CAPTAIN badge');
        // =========================================================================
        // Scenario 4: Captain manages squad, fixtures, Playing XI, availability, announcements
        // =========================================================================
        console.log('\n[Scenario 4] Captain manages squad, fixtures, Playing XI, availability, announcements');
        // Team squad
        const squadRes = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie);
        strict_1.default.equal(squadRes.status, 200);
        strict_1.default.ok(squadRes.json.data.length >= 2, 'Squad should contain both P1 and P2');
        // Create tournament and match
        const tourn = await db_1.Tournament.create({
            name: `NPL Championship ${stamp}`,
            shortName: `CHP${String(stamp).slice(-4)}`,
            format: 'T20',
            status: 'ACTIVE',
            seasonId: season1._id,
            startDate: new Date('2025-03-01'),
            endDate: new Date('2025-03-15'),
        });
        tracked.tournamentIds.push(tourn._id);
        const match = await db_1.Match.create({
            tournamentId: tourn._id,
            seasonId: season1._id,
            teamAId: team1._id,
            teamBId: team2._id,
            format: 'T20',
            totalOvers: 20,
            status: 'SCHEDULED',
            venue: 'Nexcore Stadium',
            matchDate: new Date('2025-03-05T14:00:00Z'),
        });
        tracked.matchIds.push(match._id);
        // Team fixtures
        const fixRes = await api(baseUrl, 'GET', '/api/captains/fixtures', undefined, p1Cookie);
        strict_1.default.equal(fixRes.status, 200);
        strict_1.default.ok(fixRes.json.data.some((f) => f.id === match._id));
        // Captain creates announcement
        const annRes = await api(baseUrl, 'POST', '/api/captains/announcements', {
            title: 'Team Strategy Meeting',
            content: 'Meeting at 6 PM sharp on Google Meet.',
            priority: 'URGENT',
            category: 'MEETING',
        }, p1Cookie);
        strict_1.default.equal(annRes.status, 201);
        tracked.announcementIds.push(annRes.json.data.id);
        // Squad member P2 views announcements
        const playerAnnRes = await api(baseUrl, 'GET', '/api/captains/player-announcements', undefined, p2Cookie);
        strict_1.default.equal(playerAnnRes.status, 200);
        const pAnnList = Array.isArray(playerAnnRes.json.data)
            ? playerAnnRes.json.data
            : playerAnnRes.json.data.announcements;
        strict_1.default.ok(pAnnList.some((a) => a.id === annRes.json.data.id));
        // Captain saves draft Playing XI
        const lineupDraft = await api(baseUrl, 'POST', `/api/captains/lineup/${match._id}`, {
            playingXI: [p1._id, p2._id],
            substitutes: [],
            notes: 'P1 and P2 leading the XI',
        }, p1Cookie);
        strict_1.default.equal(lineupDraft.status, 200);
        strict_1.default.equal(lineupDraft.json.data.status, 'DRAFT');
        // Player P2 marks availability
        const availRes = await api(baseUrl, 'POST', `/api/captains/player-availability/${match._id}`, {
            status: 'AVAILABLE',
            note: 'Ready to open batting',
        }, p2Cookie);
        strict_1.default.equal(availRes.status, 200);
        // Captain views team availability
        const captAvailRes = await api(baseUrl, 'GET', `/api/captains/availability/${match._id}`, undefined, p1Cookie);
        strict_1.default.equal(captAvailRes.status, 200);
        strict_1.default.equal(captAvailRes.json.data.summary.availableCount, 1);
        // Captain views team performance
        const perfRes = await api(baseUrl, 'GET', '/api/captains/performance', undefined, p1Cookie);
        strict_1.default.equal(perfRes.status, 200);
        strict_1.default.ok(perfRes.json.data !== null, 'Performance stats should be returned');
        console.log('✔ Captain successfully managed squad, fixtures, Playing XI, availability, and announcements');
        // =========================================================================
        // Scenario 5: Admin replaces captain
        // =========================================================================
        console.log('\n[Scenario 5] Admin replaces captain');
        const replaceRes = await api(baseUrl, 'POST', '/api/captains/admin/replace', {
            seasonId: season1._id,
            teamId: team1._id,
            newPlayerId: p2._id,
            notes: 'Tactical captaincy change mid-season',
        }, adminCookie);
        strict_1.default.equal(replaceRes.status, 200, `Replace captain failed: ${JSON.stringify(replaceRes.json)}`);
        strict_1.default.equal(replaceRes.json.data.playerId, p2._id);
        strict_1.default.equal(replaceRes.json.data.status, 'active');
        tracked.assignmentIds.push(replaceRes.json.data.id);
        // Verify audit log has REPLACE action
        const replaceAudit = await api(baseUrl, 'GET', `/api/captains/admin/audit-logs?seasonId=${season1._id}&teamId=${team1._id}`, undefined, adminCookie);
        strict_1.default.equal(replaceAudit.status, 200);
        const replaceLog = replaceAudit.json.data.find((l) => l.action === 'REPLACE');
        strict_1.default.ok(replaceLog, 'Expected REPLACE audit log');
        strict_1.default.equal(replaceLog.previousCaptainId, p1._id);
        strict_1.default.equal(replaceLog.newCaptainId, p2._id);
        console.log('✔ Admin replaced captain, recorded audit log with previous and new captain IDs');
        // =========================================================================
        // Scenario 6: Previous captain loses captain permissions immediately
        // =========================================================================
        console.log('\n[Scenario 6] Previous captain loses captain permissions immediately');
        const p1StatusAfter = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie);
        strict_1.default.equal(p1StatusAfter.status, 200);
        strict_1.default.equal(p1StatusAfter.json.data.isCaptain, false);
        const p1SquadAfter = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p1Cookie);
        strict_1.default.equal(p1SquadAfter.status, 403, 'Previous captain must be denied access to captain team squad (403)');
        const p1PostAnnAfter = await api(baseUrl, 'POST', '/api/captains/announcements', { title: 'Test', content: 'Not allowed' }, p1Cookie);
        strict_1.default.equal(p1PostAnnAfter.status, 403, 'Previous captain must be denied posting announcements (403)');
        console.log('✔ Previous captain immediately lost all captain permissions (403)');
        // =========================================================================
        // Scenario 7: Previous captain retains historical captaincy records
        // =========================================================================
        console.log('\n[Scenario 7] Previous captain retains historical captaincy records');
        const p1DashAfter = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie);
        strict_1.default.equal(p1DashAfter.status, 200);
        strict_1.default.equal(p1DashAfter.json.data.activeCaptaincy, null);
        strict_1.default.ok(p1DashAfter.json.data.captaincyHistory.length >= 1);
        const prevTenure = p1DashAfter.json.data.captaincyHistory[0];
        strict_1.default.equal(prevTenure.teamId, team1._id);
        strict_1.default.equal(prevTenure.status, 'completed');
        strict_1.default.ok(prevTenure.endedAt !== null);
        // Check FORMER_CAPTAIN badge
        const p1PubAfter = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`);
        strict_1.default.equal(p1PubAfter.status, 200);
        strict_1.default.equal(p1PubAfter.json.data.activeCaptaincy, null);
        const formerBadge = p1PubAfter.json.data.captainBadges.find((b) => b.key === 'FORMER_CAPTAIN');
        strict_1.default.ok(formerBadge, 'Expected FORMER_CAPTAIN badge for player with completed tenure');
        console.log('✔ Previous captain permanently retains tenure history and has FORMER_CAPTAIN badge');
        // =========================================================================
        // Scenario 8: New captain receives captain permissions
        // =========================================================================
        console.log('\n[Scenario 8] New captain receives captain permissions');
        const p2Status = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p2Cookie);
        strict_1.default.equal(p2Status.status, 200);
        strict_1.default.equal(p2Status.json.data.isCaptain, true);
        strict_1.default.equal(p2Status.json.data.teamId, team1._id);
        const p2Squad = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie);
        strict_1.default.equal(p2Squad.status, 200);
        strict_1.default.ok(p2Squad.json.data.length >= 2);
        console.log('✔ New captain received full captain permissions immediately');
        // =========================================================================
        // Scenario 9: Season completes -> active captaincy auto-expires
        // =========================================================================
        console.log('\n[Scenario 9] Season completes -> active captaincy auto-expires');
        const completeSeasonRes = await api(baseUrl, 'PATCH', `/api/seasons/${season1._id}`, { status: 'COMPLETED' }, adminCookie);
        strict_1.default.equal(completeSeasonRes.status, 200);
        const p2StatusAfterSeasonEnd = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p2Cookie);
        strict_1.default.equal(p2StatusAfterSeasonEnd.status, 200);
        strict_1.default.equal(p2StatusAfterSeasonEnd.json.data.isCaptain, false, 'Captaincy must auto-expire on completed season');
        const p2SquadAfter = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie);
        strict_1.default.equal(p2SquadAfter.status, 403, 'Expired captain must be denied access (403)');
        console.log('✔ Season completion auto-expired active captaincy permissions');
        // =========================================================================
        // Scenario 10: Previous captain participates as normal player in new season
        // =========================================================================
        console.log('\n[Scenario 10] Previous captain participates as normal player in new season');
        const season2 = await db_1.Season.create({
            name: `NPL Season 2026 (${stamp})`,
            code: `S26_${stamp}`,
            year: 2026,
            status: 'ACTIVE',
            isDefault: false,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
        });
        tracked.seasonIds.push(season2._id);
        // Add P1 to Team 2 in Season 2 as normal player
        const m3 = await db_1.TeamMembership.create({
            playerId: p1._id,
            teamId: team2._id,
            seasonId: season2._id,
            joinedAt: new Date(),
            status: 'ACTIVE',
            designation: 'PLAYER',
        });
        const p1InSeason2 = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, p1Cookie);
        strict_1.default.equal(p1InSeason2.status, 200);
        strict_1.default.equal(p1InSeason2.json.data.activeCaptaincy, null);
        strict_1.default.equal(p1InSeason2.json.data.captaincyHistory.length, 1);
        console.log('✔ Player participates as normal player in new season with past captaincy history intact');
        // =========================================================================
        // Scenario 11: Player becomes captain of different team in future season
        // =========================================================================
        console.log('\n[Scenario 11] Player becomes captain of different team in future season -> both records preserved');
        const assign2Res = await api(baseUrl, 'POST', '/api/captains/admin/assign', {
            seasonId: season2._id,
            teamId: team2._id,
            playerId: p1._id,
            notes: '2026 Mavericks Captain',
        }, adminCookie);
        strict_1.default.ok(assign2Res.status === 200 || assign2Res.status === 201, `Assign 2 failed: ${JSON.stringify(assign2Res.json)}`);
        tracked.assignmentIds.push(assign2Res.json.data.id);
        const p1NewSeasonCapt = await api(baseUrl, 'GET', '/api/captains/my-status', undefined, p1Cookie);
        strict_1.default.equal(p1NewSeasonCapt.status, 200);
        strict_1.default.equal(p1NewSeasonCapt.json.data.isCaptain, true);
        strict_1.default.equal(p1NewSeasonCapt.json.data.teamId, team2._id);
        const p1PubFuture = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`);
        strict_1.default.equal(p1PubFuture.status, 200);
        strict_1.default.equal(p1PubFuture.json.data.activeCaptaincy.isCaptain, true);
        strict_1.default.equal(p1PubFuture.json.data.activeCaptaincy.team.id, team2._id);
        strict_1.default.equal(p1PubFuture.json.data.captaincyHistory.length, 2);
        // Multiple-time captain badge
        const multiBadge = p1PubFuture.json.data.captainBadges.find((b) => b.key === 'MULTIPLE_TIME_CAPTAIN');
        strict_1.default.ok(multiBadge, 'Expected MULTIPLE_TIME_CAPTAIN badge for player with 2 distinct season tenures');
        console.log('✔ Both records preserved across seasons and MULTIPLE_TIME_CAPTAIN badge earned');
        // =========================================================================
        // Scenario 12: Championship-winning captain retains badge and achievement
        // =========================================================================
        console.log('\n[Scenario 12] Championship-winning captain retains badge and achievement');
        // Set tournament winner to Team 1 for Tournament 1 in Season 1 (where P1 or P2 was captain)
        tourn.winnerTeamId = team1._id;
        tourn.status = 'COMPLETED';
        await tourn.save();
        const p1BadgesWithChampionship = await api(baseUrl, 'GET', `/api/players/public/${p1._id}`);
        strict_1.default.equal(p1BadgesWithChampionship.status, 200);
        const winBadge = p1BadgesWithChampionship.json.data.captainBadges.find((b) => b.key === 'CHAMPIONSHIP_WINNING_CAPTAIN' || b.key === 'WINNING_CAPTAIN');
        strict_1.default.ok(winBadge, 'Expected CHAMPIONSHIP_WINNING_CAPTAIN or WINNING_CAPTAIN badge');
        console.log('✔ Championship-winning captain badge successfully computed and verified');
        // =========================================================================
        // Scenario 13: Unauthorized requests to captain endpoints return 401/403
        // =========================================================================
        console.log('\n[Scenario 13] Unauthorized requests return 401/403');
        const anonRes = await api(baseUrl, 'GET', '/api/captains/my-status');
        strict_1.default.equal(anonRes.status, 401, 'Anonymous request must return 401');
        const anonSquad = await api(baseUrl, 'GET', '/api/captains/team-squad');
        strict_1.default.equal(anonSquad.status, 401, 'Anonymous request must return 401');
        // P2 is no longer captain (season completed)
        const p2Denied = await api(baseUrl, 'GET', '/api/captains/team-squad', undefined, p2Cookie);
        strict_1.default.equal(p2Denied.status, 403, 'Non-captain must return 403');
        console.log('✔ Unauthorized and unauthenticated access properly blocked (401/403)');
        // =========================================================================
        // Scenario 14: Captain cannot access other teams' lineups or private captain features
        // =========================================================================
        console.log('\n[Scenario 14] Captain cross-team isolation');
        // P1 is captain of Team 2 in Season 2.
        // Try to submit lineup for a match involving Team 1 vs another team as Team 1
        const p1CrossTeam = await api(baseUrl, 'POST', `/api/captains/lineup/${match._id}`, { playingXI: [p1._id], substitutes: [] }, p1Cookie);
        // Match 1 is in Season 1, where P1's captaincy ended. P1 is only captain of Team 2 in Season 2.
        strict_1.default.equal(p1CrossTeam.status, 403, 'Captain cannot manage lineups for other seasons/teams');
        console.log('✔ Captain cannot manage lineups outside their active team and season');
        // =========================================================================
        // Scenario 15: Database partial unique index prevents concurrent duplicate active captains
        // =========================================================================
        console.log('\n[Scenario 15] Database partial unique index verification');
        // Team 2 in Season 2 already has P1 as active captain.
        // Attempt direct database insert of another active captain for Team 2 in Season 2:
        let duplicateTeamError = false;
        try {
            await db_1.CaptaincyAssignment.create({
                seasonId: season2._id,
                teamId: team2._id,
                playerId: p2._id,
                assignedBy: 'admin',
                status: 'active',
            });
        }
        catch (err) {
            duplicateTeamError = err.code === 11000 || String(err.message).includes('duplicate') || String(err.message).includes('E11000');
        }
        strict_1.default.ok(duplicateTeamError, 'Expected duplicate key error (E11000) for two active captains on same team & season');
        // Attempt direct database insert of P1 being active captain for two different teams in same season:
        let duplicatePlayerError = false;
        try {
            await db_1.CaptaincyAssignment.create({
                seasonId: season2._id,
                teamId: team1._id,
                playerId: p1._id,
                assignedBy: 'admin',
                status: 'active',
            });
        }
        catch (err) {
            duplicatePlayerError = err.code === 11000 || String(err.message).includes('duplicate') || String(err.message).includes('E11000');
        }
        strict_1.default.ok(duplicatePlayerError, 'Expected duplicate key error (E11000) for same player captaining two teams in same season');
        console.log('✔ Database partial unique indexes strictly enforce 1 active captain per team and prevent dual-captaincy in same season');
        console.log('\n======================================================');
        console.log('🎉 ALL 15 CAPTAINCY SYSTEM SCENARIOS PASSED WITH 100% SUCCESS!');
        console.log('======================================================\n');
    }
    finally {
        // Cleanup tracked test artifacts
        if (tracked.assignmentIds.length > 0) {
            await db_1.CaptaincyAssignment.deleteMany({ _id: { $in: tracked.assignmentIds } });
        }
        if (tracked.announcementIds.length > 0) {
            await db_1.TeamAnnouncement.deleteMany({ _id: { $in: tracked.announcementIds } });
        }
        if (tracked.matchIds.length > 0) {
            await db_1.Match.deleteMany({ _id: { $in: tracked.matchIds } });
            await db_1.PlayingXISubmission.deleteMany({ matchId: { $in: tracked.matchIds } });
            await db_1.PlayerAvailability.deleteMany({ matchId: { $in: tracked.matchIds } });
        }
        if (tracked.tournamentIds.length > 0) {
            await db_1.Tournament.deleteMany({ _id: { $in: tracked.tournamentIds } });
        }
        if (tracked.seasonIds.length > 0) {
            await db_1.Season.deleteMany({ _id: { $in: tracked.seasonIds } });
            await db_1.TeamMembership.deleteMany({ seasonId: { $in: tracked.seasonIds } });
            await db_1.CaptaincyAuditLog.deleteMany({ seasonId: { $in: tracked.seasonIds } });
        }
        if (tracked.teamIds.length > 0) {
            await db_1.Team.deleteMany({ _id: { $in: tracked.teamIds } });
        }
        if (tracked.playerIds.length > 0) {
            await db_1.Player.deleteMany({ _id: { $in: tracked.playerIds } });
        }
        if (tracked.userIds.length > 0) {
            await db_1.User.deleteMany({ _id: { $in: tracked.userIds } });
        }
        server.close();
        process.exit(0);
    }
}
run().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
