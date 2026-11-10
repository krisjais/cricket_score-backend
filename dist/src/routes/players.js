"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const api_utils_1 = require("../lib/api-utils");
const router = (0, express_1.Router)();
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
// POST /api/players - Create a player
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
    const jerseyNumber = body.jerseyNumber !== undefined && body.jerseyNumber !== null && !Number.isNaN(Number(body.jerseyNumber))
        ? Math.floor(Number(body.jerseyNumber))
        : null;
    const avatarUrl = body.avatarUrl?.trim() || null;
    const player = await db_1.db.player.create({ data: { teamId, name, role, jerseyNumber, avatarUrl } });
    return (0, api_utils_1.sendOk)(res, player, 201);
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
            jerseyNumber,
            teamId: targetTeamId,
            avatarUrl,
        },
    });
    return (0, api_utils_1.sendOk)(res, updated);
});
// DELETE /api/players/:id - Delete player
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
        // Insert or update players
        let importedCount = 0;
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
            const avatarUrl = (item.photoUrl || item.avatarUrl || '').trim() || null;
            const jNum = item.jerseyNumber !== undefined && item.jerseyNumber !== null && !Number.isNaN(Number(item.jerseyNumber))
                ? Math.floor(Number(item.jerseyNumber))
                : null;
            await db_1.db.player.create({
                data: {
                    name,
                    role,
                    jerseyNumber: jNum,
                    teamId,
                    avatarUrl,
                },
            });
            importedCount++;
        }
        const totalCount = await db_1.db.player.count();
        return (0, api_utils_1.sendOk)(res, {
            importedCount,
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
