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
const bootstrap_1 = require("../src/lib/bootstrap");
const auth_2 = __importDefault(require("../src/routes/auth"));
const player_auth_1 = __importDefault(require("../src/routes/player-auth"));
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
    await (0, db_1.connectDB)();
    await (0, auth_1.ensureDefaultAdmin)();
    await (0, bootstrap_1.ensurePlayerSystemBootstrap)();
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use((0, cookie_parser_1.default)());
    app.use('/api/auth', auth_2.default);
    app.use('/api/player-auth', player_auth_1.default);
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
    const server = node_http_1.default.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const adminToken = await (0, auth_1.createSessionToken)('test-admin', 'admin');
    const adminCookie = `${auth_1.ADMIN_COOKIE}=${encodeURIComponent(adminToken)}`;
    const stamp = Date.now();
    const tracked = {
        userIds: [],
        playerIds: [],
        teamIds: [],
        seasonIds: [],
        tournamentIds: [],
        matchIds: [],
        claimIds: [],
        emails: [],
        mobiles: [],
    };
    try {
        console.log('1. Testing OTP & Player Registration + Permanent PLR ID + Duplicate Prevention...');
        const email1 = `rahul.${stamp}@test.local`;
        const mobile1 = `+91987${String(stamp).slice(-7)}`;
        tracked.emails.push(email1);
        tracked.mobiles.push(mobile1);
        const otpSend = await api(baseUrl, 'POST', '/api/player-auth/otp/send', {
            channel: 'EMAIL',
            target: email1,
            purpose: 'REGISTER',
        });
        strict_1.default.equal(otpSend.status, 200);
        strict_1.default.ok(otpSend.json.data.devOtp, 'Expected devOtp in test environment');
        const otpVerify = await api(baseUrl, 'POST', '/api/player-auth/otp/verify', {
            channel: 'EMAIL',
            target: email1,
            purpose: 'REGISTER',
            code: otpSend.json.data.devOtp,
        });
        strict_1.default.equal(otpVerify.status, 200);
        const otpProofToken = otpVerify.json.data.otpProofToken;
        strict_1.default.ok(otpProofToken);
        const reg = await api(baseUrl, 'POST', '/api/player-auth/register', {
            name: 'Rahul Career Test',
            email: email1,
            mobile: mobile1,
            password: 'Password123',
            role: 'ALL_ROUNDER',
            battingStyle: 'RIGHT_HAND',
            bowlingStyle: 'RIGHT_ARM_OFF_SPIN',
            otpProofToken,
        });
        strict_1.default.equal(reg.status, 201, JSON.stringify(reg.json));
        const rahulUserId = reg.json.data.user.id;
        const rahulId = reg.json.data.player.id;
        const rahulCode = reg.json.data.player.playerCode;
        tracked.userIds.push(rahulUserId);
        tracked.playerIds.push(rahulId);
        strict_1.default.match(rahulCode, /^PLR-\d{4}-\d{6}$/, 'Expected PLR-YYYY-NNNNNN format');
        const initialAccess = cookieValue(reg.setCookies, 'cricket_player_access');
        const initialRefresh = cookieValue(reg.setCookies, 'cricket_player_refresh');
        strict_1.default.ok(initialAccess && initialRefresh, 'Expected HTTP-only access & refresh cookies');
        // Duplicate email & duplicate mobile check
        const otpSend2 = await api(baseUrl, 'POST', '/api/player-auth/otp/send', {
            channel: 'EMAIL',
            target: email1,
            purpose: 'REGISTER',
        });
        strict_1.default.equal(otpSend2.status, 409);
        const altEmail = `alt.${stamp}@test.local`;
        tracked.emails.push(altEmail);
        const otpAlt = await api(baseUrl, 'POST', '/api/player-auth/otp/send', {
            channel: 'EMAIL',
            target: altEmail,
            purpose: 'REGISTER',
        });
        const otpAltVerify = await api(baseUrl, 'POST', '/api/player-auth/otp/verify', {
            channel: 'EMAIL',
            target: altEmail,
            purpose: 'REGISTER',
            code: otpAlt.json.data.devOtp,
        });
        const dupMobReg = await api(baseUrl, 'POST', '/api/player-auth/register', {
            name: 'Duplicate Mobile',
            email: altEmail,
            mobile: mobile1,
            password: 'Password123',
            otpProofToken: otpAltVerify.json.data.otpProofToken,
        });
        strict_1.default.equal(dupMobReg.status, 409);
        console.log('2. Testing Login, Refresh Token Rotation, & Stats Tamper Protection...');
        const login = await api(baseUrl, 'POST', '/api/player-auth/login', {
            identifier: email1,
            password: 'Password123',
        });
        strict_1.default.equal(login.status, 200);
        const loginRefresh1 = cookieValue(login.setCookies, 'cricket_player_refresh');
        strict_1.default.ok(loginRefresh1);
        const refreshRes = await api(baseUrl, 'POST', '/api/player-auth/refresh', {}, `cricket_player_refresh=${encodeURIComponent(loginRefresh1)}`);
        strict_1.default.equal(refreshRes.status, 200);
        const rotatedRefresh = cookieValue(refreshRes.setCookies, 'cricket_player_refresh');
        const freshAccess = cookieValue(refreshRes.setCookies, 'cricket_player_access');
        strict_1.default.ok(rotatedRefresh && rotatedRefresh !== loginRefresh1, 'Refresh token must rotate');
        // Reuse old refresh token must fail
        const reuseRes = await api(baseUrl, 'POST', '/api/player-auth/refresh', {}, `cricket_player_refresh=${encodeURIComponent(loginRefresh1)}`);
        strict_1.default.equal(reuseRes.status, 401);
        // Reject illegal stats/playerCode tampering with 403, then allow legitimate personal/privacy edits
        const playerCookie = `cricket_player_access=${encodeURIComponent(freshAccess)}`;
        const tamperRes = await api(baseUrl, 'PATCH', '/api/player-auth/profile', { playerCode: 'PLR-FAKE-000001', runs: 99999 }, playerCookie);
        strict_1.default.equal(tamperRes.status, 403, 'Player cannot manually edit official field playerCode/stats');
        const patchProf = await api(baseUrl, 'PATCH', '/api/player-auth/profile', {
            city: 'Pune Hidden',
            bio: 'Club all-rounder',
            privacy: { showCity: false, showDob: false },
        }, playerCookie);
        strict_1.default.equal(patchProf.status, 200);
        strict_1.default.equal(patchProf.json.data.player.playerCode, rahulCode, 'Player cannot mutate playerCode');
        strict_1.default.equal(patchProf.json.data.player.city, 'Pune Hidden');
        console.log('3. Testing Season-Based Team Memberships Across 2026 / 2027 / 2028...');
        const makeTeam = async (name, shortName) => {
            const r = await api(baseUrl, 'POST', '/api/teams', { name: `${name}-${stamp}`, shortName }, adminCookie);
            strict_1.default.equal(r.status, 201, JSON.stringify(r.json));
            tracked.teamIds.push(r.json.data.id);
            return r.json.data;
        };
        const nexBitz = await makeTeam('NexBitz', `NB${String(stamp).slice(-2)}`);
        const mavericks = await makeTeam('Mavericks', `MV${String(stamp).slice(-2)}`);
        const dominator = await makeTeam('Dominator', `DM${String(stamp).slice(-2)}`);
        const makeSeason = async (name, code, year, status) => {
            const r = await api(baseUrl, 'POST', '/api/seasons', { name: `${name}-${stamp}`, code: `${code}-${stamp}`, year, status }, adminCookie);
            strict_1.default.equal(r.status, 201, JSON.stringify(r.json));
            tracked.seasonIds.push(r.json.data.id);
            return r.json.data;
        };
        const s2026 = await makeSeason('Season 2026T', 'S26', 2026, 'COMPLETED');
        const s2027 = await makeSeason('Season 2027T', 'S27', 2027, 'COMPLETED');
        const s2028 = await makeSeason('Season 2028T', 'S28', 2028, 'ACTIVE');
        const makeTournament = async (name, seasonId) => {
            const r = await api(baseUrl, 'POST', '/api/tournaments', { name: `${name}-${stamp}`, seasonId, format: 'T20', status: 'ACTIVE' }, adminCookie);
            strict_1.default.equal(r.status, 201, JSON.stringify(r.json));
            tracked.tournamentIds.push(r.json.data.id);
            return r.json.data;
        };
        const t2026 = await makeTournament('Trophy 2026', s2026.id);
        const t2027 = await makeTournament('Trophy 2027', s2027.id);
        for (const [seasonId, teamId] of [
            [s2026.id, nexBitz.id],
            [s2027.id, mavericks.id],
            [s2028.id, dominator.id],
        ]) {
            const mr = await api(baseUrl, 'POST', '/api/memberships', { playerId: rahulId, teamId, seasonId, designation: 'CAPTAIN' }, adminCookie);
            strict_1.default.equal(mr.status, 201, JSON.stringify(mr.json));
        }
        // Completed season overwrite MUST be blocked
        const overwriteCompleted = await api(baseUrl, 'POST', '/api/memberships', { playerId: rahulId, teamId: dominator.id, seasonId: s2026.id, replaceExisting: true }, adminCookie);
        strict_1.default.equal(overwriteCompleted.status, 409);
        // Duplicate same active season without replaceExisting MUST be blocked
        const dupActive = await api(baseUrl, 'POST', '/api/memberships', { playerId: rahulId, teamId: mavericks.id, seasonId: s2028.id }, adminCookie);
        strict_1.default.equal(dupActive.status, 409);
        console.log('4. Creating Squad Players & Scoring Match (HIT_WICKET+6, RUN_OUT, WIDE+STUMPED, NO_BALL, MAIDEN, RETIRED_HURT)...');
        const createRosterPlayer = async (name, teamId, role = 'BATTER') => {
            const r = await api(baseUrl, 'POST', '/api/players', { name, teamId, role }, adminCookie);
            strict_1.default.equal(r.status, 201, JSON.stringify(r.json));
            tracked.playerIds.push(r.json.data.id);
            return r.json.data;
        };
        const pA2 = await createRosterPlayer(`Partner A2 ${stamp}`, nexBitz.id, 'BATTER');
        const pA3 = await createRosterPlayer(`Partner A3 ${stamp}`, nexBitz.id, 'BATTER');
        const pA4 = await createRosterPlayer(`Partner A4 ${stamp}`, nexBitz.id, 'BOWLER');
        const b1 = await createRosterPlayer(`Bowler X ${stamp}`, mavericks.id, 'BOWLER');
        const wk = await createRosterPlayer(`Keeper Z ${stamp}`, mavericks.id, 'WICKETKEEPER');
        const f1 = await createRosterPlayer(`Fielder Y ${stamp}`, mavericks.id, 'ALL_ROUNDER');
        const b4 = await createRosterPlayer(`Batter B4 ${stamp}`, mavericks.id, 'BATTER');
        // Also add 2026 memberships for these squad members cleanly via admin match squad + membership
        const matchRes = await api(baseUrl, 'POST', '/api/matches', {
            title: `Test Integration Match ${stamp}`,
            venue: 'Test Ground',
            format: 'CUSTOM',
            totalOvers: 2,
            teamAId: nexBitz.id,
            teamBId: mavericks.id,
            seasonId: s2026.id,
            tournamentId: t2026.id,
            playingXIA: [rahulId, pA2.id, pA3.id, pA4.id],
            playingXIB: [b1.id, wk.id, f1.id, b4.id],
        }, adminCookie);
        strict_1.default.equal(matchRes.status, 201, JSON.stringify(matchRes.json));
        const matchId = matchRes.json.data.id;
        tracked.matchIds.push(matchId);
        const toss1 = await api(baseUrl, 'POST', `/api/matches/${matchId}/toss`, { tossWinnerId: nexBitz.id, decision: 'BAT' }, adminCookie);
        strict_1.default.equal(toss1.status, 200, JSON.stringify(toss1.json));
        const start1 = await api(baseUrl, 'POST', `/api/matches/${matchId}/start`, { strikerId: rahulId, nonStrikerId: pA2.id, bowlerId: b1.id }, adminCookie);
        strict_1.default.equal(start1.status, 200, JSON.stringify(start1.json));
        const mustOk = async (method, path, body) => {
            const r = await api(baseUrl, method, path, body, adminCookie);
            strict_1.default.equal(r.status, 200, `${method} ${path} failed: ${JSON.stringify(r.json)}`);
            return r;
        };
        // Delivery 1 (legal 1): Rahul hits 6
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 6 });
        // Delivery 2 (legal 2): Rahul hits 4
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 4 });
        // Delivery 3 (wide): +1 wide
        await mustOk('POST', `/api/matches/${matchId}/ball`, { extraType: 'WIDE', extraRuns: 1 });
        // Delivery 4 (no-ball): Rahul hits 4 off NB (extraRuns=1) -> +4 runs + ball faced!
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 4, extraType: 'NO_BALL', extraRuns: 1 });
        // Delivery 5 (legal 3): Rahul hits 6 AND gets HIT_WICKET -> +6 runs, OUT, bowler gets 0 wickets!
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 6, wicketType: 'HIT_WICKET' });
        // Bring in Partner A3
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BATSMAN', playerId: pA3.id });
        // Delivery 6 (legal 4): pA3 gets RUN_OUT (assistId = Fielder f1) -> 0 bowler wickets, Fielder gets 1 run-out
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0, wicketType: 'RUN_OUT', dismissedId: pA3.id, assistId: f1.id });
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BATSMAN', playerId: pA4.id });
        // Deliveries 7 & 8 (legal 5 & 6): dot balls -> Over 1 complete
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0 });
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0 });
        // Over 2 by f1: maiden over (6 dot balls) -> Inn 1 complete -> INNINGS_BREAK
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BOWLER', playerId: f1.id });
        for (let i = 0; i < 6; i++) {
            await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0 });
        }
        // Start Innings 2: mavericks chasing
        await mustOk('POST', `/api/matches/${matchId}/start`, { strikerId: b1.id, nonStrikerId: wk.id, bowlerId: rahulId });
        // Ball 1 (WIDE + STUMPED by pA3): Rahul gets 1 official wicket, pA3 gets 1 stumping
        await mustOk('POST', `/api/matches/${matchId}/ball`, { extraType: 'WIDE', extraRuns: 1, wicketType: 'STUMPED', assistId: pA3.id });
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BATSMAN', playerId: f1.id });
        // Bowl 6 dots + end innings 2 via second over dots
        for (let i = 0; i < 6; i++) {
            await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0 });
        }
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BOWLER', playerId: pA4.id });
        await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0, wicketType: 'BOWLED' });
        await mustOk('POST', `/api/matches/${matchId}/action`, { action: 'NEW_BATSMAN', playerId: b4.id });
        for (let i = 0; i < 5; i++) {
            const mRes = await mustOk('POST', `/api/matches/${matchId}/ball`, { runsOffBat: 0 });
            if (i === 4) {
                strict_1.default.equal(mRes.json.data.match.status, 'COMPLETED', 'Match should be COMPLETED after over 2');
            }
        }
        console.log('5. Verifying Pre-Verification Zero Career Stats -> Finalize -> Verify Idempotency -> Scoring Rules...');
        const preDash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, playerCookie);
        strict_1.default.equal(preDash.status, 200);
        strict_1.default.equal(preDash.json.data.career.matches, 0, 'Unverified match must NOT count in career stats');
        strict_1.default.equal(preDash.json.data.career.runs, 0);
        const finRes = await api(baseUrl, 'POST', `/api/matches/${matchId}/finalize`, {}, adminCookie);
        strict_1.default.equal(finRes.status, 200);
        strict_1.default.equal(finRes.json.data.match.scorecardStatus, 'FINALIZED');
        const verRes1 = await api(baseUrl, 'POST', `/api/matches/${matchId}/verify`, { playerOfMatchId: rahulId }, adminCookie);
        strict_1.default.equal(verRes1.status, 200, JSON.stringify(verRes1.json));
        strict_1.default.equal(verRes1.json.data.idempotent, false);
        strict_1.default.equal(verRes1.json.data.payload.match.scorecardStatus, 'VERIFIED');
        // Second verify MUST be idempotent!
        const verRes2 = await api(baseUrl, 'POST', `/api/matches/${matchId}/verify`, {}, adminCookie);
        strict_1.default.equal(verRes2.status, 200);
        strict_1.default.equal(verRes2.json.data.idempotent, true, 'Duplicate verify call must be idempotent');
        // Assert exact calculated career stats for Rahul
        const postDash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, playerCookie);
        strict_1.default.equal(postDash.status, 200);
        const rc = postDash.json.data.career;
        strict_1.default.equal(rc.matches, 1);
        strict_1.default.equal(rc.runs, 20, 'Expected 6 + 4 + 4(nb) + 6(hw) = 20 runs');
        strict_1.default.equal(rc.ballsFaced, 4, 'Wide must not count as ball faced; NB + 3 legal = 4');
        strict_1.default.equal(rc.fours, 2);
        strict_1.default.equal(rc.sixes, 2);
        strict_1.default.equal(rc.wickets, 1, 'STUMPED off wide counts as 1 bowler wicket');
        strict_1.default.equal(rc.maidens, 0, 'Conceded 1 wide in over 1 -> 1 run conceded -> not maiden!');
        strict_1.default.equal(rc.playerOfMatchAwards, 1);
        // Verify Bowler X had 0 wickets (HIT_WICKET & RUN_OUT excluded!) and Fielder f1 had 1 run-out & 1 maiden!
        const b1Career = await api(baseUrl, 'GET', `/api/players/${b1.id}/career`);
        strict_1.default.equal(b1Career.json.data.career.wickets, 0, 'HIT_WICKET and RUN_OUT must NOT credit bowler wicket');
        const f1Career = await api(baseUrl, 'GET', `/api/players/${f1.id}/career`);
        strict_1.default.equal(f1Career.json.data.career.runOuts, 1);
        strict_1.default.equal(f1Career.json.data.career.maidens, 1);
        const pA3Career = await api(baseUrl, 'GET', `/api/players/${pA3.id}/career`);
        strict_1.default.equal(pA3Career.json.data.career.stumpings, 1);
        console.log('6. Testing Correction Workflow (RETIRED_HURT & POM Recalculation) + Audit Log...');
        const correctRes = await api(baseUrl, 'POST', `/api/matches/${matchId}/correct`, {
            playerStatuses: [{ playerId: pA4.id, status: 'RETIRED_HURT', notes: 'Hamstring cramp' }],
            reverify: true,
            reason: 'Mark Partner A4 as retired hurt during match',
        }, adminCookie);
        strict_1.default.equal(correctRes.status, 200);
        const pA4Career = await api(baseUrl, 'GET', `/api/players/${pA4.id}/career`);
        strict_1.default.equal(pA4Career.json.data.career.notOuts, 1, 'RETIRED_HURT must remain not out');
        console.log('7. Testing Unclaimed Historical Player Creation -> Registered Claim -> Admin Approval/Merge...');
        const unclaimedRes = await api(baseUrl, 'POST', '/api/players', { name: `Rahul Unclaimed ${stamp}`, teamId: mavericks.id, role: 'ALL_ROUNDER' }, adminCookie);
        strict_1.default.equal(unclaimedRes.status, 201);
        const unclaimedId = unclaimedRes.json.data.id;
        tracked.playerIds.push(unclaimedId);
        strict_1.default.equal(unclaimedRes.json.data.isClaimed, false);
        // Give unclaimed player a verified historical match in 2027 (Mavericks vs Dominator)
        const histMatchRes = await api(baseUrl, 'POST', '/api/matches', {
            title: `Historical 2027 Match ${stamp}`,
            venue: 'Old Turf',
            format: 'CUSTOM',
            totalOvers: 2,
            teamAId: mavericks.id,
            teamBId: dominator.id,
            seasonId: s2027.id,
            tournamentId: t2027.id,
            playingXIA: [unclaimedId, f1.id],
            playingXIB: [await createRosterPlayer(`Dom Bowler ${stamp}`, dominator.id, 'BOWLER').then((d) => d.id), await createRosterPlayer(`Dom Bat ${stamp}`, dominator.id, 'BATTER').then((d) => d.id)],
        }, adminCookie);
        const histMatchId = histMatchRes.json.data.id;
        tracked.matchIds.push(histMatchId);
        const mData = histMatchRes.json.data;
        const domIds = mData.playingXIB;
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/toss`, { tossWinnerId: mavericks.id, decision: 'BAT' }, adminCookie);
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/start`, { strikerId: unclaimedId, nonStrikerId: f1.id, bowlerId: domIds[0] }, adminCookie);
        for (let i = 0; i < 6; i++) {
            await api(baseUrl, 'POST', `/api/matches/${histMatchId}/ball`, { runsOffBat: 6 }, adminCookie); // 36 runs
        }
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/action`, { action: 'NEW_BOWLER', playerId: domIds[1] }, adminCookie);
        for (let i = 0; i < 6; i++) {
            await api(baseUrl, 'POST', `/api/matches/${histMatchId}/ball`, { runsOffBat: 4 }, adminCookie); // +24 = 60 runs!
        }
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/start`, { strikerId: domIds[0], nonStrikerId: domIds[1], bowlerId: unclaimedId }, adminCookie);
        for (let i = 0; i < 6; i++) {
            await api(baseUrl, 'POST', `/api/matches/${histMatchId}/ball`, { runsOffBat: 0 }, adminCookie);
        }
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/action`, { action: 'NEW_BOWLER', playerId: f1.id }, adminCookie);
        for (let i = 0; i < 6; i++) {
            await api(baseUrl, 'POST', `/api/matches/${histMatchId}/ball`, { runsOffBat: 0 }, adminCookie);
        }
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/finalize`, {}, adminCookie);
        await api(baseUrl, 'POST', `/api/matches/${histMatchId}/verify`, {}, adminCookie);
        // Registered player searches claim candidates & requests OTP for CLAIM_PROFILE
        const candRes = await api(baseUrl, 'GET', `/api/player-auth/claim-candidates?q=Rahul`, undefined, playerCookie);
        strict_1.default.equal(candRes.status, 200);
        strict_1.default.ok(candRes.json.data.some((c) => c.id === unclaimedId), 'Claim candidates should include unclaimed record');
        const claimOtpSend = await api(baseUrl, 'POST', '/api/player-auth/otp/send', { channel: 'EMAIL', target: email1, purpose: 'CLAIM_PROFILE' }, playerCookie);
        const claimOtpVerify = await api(baseUrl, 'POST', '/api/player-auth/otp/verify', { channel: 'EMAIL', target: email1, purpose: 'CLAIM_PROFILE', code: claimOtpSend.json.data.devOtp }, playerCookie);
        const submitClaim = await api(baseUrl, 'POST', '/api/player-auth/claims', {
            targetPlayerId: unclaimedId,
            verificationMethod: 'OTP_EMAIL',
            otpProofToken: claimOtpVerify.json.data.otpProofToken,
            evidenceNotes: 'Played under Mavericks in 2027',
        }, playerCookie);
        strict_1.default.equal(submitClaim.status, 201, JSON.stringify(submitClaim.json));
        const claimId = submitClaim.json.data.id;
        tracked.claimIds.push(claimId);
        // Admin approves claim -> merges unclaimed record into Rahul's permanent profile!
        const resolveRes = await api(baseUrl, 'POST', `/api/admin/claims/${claimId}/resolve`, { decision: 'APPROVE', reason: 'Identity verified' }, adminCookie);
        strict_1.default.equal(resolveRes.status, 200, JSON.stringify(resolveRes.json));
        const mergedOld = await db_1.Player.findById(unclaimedId).lean();
        strict_1.default.equal(mergedOld?.status, 'MERGED');
        strict_1.default.equal(mergedOld?.mergedIntoPlayerId, rahulId);
        const mergedDash = await api(baseUrl, 'GET', '/api/player-auth/dashboard', undefined, playerCookie);
        strict_1.default.equal(mergedDash.json.data.player.playerCode, rahulCode, 'Permanent PLR ID must remain unchanged after claim merge');
        strict_1.default.equal(mergedDash.json.data.career.matches, 2, 'Claimed match must appear in career history');
        strict_1.default.equal(mergedDash.json.data.career.runs, 56, 'Career runs must combine 20 + 36 (strike rotates end of over 1) = 56');
        console.log('8. Testing Public Player Profile Privacy, Season Team History, Leaderboards, & Audit Logs...');
        const pubRes = await api(baseUrl, 'GET', `/api/players/public/${rahulCode}`);
        strict_1.default.equal(pubRes.status, 200, JSON.stringify(pubRes.json));
        strict_1.default.equal(pubRes.json.data.player.playerCode, rahulCode);
        strict_1.default.equal(pubRes.json.data.player.city, null, 'Private city must be hidden when showCity=false');
        strict_1.default.equal(pubRes.json.data.player.email, undefined, 'Email must never be exposed publicly');
        strict_1.default.equal(pubRes.json.data.player.mobile, undefined, 'Mobile must never be exposed publicly');
        strict_1.default.equal(pubRes.json.data.career.seasonBreakdown.length, 2, 'Career breakdown should have both 2026 & 2027 seasons');
        const memSeasons = new Set(pubRes.json.data.memberships.map((m) => m.seasonId));
        strict_1.default.ok(memSeasons.has(s2026.id) && memSeasons.has(s2027.id) && memSeasons.has(s2028.id), 'Team memberships must retain all 3 assigned seasons');
        const lbRuns = await api(baseUrl, 'GET', `/api/leaderboards?category=runs&scope=SEASON&seasonId=${s2027.id}`);
        strict_1.default.equal(lbRuns.status, 200);
        strict_1.default.ok(lbRuns.json.data.entries.some((e) => e.playerId === rahulId && e.runs === 36));
        const auditRes = await api(baseUrl, 'GET', `/api/admin/audit-logs?playerId=${rahulId}&limit=50`, undefined, adminCookie);
        strict_1.default.equal(auditRes.status, 200);
        strict_1.default.ok(auditRes.json.data.some((l) => l.action === 'MERGE_PLAYERS'));
        console.log('9. Testing Forgot Password Email-Inbox-Only OTP & Reset Flow...');
        const resetMobileReject = await api(baseUrl, 'POST', '/api/player-auth/otp/send', {
            channel: 'MOBILE',
            target: mobile1,
            purpose: 'RESET_PASSWORD',
        });
        strict_1.default.equal(resetMobileReject.status, 400, 'Forgot password must reject MOBILE OTP channel');
        const resetUnknownEmail = await api(baseUrl, 'POST', '/api/player-auth/forgot-password/send', {
            email: `missing.${stamp}@test.local`,
        });
        strict_1.default.equal(resetUnknownEmail.status, 404, 'Forgot password should reject unknown email accounts');
        const resetOtpSend = await api(baseUrl, 'POST', '/api/player-auth/forgot-password/send', {
            email: email1,
        });
        strict_1.default.equal(resetOtpSend.status, 200, JSON.stringify(resetOtpSend.json));
        strict_1.default.equal(resetOtpSend.json.data.channel, 'EMAIL');
        strict_1.default.ok(resetOtpSend.json.data.devOtp, 'Synthetic @test.local should return OTP in test mode');
        // Invalid password format must fail cleanly without consuming the valid OTP
        const weakReset = await api(baseUrl, 'POST', '/api/player-auth/forgot-password/reset', {
            email: email1,
            otpCode: resetOtpSend.json.data.devOtp,
            newPassword: 'short',
        });
        strict_1.default.equal(weakReset.status, 400);
        const resetOk = await api(baseUrl, 'POST', '/api/player-auth/forgot-password/reset', {
            email: email1,
            otpCode: resetOtpSend.json.data.devOtp,
            newPassword: 'NewPassword456',
        });
        strict_1.default.equal(resetOk.status, 200, JSON.stringify(resetOk.json));
        strict_1.default.equal(resetOk.json.data.reset, true);
        // Prior refresh token must be revoked after password reset
        const oldRefreshAfterReset = await api(baseUrl, 'POST', '/api/player-auth/refresh', {}, `cricket_player_refresh=${encodeURIComponent(rotatedRefresh)}`);
        strict_1.default.equal(oldRefreshAfterReset.status, 401, 'Password reset must revoke active refresh tokens');
        const oldPwdLogin = await api(baseUrl, 'POST', '/api/player-auth/login', {
            identifier: email1,
            password: 'Password123',
        });
        strict_1.default.equal(oldPwdLogin.status, 401, 'Old password must fail after reset');
        const newPwdLogin = await api(baseUrl, 'POST', '/api/player-auth/login', {
            identifier: email1,
            password: 'NewPassword456',
        });
        strict_1.default.equal(newPwdLogin.status, 200, 'New password must sign in after reset');
        console.log('ALL PLAYER CAREER INTEGRATION CHECKS PASSED');
    }
    finally {
        // Clean up ONLY entities created by this integration run
        const matchInns = tracked.matchIds.length > 0 ? await db_1.Innings.find({ matchId: { $in: tracked.matchIds } }).select({ _id: 1 }).lean() : [];
        const innIds = matchInns.map((i) => i._id);
        await Promise.all([
            innIds.length > 0 ? db_1.Ball.deleteMany({ inningsId: { $in: innIds } }) : Promise.resolve(),
            tracked.matchIds.length > 0 ? db_1.Innings.deleteMany({ matchId: { $in: tracked.matchIds } }) : Promise.resolve(),
            tracked.matchIds.length > 0 ? db_1.Match.deleteMany({ _id: { $in: tracked.matchIds } }) : Promise.resolve(),
            tracked.matchIds.length > 0 ? db_1.PlayerMatchStat.deleteMany({ matchId: { $in: tracked.matchIds } }) : Promise.resolve(),
            tracked.playerIds.length > 0 ? db_1.PlayerCareerStat.deleteMany({ playerId: { $in: tracked.playerIds } }) : Promise.resolve(),
            tracked.playerIds.length > 0 ? db_1.TeamMembership.deleteMany({ playerId: { $in: tracked.playerIds } }) : Promise.resolve(),
            tracked.playerIds.length > 0 ? db_1.Player.deleteMany({ _id: { $in: tracked.playerIds } }) : Promise.resolve(),
            tracked.userIds.length > 0 ? db_1.User.deleteMany({ _id: { $in: tracked.userIds } }) : Promise.resolve(),
            tracked.userIds.length > 0 ? db_1.RefreshToken.deleteMany({ userId: { $in: tracked.userIds } }) : Promise.resolve(),
            tracked.claimIds.length > 0 ? db_1.PlayerProfileClaim.deleteMany({ _id: { $in: tracked.claimIds } }) : Promise.resolve(),
            tracked.teamIds.length > 0 ? db_1.Team.deleteMany({ _id: { $in: tracked.teamIds } }) : Promise.resolve(),
            tracked.tournamentIds.length > 0 ? db_1.Tournament.deleteMany({ _id: { $in: tracked.tournamentIds } }) : Promise.resolve(),
            tracked.seasonIds.length > 0 ? db_1.Season.deleteMany({ _id: { $in: tracked.seasonIds } }) : Promise.resolve(),
            tracked.matchIds.length > 0 ? db_1.Award.deleteMany({ matchId: { $in: tracked.matchIds } }) : Promise.resolve(),
            tracked.emails.length > 0 ? db_1.OtpVerification.deleteMany({ target: { $in: tracked.emails } }) : Promise.resolve(),
            tracked.mobiles.length > 0 ? db_1.OtpVerification.deleteMany({ target: { $in: tracked.mobiles } }) : Promise.resolve(),
            tracked.playerIds.length > 0
                ? db_1.StatisticsAuditLog.deleteMany({
                    $or: [
                        { playerId: { $in: tracked.playerIds } },
                        { sourcePlayerId: { $in: tracked.playerIds } },
                        { targetPlayerId: { $in: tracked.playerIds } },
                        { matchId: { $in: tracked.matchIds } },
                    ],
                })
                : Promise.resolve(),
        ]);
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
run()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
