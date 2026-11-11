"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const stats_service_1 = require("../lib/stats-service");
const router = (0, express_1.Router)();
// GET /api/memberships - Query season-based team memberships
router.get('/', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        const where = {};
        if (typeof req.query.playerId === 'string' && req.query.playerId)
            where.playerId = req.query.playerId;
        if (typeof req.query.teamId === 'string' && req.query.teamId)
            where.teamId = req.query.teamId;
        if (typeof req.query.seasonId === 'string' && req.query.seasonId)
            where.seasonId = req.query.seasonId;
        const [memberships, players, teams, seasons] = await Promise.all([
            db_1.TeamMembership.find(where).sort({ joinedAt: -1 }).lean(),
            db_1.Player.find({}).select({ _id: 1, name: 1, playerCode: 1, role: 1, avatarUrl: 1 }).lean(),
            db_1.Team.find({}).select({ _id: 1, name: 1, shortName: 1, color: 1, logoUrl: 1 }).lean(),
            db_1.Season.find({}).lean(),
        ]);
        const pMap = new Map(players.map((p) => [p._id, p]));
        const tMap = new Map(teams.map((t) => [t._id, t]));
        const sMap = new Map(seasons.map((s) => [s._id, s]));
        const enriched = memberships
            .map((m) => {
            const p = pMap.get(m.playerId);
            const t = tMap.get(m.teamId);
            const s = sMap.get(m.seasonId);
            return {
                ...m,
                id: m._id,
                player: p ? { id: p._id, playerCode: p.playerCode, name: p.name, role: p.role, avatarUrl: p.avatarUrl } : null,
                team: t ? { id: t._id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl } : null,
                season: s ? { id: s._id, name: s.name, code: s.code, year: s.year, status: s.status } : null,
            };
        })
            .sort((a, b) => (b.season?.year ?? 0) - (a.season?.year ?? 0));
        return (0, api_utils_1.sendOk)(res, enriched);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to load team memberships', 500);
    }
});
// POST /api/memberships - Admin assigns a player to a team for a specific season
router.post('/', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const body = req.body ?? {};
        const playerId = String(body.playerId ?? '').trim();
        const teamId = String(body.teamId ?? '').trim();
        const seasonId = String(body.seasonId ?? '').trim();
        if (!playerId || !teamId || !seasonId) {
            return (0, api_utils_1.sendFail)(res, 'playerId, teamId, and seasonId are required');
        }
        const [player, team, season, existing] = await Promise.all([
            db_1.Player.findById(playerId),
            db_1.Team.findById(teamId).lean(),
            db_1.Season.findById(seasonId).lean(),
            db_1.TeamMembership.findOne({ playerId, seasonId }),
        ]);
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        if (player.status === 'MERGED')
            return (0, api_utils_1.sendFail)(res, 'Cannot assign membership to a merged player profile', 400);
        if (!team)
            return (0, api_utils_1.sendFail)(res, 'Team not found', 404);
        if (!season)
            return (0, api_utils_1.sendFail)(res, 'Season not found', 404);
        // Rule: Prevent overwriting completed season records and prevent duplicate memberships per season
        if (existing) {
            if (season.status === 'COMPLETED') {
                return (0, api_utils_1.sendFail)(res, `Season ${season.name} is COMPLETED. Historical team membership records cannot be overwritten.`, 409);
            }
            if (!body.replaceExisting) {
                return (0, api_utils_1.sendFail)(res, `Player already has a membership in ${season.name}. Pass replaceExisting=true for an official transfer.`, 409);
            }
            const prevTeamId = existing.teamId;
            existing.teamId = teamId;
            existing.designation = ['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN', 'WICKETKEEPER'].includes(body.designation)
                ? body.designation
                : existing.designation;
            if (body.jerseyNumber !== undefined) {
                existing.jerseyNumber = body.jerseyNumber !== null ? Number(body.jerseyNumber) : null;
            }
            existing.notes = typeof body.notes === 'string' ? body.notes.trim() || null : existing.notes;
            existing.assignedBy = session.username;
            await existing.save();
            if (season.status === 'ACTIVE' || season.isDefault) {
                player.teamId = teamId;
                if (existing.jerseyNumber != null)
                    player.jerseyNumber = existing.jerseyNumber;
                await player.save();
            }
            await (0, stats_service_1.writeAuditLog)({
                action: 'ASSIGN_TEAM_MEMBERSHIP',
                actor: { type: 'ADMIN', id: session.adminId, name: session.username },
                playerId,
                beforeSummary: { seasonId, teamId: prevTeamId },
                afterSummary: { seasonId, teamId, mode: 'TRANSFER' },
                reason: body.notes ?? 'Season squad transfer',
            });
            return (0, api_utils_1.sendOk)(res, existing.toObject());
        }
        const designation = ['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN', 'WICKETKEEPER'].includes(body.designation)
            ? body.designation
            : 'PLAYER';
        const membershipStatus = season.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE';
        const jerseyNum = body.jerseyNumber !== undefined && body.jerseyNumber !== null ? Number(body.jerseyNumber) : player.jerseyNumber;
        const created = await db_1.TeamMembership.create({
            playerId,
            teamId,
            seasonId,
            joinedAt: body.joinedAt ? new Date(body.joinedAt) : new Date(),
            status: membershipStatus,
            designation,
            jerseyNumber: Number.isNaN(jerseyNum) ? null : jerseyNum,
            assignedBy: session.username,
            notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
        });
        // Keep Player.teamId pointing to active/default season team for seamless live scorer squad compatibility
        if (season.status === 'ACTIVE' || season.isDefault) {
            player.teamId = teamId;
            if (jerseyNum != null && !Number.isNaN(jerseyNum))
                player.jerseyNumber = jerseyNum;
            await player.save();
        }
        await (0, stats_service_1.writeAuditLog)({
            action: 'ASSIGN_TEAM_MEMBERSHIP',
            actor: { type: 'ADMIN', id: session.adminId, name: session.username },
            playerId,
            afterSummary: { seasonId, seasonName: season.name, teamId, teamName: team.name, designation },
        });
        return (0, api_utils_1.sendOk)(res, created.toObject(), 201);
    }
    catch (err) {
        if (err?.code === 11000) {
            return (0, api_utils_1.sendFail)(res, 'Duplicate membership: player already belongs to a team in this season', 409);
        }
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to assign team membership', 500);
    }
});
// PATCH /api/memberships/:id - Update designation/status
router.patch('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const m = await db_1.TeamMembership.findById(req.params.id);
        if (!m)
            return (0, api_utils_1.sendFail)(res, 'Membership not found', 404);
        const season = await db_1.Season.findById(m.seasonId).lean();
        const body = req.body ?? {};
        if (season?.status === 'COMPLETED' && body.teamId && body.teamId !== m.teamId) {
            return (0, api_utils_1.sendFail)(res, 'Cannot alter team on a completed season membership', 409);
        }
        if (body.designation && ['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN', 'WICKETKEEPER'].includes(body.designation)) {
            m.designation = body.designation;
        }
        if (body.status && ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'RELEASED'].includes(body.status)) {
            m.status = body.status;
        }
        if (body.jerseyNumber !== undefined) {
            m.jerseyNumber = body.jerseyNumber !== null ? Number(body.jerseyNumber) : null;
        }
        if (body.notes !== undefined)
            m.notes = body.notes || null;
        await m.save();
        return (0, api_utils_1.sendOk)(res, m.toObject());
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to update membership', 500);
    }
});
exports.default = router;
