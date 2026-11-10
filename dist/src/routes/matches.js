"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
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
    const match = await db_1.db.match.create({
        data: {
            teamAId,
            teamBId,
            format,
            totalOvers,
            venue: typeof venue === 'string' ? venue.trim() || null : null,
            status: 'SCHEDULED',
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
        },
    });
    await (0, match_service_1.emitMatchUpdate)(updated.id);
    return (0, api_utils_1.sendOk)(res, updated);
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
    await db_1.db.match.delete({ where: { id } });
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
        const match = await (0, match_service_1.setToss)(id, req.body ?? {});
        return (0, api_utils_1.sendOk)(res, match);
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
exports.default = router;
