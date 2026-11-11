"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const bootstrap_1 = require("../lib/bootstrap");
const router = (0, express_1.Router)();
// GET /api/seasons - List all seasons
router.get('/', async (_req, res) => {
    try {
        await (0, db_1.connectDB)();
        await (0, bootstrap_1.ensureDefaultSeasonAndTournament)();
        const seasons = await db_1.Season.find({}).sort({ year: -1, createdAt: -1 }).lean();
        return (0, api_utils_1.sendOk)(res, seasons.map((s) => ({ ...s, id: s._id })));
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to load seasons', 500);
    }
});
// POST /api/seasons - Create a new season
router.post('/', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const body = req.body ?? {};
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const year = Math.floor(Number(body.year));
        if (!name)
            return (0, api_utils_1.sendFail)(res, 'Season name is required');
        if (!Number.isInteger(year) || year < 1990 || year > 2100) {
            return (0, api_utils_1.sendFail)(res, 'Season year must be between 1990 and 2100');
        }
        const code = (typeof body.code === 'string' && body.code.trim() ? body.code.trim() : `S${year}`).toUpperCase();
        const exists = await db_1.Season.findOne({ code }).select({ _id: 1 }).lean();
        if (exists)
            return (0, api_utils_1.sendFail)(res, `Season code ${code} already exists`, 409);
        const status = ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status) ? body.status : 'UPCOMING';
        const isDefault = Boolean(body.isDefault);
        if (isDefault) {
            await db_1.Season.updateMany({}, { $set: { isDefault: false } });
        }
        const created = await db_1.Season.create({
            name,
            code,
            year,
            status,
            isDefault,
            startDate: body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate ? new Date(body.endDate) : null,
        });
        return (0, api_utils_1.sendOk)(res, created.toObject(), 201);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to create season', 500);
    }
});
// PATCH /api/seasons/:id - Update season details / status / default flag
router.patch('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const season = await db_1.Season.findById(req.params.id);
        if (!season)
            return (0, api_utils_1.sendFail)(res, 'Season not found', 404);
        const body = req.body ?? {};
        if (typeof body.name === 'string' && body.name.trim())
            season.name = body.name.trim();
        if (body.status && ['UPCOMING', 'ACTIVE', 'COMPLETED'].includes(body.status)) {
            season.status = body.status;
        }
        if (body.startDate !== undefined)
            season.startDate = body.startDate ? new Date(body.startDate) : null;
        if (body.endDate !== undefined)
            season.endDate = body.endDate ? new Date(body.endDate) : null;
        if (body.isDefault === true) {
            await db_1.Season.updateMany({ _id: { $ne: season._id } }, { $set: { isDefault: false } });
            season.isDefault = true;
        }
        await season.save();
        return (0, api_utils_1.sendOk)(res, season.toObject());
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to update season', 500);
    }
});
exports.default = router;
