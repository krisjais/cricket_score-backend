"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const bootstrap_1 = require("../lib/bootstrap");
const router = (0, express_1.Router)();
// GET /api/tournaments - List tournaments (optional seasonId filter)
router.get('/', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        await (0, bootstrap_1.ensureDefaultSeasonAndTournament)();
        const where = {};
        if (typeof req.query.seasonId === 'string' && req.query.seasonId) {
            where.seasonId = req.query.seasonId;
        }
        const [tournaments, seasons] = await Promise.all([
            db_1.Tournament.find(where).sort({ createdAt: -1 }).lean(),
            db_1.Season.find({}).lean(),
        ]);
        const sMap = new Map(seasons.map((s) => [s._id, s]));
        return (0, api_utils_1.sendOk)(res, tournaments.map((t) => {
            const s = sMap.get(t.seasonId);
            return {
                ...t,
                id: t._id,
                season: s ? { id: s._id, name: s.name, year: s.year, code: s.code, status: s.status } : null,
            };
        }));
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to load tournaments', 500);
    }
});
// POST /api/tournaments - Create tournament
router.post('/', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const body = req.body ?? {};
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const seasonId = String(body.seasonId ?? '').trim();
        if (!name)
            return (0, api_utils_1.sendFail)(res, 'Tournament name is required');
        if (!seasonId)
            return (0, api_utils_1.sendFail)(res, 'Season ID is required');
        const season = await db_1.Season.findById(seasonId).lean();
        if (!season)
            return (0, api_utils_1.sendFail)(res, 'Season not found', 404);
        const shortName = (typeof body.shortName === 'string' && body.shortName.trim()
            ? body.shortName.trim()
            : name.slice(0, 8)).toUpperCase();
        const format = ['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format) ? body.format : 'T20';
        const status = ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status) ? body.status : 'UPCOMING';
        const created = await db_1.Tournament.create({
            name,
            shortName,
            seasonId,
            format,
            status,
            startDate: body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate ? new Date(body.endDate) : null,
        });
        return (0, api_utils_1.sendOk)(res, created.toObject(), 201);
    }
    catch (err) {
        if (err?.code === 11000)
            return (0, api_utils_1.sendFail)(res, 'Tournament with this name already exists in this season', 409);
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to create tournament', 500);
    }
});
// PATCH /api/tournaments/:id
router.patch('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const t = await db_1.Tournament.findById(req.params.id);
        if (!t)
            return (0, api_utils_1.sendFail)(res, 'Tournament not found', 404);
        const body = req.body ?? {};
        if (typeof body.name === 'string' && body.name.trim())
            t.name = body.name.trim();
        if (typeof body.shortName === 'string' && body.shortName.trim())
            t.shortName = body.shortName.trim().toUpperCase();
        if (body.format && ['T10', 'T20', 'ODI', 'CUSTOM'].includes(body.format))
            t.format = body.format;
        if (body.status && ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status))
            t.status = body.status;
        if (body.winnerTeamId !== undefined)
            t.winnerTeamId = body.winnerTeamId || null;
        await t.save();
        return (0, api_utils_1.sendOk)(res, t.toObject());
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to update tournament', 500);
    }
});
exports.default = router;
