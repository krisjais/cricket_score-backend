"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const bootstrap_1 = require("../lib/bootstrap");
const stats_service_1 = require("../lib/stats-service");
const match_service_1 = require("../lib/match-service");
const match_state_1 = require("../lib/match-state");
const broadcast_1 = require("../lib/broadcast");
const cricket_1 = require("../lib/cricket");
const router = (0, express_1.Router)();
const ACTIONS = [
    'NEW_BATSMAN',
    'NEW_BOWLER',
    'SWAP_STRIKE',
    'PAUSE',
    'RESUME',
    'END_INNINGS',
    'ABANDON',
];
// GET /api/matches - List all matches
router.get('/', async (req, res) => {
    try {
        const status = req.query.status;
        let summaries = await (0, match_state_1.buildMatchSummaries)();
        if (status && status !== 'ALL') {
            summaries = summaries.filter((m) => m.status === status);
        }
        return (0, api_utils_1.sendOk)(res, summaries);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to list matches', 500);
    }
});
// POST /api/matches - Create a match
router.post('/', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { teamAId, teamBId, format: rawFormat, totalOvers: rawOvers, venue } = req.body ?? {};
    if (!teamAId || !teamBId)
        return (0, api_utils_1.sendFail)(res, 'Both teams are required');
    if (teamAId === teamBId)
        return (0, api_utils_1.sendFail)(res, 'A team cannot play against itself');
    const [a, b] = await Promise.all([
        db_1.db.team.findUnique({ where: { id: teamAId } }),
        db_1.db.team.findUnique({ where: { id: teamBId } }),
    ]);
    if (!a)
        return (0, api_utils_1.sendFail)(res, 'Team A not found', 404);
    if (!b)
        return (0, api_utils_1.sendFail)(res, 'Team B not found', 404);
    const format = rawFormat && ['T10', 'T20', 'ODI', 'CUSTOM'].includes(rawFormat) ? rawFormat : 'T20';
    let totalOvers;
    if (format === 'CUSTOM') {
        totalOvers = Math.floor(Number(rawOvers ?? 0));
        if (!Number.isInteger(totalOvers) || totalOvers < 1 || totalOvers > 50) {
            return (0, api_utils_1.sendFail)(res, 'Custom overs must be between 1 and 50');
        }
    }
    else {
        totalOvers = cricket_1.FORMAT_OVERS[format];
    }
    const defaults = await (0, bootstrap_1.ensureDefaultSeasonAndTournament)();
    const seasonId = typeof req.body?.seasonId === 'string' && req.body.seasonId.trim()
        ? req.body.seasonId.trim()
        : defaults.season._id;
    const tournamentId = typeof req.body?.tournamentId === 'string' && req.body.tournamentId.trim()
        ? req.body.tournamentId.trim()
        : defaults.tournament._id;
    const matchDate = req.body?.matchDate ? new Date(req.body.matchDate) : new Date();
    const playingXIA = Array.isArray(req.body?.playingXIA) ? req.body.playingXIA : [];
    const playingXIB = Array.isArray(req.body?.playingXIB) ? req.body.playingXIB : [];
    const match = await db_1.db.match.create({
        data: {
            teamAId,
            teamBId,
            seasonId,
            tournamentId,
            matchDate: Number.isNaN(matchDate.getTime()) ? new Date() : matchDate,
            playingXIA,
            playingXIB,
            format,
            totalOvers,
            venue: typeof venue === 'string' ? venue.trim() || null : null,
            status: 'SCHEDULED',
            scorecardStatus: 'DRAFT',
        },
    });
    const summaries = await (0, match_state_1.buildMatchSummaries)();
    await (0, broadcast_1.emitToRoom)('matches', 'matches:update', summaries);
    return (0, api_utils_1.sendOk)(res, match, 201);
});
// GET /api/matches/:id - Get full match details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const payload = await (0, match_service_1.buildMatchPayload)(id);
        if (!payload)
            return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
        return (0, api_utils_1.sendOk)(res, payload);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to fetch match', 500);
    }
});
// PATCH /api/matches/:id - Update match settings
router.patch('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const match = await db_1.db.match.findUnique({ where: { id } });
    if (!match)
        return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
    const body = req.body ?? {};
    const editable = match.status === 'SCHEDULED' || match.status === 'TOSS_DONE';
    let format = match.format;
    let totalOvers = match.totalOvers;
    if (body.format && body.format !== match.format) {
        if (!editable)
            return (0, api_utils_1.sendFail)(res, 'Format can only be changed before the match starts');
        if (!['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format))
            return (0, api_utils_1.sendFail)(res, 'Invalid format');
        format = body.format;
    }
    if (body.teamAId || body.teamBId) {
        if (!editable)
            return (0, api_utils_1.sendFail)(res, 'Teams can only be changed before the match starts');
    }
    const teamAId = body.teamAId ?? match.teamAId;
    const teamBId = body.teamBId ?? match.teamBId;
    if (teamAId === teamBId)
        return (0, api_utils_1.sendFail)(res, 'A team cannot play against itself');
    if (body.teamAId || body.teamBId) {
        const [a, b] = await Promise.all([
            db_1.db.team.findUnique({ where: { id: teamAId } }),
            db_1.db.team.findUnique({ where: { id: teamBId } }),
        ]);
        if (!a)
            return (0, api_utils_1.sendFail)(res, 'Team A not found', 404);
        if (!b)
            return (0, api_utils_1.sendFail)(res, 'Team B not found', 404);
    }
    if (format === 'CUSTOM') {
        if (body.totalOvers !== undefined) {
            if (!editable)
                return (0, api_utils_1.sendFail)(res, 'Overs can only be changed before the match starts');
            const n = Math.floor(Number(body.totalOvers));
            if (!Number.isInteger(n) || n < 1 || n > 50)
                return (0, api_utils_1.sendFail)(res, 'Custom overs must be between 1 and 50');
            totalOvers = n;
        }
    }
    else {
        totalOvers = match.totalOvers;
    }
    const updated = await db_1.db.match.update({
        where: { id },
        data: {
            venue: body.venue !== undefined ? body.venue?.trim() || null : match.venue,
            format,
            totalOvers,
            teamAId,
            teamBId,
            ...(body.seasonId !== undefined ? { seasonId: body.seasonId || null } : {}),
            ...(body.tournamentId !== undefined ? { tournamentId: body.tournamentId || null } : {}),
            ...(body.matchDate !== undefined ? { matchDate: body.matchDate ? new Date(body.matchDate) : null } : {}),
            ...(Array.isArray(body.playingXIA) ? { playingXIA: body.playingXIA } : {}),
            ...(Array.isArray(body.playingXIB) ? { playingXIB: body.playingXIB } : {}),
            ...(body.playerOfMatchId !== undefined ? { playerOfMatchId: body.playerOfMatchId || null } : {}),
            ...(Array.isArray(body.playerStatuses) ? { playerStatuses: body.playerStatuses } : {}),
        },
    });
    await (0, match_service_1.emitMatchUpdate)(updated.id);
    return (0, api_utils_1.sendOk)(res, (await (0, match_service_1.buildMatchPayload)(updated.id)) ?? updated);
});
// DELETE /api/matches/:id - Delete a match
router.delete('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const match = await db_1.db.match.findUnique({ where: { id } });
    if (!match)
        return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
    const affectedStats = await db_1.PlayerMatchStat.find({ matchId: id }).select({ playerId: 1 }).lean();
    await db_1.db.match.delete({ where: { id } });
    if (affectedStats.length > 0) {
        await db_1.PlayerMatchStat.deleteMany({ matchId: id });
        await db_1.Award.deleteMany({ matchId: id });
        await (0, stats_service_1.rebuildCareerStatsForPlayers)(affectedStats.map((s) => s.playerId));
    }
    const summaries = await (0, match_state_1.buildMatchSummaries)();
    await (0, broadcast_1.emitToRoom)('matches', 'matches:update', summaries);
    await (0, broadcast_1.emitToRoom)(`match:${id}`, 'match:update', null);
    return (0, api_utils_1.sendOk)(res, { deleted: true });
});
// POST /api/matches/:id/toss - Record toss
router.post('/:id/toss', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    try {
        await (0, match_service_1.setToss)(id, req.body ?? {});
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(id));
    }
    catch (e) {
        if (e instanceof match_service_1.MatchError)
            return (0, api_utils_1.sendFail)(res, e.message, e.status);
        return (0, api_utils_1.sendFail)(res, e?.message || 'Error recording toss', 500);
    }
});
// POST /api/matches/:id/start - Start match or second innings
router.post('/:id/start', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    try {
        const match = await db_1.db.match.findUnique({ where: { id } });
        if (!match)
            return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
        if (match.status === 'INNINGS_BREAK') {
            await (0, match_service_1.startInnings2)(id, req.body ?? {});
        }
        else {
            await (0, match_service_1.startMatch)(id, req.body ?? {});
        }
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(id));
    }
    catch (e) {
        if (e instanceof match_service_1.MatchError)
            return (0, api_utils_1.sendFail)(res, e.message, e.status);
        return (0, api_utils_1.sendFail)(res, e?.message || 'Error starting match', 500);
    }
});
// POST /api/matches/:id/ball - Record a delivery
router.post('/:id/ball', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const body = req.body ?? {};
    try {
        await (0, match_service_1.recordBall)(id, {
            runsOffBat: Number(body.runsOffBat ?? 0),
            extraType: (body.extraType ?? null),
            extraRuns: Number(body.extraRuns ?? 0),
            wicketType: (body.wicketType ?? null),
            dismissedId: body.dismissedId ?? null,
            assistId: body.assistId ?? null,
        });
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(id));
    }
    catch (e) {
        if (e instanceof match_service_1.MatchError)
            return (0, api_utils_1.sendFail)(res, e.message, e.status);
        return (0, api_utils_1.sendFail)(res, e?.message || 'Error recording ball', 500);
    }
});
// POST /api/matches/:id/action - Apply a match action
router.post('/:id/action', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const body = req.body ?? {};
    const action = body.action;
    if (!action || !ACTIONS.includes(action))
        return (0, api_utils_1.sendFail)(res, 'Unknown action');
    try {
        await (0, match_service_1.applyAction)(id, action, { playerId: body.playerId });
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(id));
    }
    catch (e) {
        if (e instanceof match_service_1.MatchError)
            return (0, api_utils_1.sendFail)(res, e.message, e.status);
        return (0, api_utils_1.sendFail)(res, e?.message || 'Error applying action', 500);
    }
});
// POST /api/matches/:id/undo - Undo last delivery
router.post('/:id/undo', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    try {
        await (0, match_service_1.undoLastBall)(id);
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(id));
    }
    catch (e) {
        if (e instanceof match_service_1.MatchError)
            return (0, api_utils_1.sendFail)(res, e.message, e.status);
        return (0, api_utils_1.sendFail)(res, e?.message || 'Error undoing last ball', 500);
    }
});
// POST /api/matches/:id/finalize - Finalize scorecard before verification
router.post('/:id/finalize', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const updated = await (0, stats_service_1.finalizeMatchScorecard)(req.params.id, {
            type: 'ADMIN',
            id: session.adminId,
            name: session.username,
        });
        await (0, match_service_1.emitMatchUpdate)(req.params.id);
        return (0, api_utils_1.sendOk)(res, { match: updated, payload: await (0, match_service_1.buildMatchPayload)(req.params.id) });
    }
    catch (e) {
        return (0, api_utils_1.sendFail)(res, e?.message || 'Failed to finalize match scorecard', 400);
    }
});
// POST /api/matches/:id/verify - Verify scorecard & idempotently sync player/career stats
router.post('/:id/verify', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        if (req.body?.playerOfMatchId !== undefined) {
            const m = await db_1.Match.findById(req.params.id);
            if (!m)
                return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
            m.playerOfMatchId = req.body.playerOfMatchId || null;
            await m.save();
        }
        const result = await (0, stats_service_1.verifyMatchAndSyncStats)(req.params.id, {
            type: 'ADMIN',
            id: session.adminId,
            name: session.username,
        }, { force: Boolean(req.body?.force) });
        await (0, match_service_1.emitMatchUpdate)(req.params.id);
        return (0, api_utils_1.sendOk)(res, { ...result, payload: await (0, match_service_1.buildMatchPayload)(req.params.id) });
    }
    catch (e) {
        return (0, api_utils_1.sendFail)(res, e?.message || 'Failed to verify match statistics', 400);
    }
});
// POST /api/matches/:id/correct - Admin correction workflow with transactional stats recalculation & audit log
router.post('/:id/correct', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : 'Authorized scorecard correction';
        const result = await (0, stats_service_1.correctMatchAndRecalculate)(req.params.id, req.body ?? {}, { type: 'ADMIN', id: session.adminId, name: session.username }, reason);
        await (0, match_service_1.emitMatchUpdate)(req.params.id);
        return (0, api_utils_1.sendOk)(res, { ...result, payload: await (0, match_service_1.buildMatchPayload)(req.params.id) });
    }
    catch (e) {
        return (0, api_utils_1.sendFail)(res, e?.message || 'Failed to apply scorecard correction', 400);
    }
});
// POST /api/matches/:id/player-status - Set RETIRED_HURT / RETIRED_OUT / ABSENT / PLAYED for a match player
router.post('/:id/player-status', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const { playerId, status, notes } = req.body ?? {};
        if (!playerId || !['PLAYED', 'RETIRED_HURT', 'RETIRED_OUT', 'ABSENT'].includes(status)) {
            return (0, api_utils_1.sendFail)(res, 'Valid playerId and status (PLAYED | RETIRED_HURT | RETIRED_OUT | ABSENT) are required');
        }
        const player = await db_1.Player.findById(playerId).select({ _id: 1 }).lean();
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        const match = await db_1.Match.findById(req.params.id);
        if (!match)
            return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
        const filtered = (match.playerStatuses ?? []).filter((s) => s.playerId !== playerId);
        filtered.push({ playerId, status, notes: typeof notes === 'string' ? notes.trim() || null : null });
        match.playerStatuses = filtered;
        await match.save();
        if (match.scorecardStatus === 'VERIFIED' && match.status === 'COMPLETED') {
            await (0, stats_service_1.verifyMatchAndSyncStats)(match._id, { type: 'ADMIN', id: session.adminId, name: session.username }, { force: true, action: 'CORRECT_MATCH', reason: `Updated player status to ${status}` });
        }
        await (0, match_service_1.emitMatchUpdate)(req.params.id);
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(req.params.id));
    }
    catch (e) {
        return (0, api_utils_1.sendFail)(res, e?.message || 'Failed to update player match status', 500);
    }
});
// POST /api/matches/:id/player-of-match - Assign Player of the Match award
router.post('/:id/player-of-match', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const match = await db_1.Match.findById(req.params.id);
        if (!match)
            return (0, api_utils_1.sendFail)(res, 'Match not found', 404);
        const playerId = typeof req.body?.playerId === 'string' && req.body.playerId.trim() ? req.body.playerId.trim() : null;
        if (playerId) {
            const p = await db_1.Player.findById(playerId).select({ _id: 1 }).lean();
            if (!p)
                return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        }
        match.playerOfMatchId = playerId;
        await match.save();
        if (match.scorecardStatus === 'VERIFIED' && match.status === 'COMPLETED') {
            await (0, stats_service_1.verifyMatchAndSyncStats)(match._id, { type: 'ADMIN', id: session.adminId, name: session.username }, { force: true, action: 'CORRECT_MATCH', reason: 'Updated Player of the Match' });
        }
        await (0, match_service_1.emitMatchUpdate)(req.params.id);
        return (0, api_utils_1.sendOk)(res, await (0, match_service_1.buildMatchPayload)(req.params.id));
    }
    catch (e) {
        return (0, api_utils_1.sendFail)(res, e?.message || 'Failed to assign Player of the Match', 500);
    }
});
exports.default = router;
