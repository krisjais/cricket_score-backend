"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNextPlayerCode = generateNextPlayerCode;
exports.ensureDefaultSeasonAndTournament = ensureDefaultSeasonAndTournament;
exports.ensureActiveMembershipForPlayer = ensureActiveMembershipForPlayer;
exports.ensurePlayerSystemBootstrap = ensurePlayerSystemBootstrap;
const db_1 = require("./db");
/**
 * Generate a unique, permanent player code such as PLR-2026-000125.
 * Uses an atomic MongoDB Counter document per year so concurrent creations never collide.
 */
async function generateNextPlayerCode(year = new Date().getFullYear()) {
    await (0, db_1.connectDB)();
    const counterId = `player_code_${year}`;
    // Sync counter baseline once if manual/imported codes already exist
    for (let attempt = 0; attempt < 5; attempt++) {
        const counter = await db_1.Counter.findOneAndUpdate({ _id: counterId }, { $inc: { seq: 1 } }, { upsert: true, new: true });
        const seq = counter?.seq ?? 1;
        const code = `PLR-${year}-${String(seq).padStart(6, '0')}`;
        const existing = await db_1.Player.findOne({ playerCode: code }).select({ _id: 1 }).lean();
        if (!existing) {
            return code;
        }
    }
    // Defensive fallback if counter trailed behind high manual sequence
    const latest = await db_1.Player.find({ playerCode: { $regex: `^PLR-${year}-\\d+$` } })
        .sort({ playerCode: -1 })
        .limit(1)
        .lean();
    const maxSeq = latest[0]?.playerCode ? Number(latest[0].playerCode.split('-')[2] || 0) : 0;
    const bumped = await db_1.Counter.findOneAndUpdate({ _id: counterId }, { $max: { seq: maxSeq + 1 } }, { upsert: true, new: true });
    return `PLR-${year}-${String((bumped?.seq ?? maxSeq + 1)).padStart(6, '0')}`;
}
/**
 * Ensure there is always an active default Season and default Tournament so matches,
 * memberships, and players created through existing flows have clean season anchors.
 */
async function ensureDefaultSeasonAndTournament() {
    await (0, db_1.connectDB)();
    const currentYear = new Date().getFullYear();
    const code = `S${currentYear}`;
    let season = await db_1.Season.findOne({ isDefault: true }).lean();
    if (!season) {
        season = await db_1.Season.findOne({ status: 'ACTIVE' }).sort({ year: -1 }).lean();
    }
    if (!season) {
        season = await db_1.Season.findOne({ code }).lean();
    }
    if (!season) {
        const created = await db_1.Season.create({
            name: `Season ${currentYear}`,
            code,
            year: currentYear,
            status: 'ACTIVE',
            isDefault: true,
            startDate: new Date(`${currentYear}-01-01T00:00:00.000Z`),
        });
        season = created.toObject();
    }
    else if (!season.isDefault) {
        await db_1.Season.updateOne({ _id: season._id }, { $set: { isDefault: true } });
    }
    let tournament = await db_1.Tournament.findOne({ seasonId: season._id }).sort({ createdAt: 1 }).lean();
    if (!tournament) {
        const createdT = await db_1.Tournament.create({
            name: `Nexcore Premier League ${season.year}`,
            shortName: `NPL-${String(season.year).slice(-2)}`,
            seasonId: season._id,
            format: 'T20',
            status: 'ACTIVE',
            startDate: season.startDate ?? new Date(),
        });
        tournament = createdT.toObject();
    }
    return { season, tournament };
}
/**
 * Assign or sync an ACTIVE-season TeamMembership without overwriting historical seasons.
 */
async function ensureActiveMembershipForPlayer(playerId, teamId, seasonId, options) {
    if (!teamId)
        return null;
    await (0, db_1.connectDB)();
    const targetSeason = seasonId
        ? await db_1.Season.findById(seasonId).lean()
        : (await ensureDefaultSeasonAndTournament()).season;
    if (!targetSeason)
        return null;
    const existing = await db_1.TeamMembership.findOne({ playerId, seasonId: targetSeason._id });
    if (!existing) {
        const created = await db_1.TeamMembership.create({
            playerId,
            teamId,
            seasonId: targetSeason._id,
            joinedAt: new Date(),
            status: targetSeason.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
            designation: options?.designation ?? 'PLAYER',
            jerseyNumber: options?.jerseyNumber ?? null,
            assignedBy: options?.assignedBy ?? 'SYSTEM_SYNC',
        });
        return created.toObject();
    }
    // Only sync active season pointer when called for current roster sync; never overwrite COMPLETED season history
    if (targetSeason.status !== 'COMPLETED' && existing.teamId !== teamId && !seasonId) {
        existing.teamId = teamId;
        existing.status = 'ACTIVE';
        await existing.save();
    }
    return existing.toObject();
}
let bootstrapPromise = null;
/**
 * Idempotent startup migration & backfill for pre-existing players, teams, and matches.
 */
async function ensurePlayerSystemBootstrap() {
    if (bootstrapPromise)
        return bootstrapPromise;
    bootstrapPromise = (async () => {
        try {
            await (0, db_1.connectDB)();
            const { season, tournament } = await ensureDefaultSeasonAndTournament();
            // 1. Backfill permanent playerCode for any existing player missing it
            const missingCodePlayers = await db_1.Player.find({
                $or: [{ playerCode: null }, { playerCode: { $exists: false } }, { playerCode: '' }],
            }).sort({ createdAt: 1 });
            for (const p of missingCodePlayers) {
                const year = p.createdAt ? new Date(p.createdAt).getFullYear() : new Date().getFullYear();
                p.playerCode = await generateNextPlayerCode(year);
                if (typeof p.isClaimed !== 'boolean')
                    p.isClaimed = Boolean(p.userId);
                if (!p.status)
                    p.status = 'ACTIVE';
                await p.save();
            }
            // 2. Backfill current TeamMembership rows for existing players with teamId
            const teamedPlayers = await db_1.Player.find({ teamId: { $ne: null } }).lean();
            for (const p of teamedPlayers) {
                const exists = await db_1.TeamMembership.findOne({ playerId: p._id, seasonId: season._id }).select({ _id: 1 }).lean();
                if (!exists && p.teamId) {
                    await db_1.TeamMembership.create({
                        playerId: p._id,
                        teamId: p.teamId,
                        seasonId: season._id,
                        joinedAt: p.createdAt ?? new Date(),
                        status: 'ACTIVE',
                        designation: 'PLAYER',
                        jerseyNumber: p.jerseyNumber ?? null,
                        assignedBy: 'MIGRATION',
                    }).catch(() => undefined);
                }
            }
            // 3. Backfill seasonId / tournamentId / matchDate on matches where missing
            await db_1.Match.updateMany({ $or: [{ seasonId: null }, { seasonId: { $exists: false } }] }, { $set: { seasonId: season._id, tournamentId: tournament._id } });
            await db_1.Match.updateMany({ $or: [{ scorecardStatus: null }, { scorecardStatus: { $exists: false } }] }, { $set: { scorecardStatus: 'DRAFT' } });
        }
        catch (err) {
            bootstrapPromise = null;
            console.error('> Bootstrap migration error:', err);
        }
    })();
    return bootstrapPromise;
}
