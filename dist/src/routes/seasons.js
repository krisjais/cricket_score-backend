"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
            const prevStatus = season.status;
            season.status = body.status;
            // Requirement 8: When a season is completed, mark active captaincies as completed & preserve history
            if (body.status === 'COMPLETED' && prevStatus !== 'COMPLETED') {
                const activeCaptains = await db_1.CaptaincyAssignment.find({
                    seasonId: season._id,
                    status: 'active',
                });
                const now = new Date();
                for (const cap of activeCaptains) {
                    cap.status = 'completed';
                    cap.endedAt = now;
                    await cap.save();
                    await db_1.CaptaincyAuditLog.create({
                        assignmentId: cap._id,
                        action: 'AUTO_EXPIRE',
                        seasonId: season._id,
                        teamId: cap.teamId,
                        previousCaptainId: cap.playerId,
                        newCaptainId: null,
                        performedBy: session.username,
                        performedAt: now,
                        reason: `Season ${season.name} marked COMPLETED`,
                    });
                }
            }
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
// DELETE /api/seasons/:id - Delete season (cannot delete default season or season with matches)
router.delete('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const season = await db_1.Season.findById(req.params.id);
        if (!season)
            return (0, api_utils_1.sendFail)(res, 'Season not found', 404);
        if (season.isDefault) {
            return (0, api_utils_1.sendFail)(res, 'Cannot delete the default active season. Designate another season as default first.', 400);
        }
        const { Match, Tournament, TeamMembership } = await Promise.resolve().then(() => __importStar(require('../lib/db')));
        const matchCount = await Match.countDocuments({ seasonId: season._id });
        if (matchCount > 0) {
            return (0, api_utils_1.sendFail)(res, `Cannot delete season: ${matchCount} match(es) are associated with it. Delete or reassign matches first.`, 400);
        }
        await Promise.all([
            Tournament.deleteMany({ seasonId: season._id }),
            TeamMembership.deleteMany({ seasonId: season._id }),
            db_1.CaptaincyAssignment.deleteMany({ seasonId: season._id }),
            db_1.CaptaincyAuditLog.deleteMany({ seasonId: season._id }),
            db_1.Season.findByIdAndDelete(season._id),
        ]);
        return (0, api_utils_1.sendOk)(res, { deleted: true, id: season._id });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to delete season', 500);
    }
});
// POST /api/seasons/cleanup-test-seasons - Purge all lingering test seasons
router.post('/cleanup-test-seasons', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const { cleanupTestSeasons } = await Promise.resolve().then(() => __importStar(require('../lib/season-cleanup')));
        const purgedCount = await cleanupTestSeasons();
        return (0, api_utils_1.sendOk)(res, { purgedCount });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to clean test seasons', 500);
    }
});
exports.default = router;
