"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const bootstrap_1 = require("../lib/bootstrap");
const stats_service_1 = require("../lib/stats-service");
const router = (0, express_1.Router)();
function parseGender(input) {
    const s = (input ?? '').trim().toLowerCase();
    if (s === 'female' || s === 'f' || s === 'woman' || s === 'women' || s.startsWith('fem')) {
        return 'FEMALE';
    }
    return 'MALE';
}
// GET /api/players - List players (optionally by teamId)
router.get('/', async (req, res) => {
    try {
        const teamId = req.query.teamId;
        const players = await db_1.db.player.findMany({
            where: teamId ? { teamId } : undefined,
            orderBy: [{ teamId: 'asc' }, { jerseyNumber: 'asc' }, { name: 'asc' }],
            include: { team: { select: { id: true, name: true, shortName: true } } },
        });
        return (0, api_utils_1.sendOk)(res, players);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to list players', 500);
    }
});
// GET /api/players/search?q=... - Search players by name
router.get('/search', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        const q = String(req.query.q ?? '').trim();
        const includeMerged = req.query.includeMerged === 'true';
        const claimed = req.query.claimed;
        const filter = {};
        if (!includeMerged)
            filter.status = { $ne: 'MERGED' };
        if (claimed === 'true')
            filter.isClaimed = true;
        if (claimed === 'false')
            filter.isClaimed = false;
        if (q) {
            filter.name = { $regex: q, $options: 'i' };
        }
        const [players, teams, careerDocs] = await Promise.all([
            db_1.Player.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
            db_1.Team.find({}).lean(),
            db_1.PlayerCareerStat.find({}).lean(),
        ]);
        const teamMap = new Map(teams.map((t) => [t._id, t]));
        const careerMap = new Map(careerDocs.map((c) => [c.playerId, c]));
        return (0, api_utils_1.sendOk)(res, players.map((p) => {
            const tm = p.teamId ? teamMap.get(p.teamId) : null;
            const c = careerMap.get(p._id);
            return {
                ...p,
                id: p._id,
                team: tm ? { id: tm._id, name: tm.name, shortName: tm.shortName, color: tm.color } : null,
                careerSummary: c
                    ? { matches: c.matches, runs: c.runs, wickets: c.wickets, battingAverage: c.battingAverage, economy: c.economy }
                    : { matches: 0, runs: 0, wickets: 0, battingAverage: null, economy: 0 },
            };
        }));
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to search players', 500);
    }
});
// GET /api/players/public/:playerCodeOrId - Privacy-safe public profile
router.get('/public/:playerCodeOrId', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        const raw = String(req.params.playerCodeOrId ?? '').trim();
        if (!raw)
            return (0, api_utils_1.sendFail)(res, 'Player identifier required', 400);
        let player = await db_1.Player.findOne({
            $or: [{ playerCode: raw.toUpperCase() }, { _id: raw }],
        }).lean();
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player profile not found', 404);
        if (player.status === 'MERGED' && player.mergedIntoPlayerId) {
            const target = await db_1.Player.findById(player.mergedIntoPlayerId).lean();
            if (target)
                player = target;
        }
        let career = await db_1.PlayerCareerStat.findOne({ playerId: player._id }).lean();
        if (!career) {
            await (0, stats_service_1.rebuildCareerStatsForPlayers)([player._id]);
            career = await db_1.PlayerCareerStat.findOne({ playerId: player._id }).lean();
        }
        const [memberships, teams, seasons, tournaments, verifiedMatches, awards] = await Promise.all([
            db_1.TeamMembership.find({ playerId: player._id }).sort({ joinedAt: -1 }).lean(),
            db_1.Team.find({}).lean(),
            db_1.Season.find({}).lean(),
            db_1.Tournament.find({}).lean(),
            db_1.Match.find({ scorecardStatus: 'VERIFIED' }).select({ _id: 1, format: 1, venue: 1 }).lean(),
            db_1.Award.find({ playerId: player._id }).sort({ awardedAt: -1 }).lean(),
        ]);
        const teamMap = new Map(teams.map((t) => [t._id, t]));
        const seasonMap = new Map(seasons.map((s) => [s._id, s]));
        const tournamentMap = new Map(tournaments.map((t) => [t._id, t]));
        const verifiedMap = new Map(verifiedMatches.map((m) => [m._id, m]));
        const enrichedMemberships = memberships
            .map((m) => {
            const s = seasonMap.get(m.seasonId);
            const t = teamMap.get(m.teamId);
            return {
                id: m._id,
                seasonId: m.seasonId,
                teamId: m.teamId,
                joinedAt: m.joinedAt,
                status: m.status,
                designation: m.designation,
                season: s ? { id: s._id, name: s.name, code: s.code, year: s.year, status: s.status } : null,
                team: t ? { id: t._id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl } : null,
            };
        })
            .sort((a, b) => (b.season?.year ?? 0) - (a.season?.year ?? 0));
        const currentMembership = enrichedMemberships.find((m) => m.season?.status === 'ACTIVE' && m.status === 'ACTIVE') ??
            enrichedMemberships[0] ??
            null;
        const recentMatchStats = verifiedMap.size > 0
            ? await db_1.PlayerMatchStat.find({ playerId: player._id, matchId: { $in: [...verifiedMap.keys()] } })
                .sort({ matchDate: -1 })
                .limit(15)
                .lean()
            : [];
        const recentMatches = recentMatchStats.map((st) => {
            const tm = teamMap.get(st.teamId);
            const opp = teamMap.get(st.opponentTeamId);
            const s = st.seasonId ? seasonMap.get(st.seasonId) : null;
            const tr = st.tournamentId ? tournamentMap.get(st.tournamentId) : null;
            return {
                id: st._id,
                matchId: st.matchId,
                matchDate: st.matchDate,
                result: st.result,
                matchResultText: st.matchResultText,
                isPlayerOfMatch: st.isPlayerOfMatch,
                batting: st.batting,
                bowling: st.bowling,
                fielding: st.fielding,
                team: tm ? { id: tm._id, name: tm.name, shortName: tm.shortName, color: tm.color } : null,
                opponent: opp ? { id: opp._id, name: opp.name, shortName: opp.shortName, color: opp.color } : null,
                season: s ? { id: s._id, name: s.name, year: s.year } : null,
                tournament: tr ? { id: tr._id, name: tr.name, shortName: tr.shortName } : null,
            };
        });
        const publicPrivacy = {
            showDob: true,
            showCity: true,
            showBio: true,
            showSeasonHistory: true,
            isPublic: true,
        };
        // Strict public projection — never include email, mobile, userId, passwords or tokens
        const publicPlayer = {
            id: player._id,
            playerCode: player.playerCode,
            name: player.name,
            role: player.role,
            gender: player.gender,
            jerseyNumber: player.jerseyNumber,
            avatarUrl: player.avatarUrl ?? null,
            battingStyle: player.battingStyle ?? null,
            bowlingStyle: player.bowlingStyle ?? null,
            isClaimed: Boolean(player.isClaimed),
            isVerified: Boolean(player.isVerified),
            status: player.status ?? 'ACTIVE',
            dob: player.dob ?? null,
            city: null,
            bio: player.bio ?? null,
            privacy: publicPrivacy,
        };
        return (0, api_utils_1.sendOk)(res, {
            isPrivate: false,
            player: publicPlayer,
            currentMembership,
            memberships: enrichedMemberships,
            career,
            recentMatches,
            awards,
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to load public profile', 500);
    }
});
// POST /api/players - Create a player (admin / scorer temp or full squad)
router.post('/', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const body = req.body ?? {};
    const name = body.name?.trim();
    if (!name)
        return (0, api_utils_1.sendFail)(res, 'Player name is required');
    let teamId = null;
    if (body.teamId && body.teamId !== 'none' && body.teamId !== 'unassigned') {
        const team = await db_1.db.team.findUnique({ where: { id: body.teamId } });
        if (!team)
            return (0, api_utils_1.sendFail)(res, 'Team not found', 404);
        teamId = body.teamId;
    }
    const role = body.role && ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)
        ? body.role
        : 'ALL_ROUNDER';
    const gender = parseGender(body.gender);
    const jerseyNumber = body.jerseyNumber !== undefined && body.jerseyNumber !== null && !Number.isNaN(Number(body.jerseyNumber))
        ? Math.floor(Number(body.jerseyNumber))
        : null;
    const avatarUrl = body.avatarUrl?.trim() || null;
    const player = await db_1.db.player.create({
        data: {
            teamId,
            name,
            playerCode: null,
            role,
            gender,
            jerseyNumber,
            avatarUrl,
            battingStyle: ['RIGHT_HAND', 'LEFT_HAND'].includes(body.battingStyle) ? body.battingStyle : null,
            bowlingStyle: typeof body.bowlingStyle === 'string' && body.bowlingStyle ? body.bowlingStyle : null,
            isClaimed: false,
            isVerified: Boolean(body.isVerified),
            status: 'ACTIVE',
        },
    });
    if (teamId) {
        await (0, bootstrap_1.ensureActiveMembershipForPlayer)(player.id, teamId, body.seasonId || null, {
            jerseyNumber,
            assignedBy: session.username,
        });
    }
    return (0, api_utils_1.sendOk)(res, player, 201);
});
// GET /api/players/:id/career - Career stats, memberships & match history (for admin / scorers)
router.get('/:id/career', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        const player = await db_1.Player.findOne({
            $or: [{ _id: req.params.id }, { playerCode: req.params.id.toUpperCase() }],
        }).lean();
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        let career = await db_1.PlayerCareerStat.findOne({ playerId: player._id }).lean();
        if (!career) {
            await (0, stats_service_1.rebuildCareerStatsForPlayers)([player._id]);
            career = await db_1.PlayerCareerStat.findOne({ playerId: player._id }).lean();
        }
        const [memberships, matchStats, teams, seasons, tournaments] = await Promise.all([
            db_1.TeamMembership.find({ playerId: player._id }).sort({ joinedAt: -1 }).lean(),
            db_1.PlayerMatchStat.find({ playerId: player._id }).sort({ matchDate: -1 }).lean(),
            db_1.Team.find({}).lean(),
            db_1.Season.find({}).lean(),
            db_1.Tournament.find({}).lean(),
        ]);
        const tMap = new Map(teams.map((t) => [t._id, t]));
        const sMap = new Map(seasons.map((s) => [s._id, s]));
        const trMap = new Map(tournaments.map((t) => [t._id, t]));
        return (0, api_utils_1.sendOk)(res, {
            player: { ...player, id: player._id },
            career,
            memberships: memberships.map((m) => ({
                ...m,
                id: m._id,
                team: tMap.get(m.teamId) ?? null,
                season: sMap.get(m.seasonId) ?? null,
            })),
            matchHistory: matchStats.map((st) => ({
                ...st,
                id: st._id,
                team: tMap.get(st.teamId) ?? null,
                opponent: tMap.get(st.opponentTeamId) ?? null,
                season: st.seasonId ? sMap.get(st.seasonId) ?? null : null,
                tournament: st.tournamentId ? trMap.get(st.tournamentId) ?? null : null,
            })),
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to load player career', 500);
    }
});
// PATCH /api/players/:id/verify - Admin verify/unverify player profile
router.patch('/:id/verify', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const player = await db_1.Player.findById(req.params.id);
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        const prev = player.isVerified;
        player.isVerified = req.body?.isVerified !== undefined ? Boolean(req.body.isVerified) : !player.isVerified;
        await player.save();
        await (0, stats_service_1.writeAuditLog)({
            action: 'VERIFY_PLAYER',
            actor: { type: 'ADMIN', id: session.adminId, name: session.username },
            playerId: player._id,
            beforeSummary: { isVerified: prev },
            afterSummary: { isVerified: player.isVerified },
        });
        return (0, api_utils_1.sendOk)(res, player.toObject());
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to update verification status', 500);
    }
});
// PATCH /api/players/:id/status - Admin update player status
router.patch('/:id/status', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        await (0, db_1.connectDB)();
        const player = await db_1.Player.findById(req.params.id);
        if (!player)
            return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
        const status = req.body?.status;
        if (!['ACTIVE', 'SUSPENDED', 'RETIRED'].includes(status)) {
            return (0, api_utils_1.sendFail)(res, 'Invalid player status');
        }
        const prev = player.status;
        player.status = status;
        await player.save();
        await (0, stats_service_1.writeAuditLog)({
            action: 'UPDATE_PLAYER_STATUS',
            actor: { type: 'ADMIN', id: session.adminId, name: session.username },
            playerId: player._id,
            reason: req.body?.reason ?? null,
            beforeSummary: { status: prev },
            afterSummary: { status },
        });
        return (0, api_utils_1.sendOk)(res, player.toObject());
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to update status', 500);
    }
});
// POST /api/players/merge - Admin merge duplicate profiles inside transaction
router.post('/merge', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const sourcePlayerId = String(req.body?.sourcePlayerId ?? '').trim();
        const targetPlayerId = String(req.body?.targetPlayerId ?? '').trim();
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : 'Admin duplicate profile merge';
        if (!sourcePlayerId || !targetPlayerId) {
            return (0, api_utils_1.sendFail)(res, 'sourcePlayerId and targetPlayerId are required');
        }
        const result = await (0, stats_service_1.mergePlayersAndRecalculate)(sourcePlayerId, targetPlayerId, { type: 'ADMIN', id: session.adminId, name: session.username }, reason);
        return (0, api_utils_1.sendOk)(res, result);
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to merge players', 400);
    }
});
// PATCH /api/players/:id - Update player
router.patch('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const player = await db_1.db.player.findUnique({ where: { id } });
    if (!player)
        return (0, api_utils_1.sendFail)(res, 'Player not found', 404);
    const body = req.body ?? {};
    const role = body.role && ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)
        ? body.role
        : player.role;
    const gender = body.gender !== undefined ? parseGender(body.gender) : (player.gender || 'MALE');
    const jerseyNumber = body.jerseyNumber === undefined
        ? player.jerseyNumber
        : body.jerseyNumber === null || Number.isNaN(Number(body.jerseyNumber))
            ? null
            : Math.floor(Number(body.jerseyNumber));
    let targetTeamId = player.teamId;
    if (body.teamId !== undefined) {
        if (body.teamId && body.teamId !== 'none' && body.teamId !== 'unassigned') {
            const team = await db_1.db.team.findUnique({ where: { id: body.teamId } });
            if (!team)
                return (0, api_utils_1.sendFail)(res, 'Team not found', 404);
            targetTeamId = body.teamId;
        }
        else {
            targetTeamId = null;
        }
    }
    const avatarUrl = body.avatarUrl !== undefined ? body.avatarUrl?.trim() || null : player.avatarUrl;
    const updated = await db_1.db.player.update({
        where: { id },
        data: {
            name: body.name?.trim() || player.name,
            role,
            gender,
            jerseyNumber,
            teamId: targetTeamId,
            avatarUrl,
            ...(body.battingStyle !== undefined ? { battingStyle: body.battingStyle || null } : {}),
            ...(body.bowlingStyle !== undefined ? { bowlingStyle: body.bowlingStyle || null } : {}),
            ...(body.isVerified !== undefined ? { isVerified: Boolean(body.isVerified) } : {}),
        },
    });
    if (targetTeamId) {
        await (0, bootstrap_1.ensureActiveMembershipForPlayer)(id, targetTeamId, body.seasonId || null, {
            jerseyNumber,
            assignedBy: session.username,
        });
    }
    return (0, api_utils_1.sendOk)(res, updated);
});
async function handleDeleteAllPlayers(req, res) {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const force = req.query.force === 'true' || req.body?.force === true;
    if (!force) {
        const ballsCount = await db_1.db.ball.count();
        if (ballsCount > 0) {
            return (0, api_utils_1.sendFail)(res, `Cannot delete players: ${ballsCount} delivery events are currently recorded in matches. Reset match history first or confirm force deletion.`);
        }
    }
    const result = await db_1.db.player.deleteMany({});
    return (0, api_utils_1.sendOk)(res, { deletedCount: result.count });
}
// DELETE /api/players/all - Delete all players
router.delete('/all', handleDeleteAllPlayers);
// DELETE /api/players - Delete all players (bulk collection deletion)
router.delete('/', handleDeleteAllPlayers);
// DELETE /api/players/:id - Delete single player
router.delete('/:id', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    const { id } = req.params;
    const used = await db_1.db.ball.count({
        where: { OR: [{ strikerId: id }, { nonStrikerId: id }, { bowlerId: id }, { dismissedId: id }, { assistId: id }] },
    });
    if (used > 0) {
        return (0, api_utils_1.sendFail)(res, `Cannot delete: this player has recorded deliveries in ${used} ball event(s). Remove the match history first.`);
    }
    await db_1.db.player.delete({ where: { id } });
    return (0, api_utils_1.sendOk)(res, { deleted: true });
});
// Helper to parse CSV string into objects
function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2)
        return [];
    const parseRow = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                }
                else {
                    inQuotes = !inQuotes;
                }
            }
            else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            }
            else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    };
    const rawHeaders = parseRow(lines[0]);
    const headers = rawHeaders.map((h) => h.replace(/^["']|["']$/g, '').trim());
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseRow(lines[i]);
        if (values.length === 0 || (values.length === 1 && values[0] === ''))
            continue;
        const rec = {};
        for (let j = 0; j < headers.length; j++) {
            const h = headers[j];
            const val = (values[j] ?? '').replace(/^["']|["']$/g, '').trim();
            rec[h] = val;
        }
        records.push(rec);
    }
    return records;
}
function parseSkillToRole(skills) {
    if (!skills)
        return 'BATTER';
    const s = skills.toLowerCase();
    if (s.includes('wicket') || s.includes('keeper') || s.includes('wk'))
        return 'WICKETKEEPER';
    if (s.includes('all') || s.includes('all-rounder') || s.includes('all rounder'))
        return 'ALL_ROUNDER';
    if (s.includes('bowl'))
        return 'BOWLER';
    if (s.includes('bat') || s.includes('batsman'))
        return 'BATTER';
    return 'BATTER';
}
function generateShortCode(name) {
    const clean = name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        const letters = words.map((w) => w[0].toUpperCase()).join('');
        return letters.slice(0, 5);
    }
    return clean.slice(0, 4).toUpperCase() || 'TEAM';
}
// POST /api/players/import - Bulk import players from CSV or array
router.post('/import', async (req, res) => {
    const session = await (0, auth_1.requireAdmin)(req);
    if (!session)
        return (0, api_utils_1.unauthorized)(res);
    try {
        const body = req.body ?? {};
        const autoCreateTeams = body.autoCreateTeams !== false;
        let rawItems = [];
        if (typeof body.rawCsv === 'string' && body.rawCsv.trim()) {
            const parsed = parseCSV(body.rawCsv);
            rawItems = parsed.map((row) => ({
                name: row['Name'] || row['name'] || row['Player Name'] || '',
                skills: row['Skills'] || row['skills'] || row['Role'] || '',
                gender: row['Gender'] || row['gender'] || row['Category'] || row['category'] || '',
                soldTo: row['Sold To'] || row['sold to'] || row['Team'] || row['team'] || '',
                photoUrl: row['Photo URL'] || row['photo url'] || row['Photo'] || row['avatarUrl'] || '',
                jerseyNumber: row['Jersey Number'] || row['Jersey'] || row['jerseyNumber'] || null,
            }));
        }
        else if (Array.isArray(body.players)) {
            rawItems = body.players;
        }
        else {
            return (0, api_utils_1.sendFail)(res, 'Please provide either rawCsv string or players array');
        }
        if (rawItems.length === 0) {
            return (0, api_utils_1.sendFail)(res, 'No valid player rows found in the import data');
        }
        // Load existing teams to match by name
        const existingTeams = await db_1.db.team.findMany();
        const teamMap = new Map();
        for (const t of existingTeams) {
            teamMap.set(t.name.toLowerCase().trim(), t);
            teamMap.set(t.shortName.toLowerCase().trim(), t);
        }
        let createdTeamsCount = 0;
        const newTeamNames = [];
        // Pre-create any missing teams if autoCreateTeams is true
        if (autoCreateTeams) {
            const distinctTeamNames = new Set();
            for (const item of rawItems) {
                const teamName = (item.soldTo || item.team || '').trim();
                if (teamName && !teamMap.has(teamName.toLowerCase())) {
                    distinctTeamNames.add(teamName);
                }
            }
            for (const tName of distinctTeamNames) {
                let short = generateShortCode(tName);
                // Ensure unique short code
                let counter = 1;
                let candidate = short;
                while ([...teamMap.values()].some((t) => t.shortName === candidate)) {
                    candidate = `${short.slice(0, 3)}${counter}`;
                    counter++;
                }
                short = candidate;
                const newTeam = await db_1.db.team.create({
                    data: {
                        name: tName,
                        shortName: short,
                        color: '#0d3a24',
                    },
                });
                teamMap.set(tName.toLowerCase(), newTeam);
                teamMap.set(short.toLowerCase(), newTeam);
                createdTeamsCount++;
                newTeamNames.push(tName);
            }
        }
        // Load existing players to prevent duplicates & backfill gender on re-import
        const existingPlayers = await db_1.db.player.findMany();
        const existingMap = new Map();
        for (const p of existingPlayers) {
            existingMap.set(`${p.name.toLowerCase().trim()}::${p.teamId || ''}`, p);
        }
        // Insert or update players
        let createdCount = 0;
        let updatedCount = 0;
        for (const item of rawItems) {
            const name = (item.name || '').trim();
            if (!name)
                continue;
            const teamName = (item.soldTo || item.team || '').trim();
            let teamId = null;
            if (teamName && teamMap.has(teamName.toLowerCase())) {
                teamId = teamMap.get(teamName.toLowerCase()).id;
            }
            const role = parseSkillToRole(item.skills || item.role);
            const gender = parseGender(item.gender);
            const avatarUrl = (item.photoUrl || item.avatarUrl || '').trim() || null;
            const jNum = item.jerseyNumber !== undefined && item.jerseyNumber !== null && !Number.isNaN(Number(item.jerseyNumber))
                ? Math.floor(Number(item.jerseyNumber))
                : null;
            const key = `${name.toLowerCase()}::${teamId || ''}`;
            const existing = existingMap.get(key);
            if (existing) {
                await db_1.db.player.update({
                    where: { id: existing.id },
                    data: {
                        role,
                        gender,
                        ...(avatarUrl ? { avatarUrl } : {}),
                        ...(jNum !== null ? { jerseyNumber: jNum } : {}),
                    },
                });
                updatedCount++;
            }
            else {
                const created = await db_1.db.player.create({
                    data: {
                        name,
                        playerCode: null,
                        role,
                        gender,
                        jerseyNumber: jNum,
                        teamId,
                        avatarUrl,
                        isClaimed: false,
                        status: 'ACTIVE',
                    },
                });
                if (teamId) {
                    await (0, bootstrap_1.ensureActiveMembershipForPlayer)(created.id, teamId, null, {
                        jerseyNumber: jNum,
                        assignedBy: session.username,
                    });
                }
                existingMap.set(key, created);
                createdCount++;
            }
        }
        const totalCount = await db_1.db.player.count();
        return (0, api_utils_1.sendOk)(res, {
            importedCount: createdCount + updatedCount,
            createdCount,
            updatedCount,
            teamsCreated: createdTeamsCount,
            createdTeamNames: newTeamNames,
            totalPlayers: totalCount,
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to import players', 500);
    }
});
exports.default = router;
