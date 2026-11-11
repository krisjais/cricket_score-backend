"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSquads = loadSquads;
exports.teamLite = teamLite;
exports.syncMatchState = syncMatchState;
exports.buildMatchPayload = buildMatchPayload;
exports.buildMatchSummaries = buildMatchSummaries;
/**
 * Server-side match state service: loads match + innings + balls from DB,
 * computes scorecards with the pure engine, syncs the match state machine
 * (innings completion, targets, results) and builds API/push payloads.
 */
const db_1 = require("./db");
const cricket_1 = require("./cricket");
async function loadFullMatch(matchId) {
    return db_1.db.match.findUnique({
        where: { id: matchId },
        include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
    });
}
async function loadSquads(match) {
    const teams = await db_1.db.team.findMany({
        where: { id: { in: [match.teamAId, match.teamBId] } },
        include: { players: { orderBy: [{ jerseyNumber: 'asc' }, { name: 'asc' }] } },
    });
    const teamA = teams.find((t) => t.id === match.teamAId) ?? null;
    const teamB = teams.find((t) => t.id === match.teamBId) ?? null;
    if (!teamA || !teamB)
        return { teamA, teamB };
    const sortPlayers = (list) => [...list].sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.name.localeCompare(b.name));
    const explicitA = Array.isArray(match.playingXIA) && match.playingXIA.length > 0 ? match.playingXIA : null;
    const explicitB = Array.isArray(match.playingXIB) && match.playingXIB.length > 0 ? match.playingXIB : null;
    const seasonMemberByTeam = new Map();
    if (match.seasonId && (!explicitA || !explicitB)) {
        const memberships = await db_1.TeamMembership.find({
            seasonId: match.seasonId,
            teamId: { $in: [match.teamAId, match.teamBId] },
            status: { $in: ['ACTIVE', 'COMPLETED'] },
        }).lean();
        for (const m of memberships) {
            const list = seasonMemberByTeam.get(m.teamId) ?? [];
            list.push(m.playerId);
            seasonMemberByTeam.set(m.teamId, list);
        }
    }
    const extraIdsA = new Set(explicitA ?? seasonMemberByTeam.get(match.teamAId) ?? []);
    const extraIdsB = new Set(explicitB ?? seasonMemberByTeam.get(match.teamBId) ?? []);
    // Ensure any player appearing in already-recorded balls remains resolvable even after future team transfers
    for (const inn of match.innings ?? []) {
        const batSet = inn.battingTeamId === match.teamAId ? extraIdsA : extraIdsB;
        const bowlSet = inn.bowlingTeamId === match.teamAId ? extraIdsA : extraIdsB;
        for (const b of inn.balls ?? []) {
            if (b.strikerId)
                batSet.add(b.strikerId);
            if (b.nonStrikerId)
                batSet.add(b.nonStrikerId);
            if (b.dismissedId)
                batSet.add(b.dismissedId);
            if (b.bowlerId)
                bowlSet.add(b.bowlerId);
            if (b.assistId)
                bowlSet.add(b.assistId);
        }
    }
    const allWantedIds = [...new Set([...extraIdsA, ...extraIdsB])];
    if (allWantedIds.length > 0) {
        const loaded = await db_1.Player.find({ _id: { $in: allWantedIds } }).lean();
        const byId = new Map(loaded.map((p) => [
            p._id,
            {
                ...p,
                id: p._id,
            },
        ]));
        if (explicitA || seasonMemberByTeam.has(match.teamAId)) {
            teamA.players = sortPlayers([...extraIdsA].map((id) => byId.get(id)).filter(Boolean));
        }
        else if (extraIdsA.size > 0) {
            const currentMap = new Map(teamA.players.map((p) => [p.id, p]));
            for (const id of extraIdsA) {
                if (!currentMap.has(id) && byId.has(id))
                    currentMap.set(id, byId.get(id));
            }
            teamA.players = sortPlayers([...currentMap.values()]);
        }
        if (explicitB || seasonMemberByTeam.has(match.teamBId)) {
            teamB.players = sortPlayers([...extraIdsB].map((id) => byId.get(id)).filter(Boolean));
        }
        else if (extraIdsB.size > 0) {
            const currentMap = new Map(teamB.players.map((p) => [p.id, p]));
            for (const id of extraIdsB) {
                if (!currentMap.has(id) && byId.has(id))
                    currentMap.set(id, byId.get(id));
            }
            teamB.players = sortPlayers([...currentMap.values()]);
        }
    }
    return { teamA, teamB };
}
function teamLite(t) {
    return { id: t.id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl ?? null };
}
function toBallData(b) {
    return {
        id: b.id,
        sequence: b.sequence,
        overNumber: b.overNumber,
        strikerId: b.strikerId,
        nonStrikerId: b.nonStrikerId,
        bowlerId: b.bowlerId,
        runsOffBat: b.runsOffBat,
        extraType: b.extraType,
        extraRuns: b.extraRuns,
        isLegal: b.isLegal,
        isWicket: b.isWicket,
        wicketType: b.wicketType,
        dismissedId: b.dismissedId,
        assistId: b.assistId,
        createdAt: b.createdAt.toISOString(),
    };
}
const playerLite = (p) => ({
    id: p.id,
    playerCode: p.playerCode ?? null,
    name: p.name,
    jerseyNumber: p.jerseyNumber,
    role: p.role,
});
function inningsMeta(inn) {
    return {
        inningsId: inn.id,
        number: inn.number,
        battingTeamId: inn.battingTeamId,
        bowlingTeamId: inn.bowlingTeamId,
        status: inn.status,
        currentStrikerId: inn.currentStrikerId,
        currentNonStrikerId: inn.currentNonStrikerId,
        currentBowlerId: inn.currentBowlerId,
    };
}
/**
 * Re-evaluate innings completion / match result after any scoring change.
 * Also re-opens innings when the last ball is undone.
 */
async function syncMatchState(matchId) {
    let match = await loadFullMatch(matchId);
    if (!match)
        throw new Error('Match not found');
    if (!['LIVE', 'INNINGS_BREAK', 'COMPLETED'].includes(match.status))
        return match;
    const { teamA, teamB } = await loadSquads(match);
    if (!teamA || !teamB)
        return match;
    const nameOf = (id) => (id === teamA.id ? teamA.name : teamB.name);
    const innings1 = match.innings.find((i) => i.number === 1) ?? null;
    const innings2 = match.innings.find((i) => i.number === 2) ?? null;
    const stats1 = innings1
        ? (0, cricket_1.computeInnings)(inningsMeta(innings1), innings1.balls.map(toBallData), (innings1.battingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), (innings1.bowlingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), match.totalOvers)
        : null;
    // ----- Innings 1 natural completion (overs done or all out) -----
    if (innings1 && innings1.status === 'IN_PROGRESS' && stats1 && (match.status === 'LIVE' || match.status === 'INNINGS_BREAK')) {
        const squad1 = innings1.battingTeamId === teamA.id ? teamA.players.length : teamB.players.length;
        const oversDone = stats1.legalBalls >= match.totalOvers * 6;
        const allOut = (0, cricket_1.isAllOut)(stats1.wickets, squad1);
        if (oversDone || allOut) {
            await db_1.db.innings.update({ where: { id: innings1.id }, data: { status: 'COMPLETED' } });
            innings1.status = 'COMPLETED';
            if (match.status === 'LIVE') {
                match = await db_1.db.match.update({
                    where: { id: match.id },
                    data: { status: 'INNINGS_BREAK', target: stats1.runs + 1 },
                    include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
                });
            }
        }
    }
    // ----- Innings 2 completion (chase done, overs done or all out) -----
    if (innings2 && innings2.status === 'IN_PROGRESS' && match.status === 'LIVE' && match.currentInnings === 2 && stats1) {
        const battingTeam2 = innings2.battingTeamId === teamA.id ? teamA : teamB;
        const bowlingTeam2 = innings2.bowlingTeamId === teamA.id ? teamA : teamB;
        const stats2 = (0, cricket_1.computeInnings)(inningsMeta(innings2), innings2.balls.map(toBallData), battingTeam2.players.map(playerLite), bowlingTeam2.players.map(playerLite), match.totalOvers);
        const target = match.target ?? stats1.runs + 1;
        const chased = stats2.runs >= target;
        const oversDone = stats2.legalBalls >= match.totalOvers * 6;
        const allOut = (0, cricket_1.isAllOut)(stats2.wickets, battingTeam2.players.length);
        if (chased || oversDone || allOut) {
            await db_1.db.innings.update({ where: { id: innings2.id }, data: { status: 'COMPLETED' } });
            innings2.status = 'COMPLETED';
            const { text, winnerId } = (0, cricket_1.buildResultText)(stats1, stats2, battingTeam2.players.length, nameOf);
            match = await db_1.db.match.update({
                where: { id: match.id },
                data: { status: 'COMPLETED', resultText: text, winnerId, endedAt: new Date() },
                include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
            });
        }
    }
    return match;
}
/** Full payload for one match (used by GET endpoint and socket broadcast). */
async function buildMatchPayload(matchId) {
    const match = await loadFullMatch(matchId);
    if (!match)
        return null;
    const { teamA, teamB } = await loadSquads(match);
    if (!teamA || !teamB)
        return null;
    const stats = match.innings.map((inn) => (0, cricket_1.computeInnings)(inningsMeta(inn), inn.balls.map(toBallData), (inn.battingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), (inn.bowlingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), match.totalOvers));
    stats.sort((a, b) => a.number - b.number);
    const current = match.status === 'LIVE' || match.status === 'PAUSED'
        ? stats.find((s) => s.number === match.currentInnings && s.live) ?? null
        : null;
    let live = null;
    if (current) {
        const battingTeam = current.battingTeamId === teamA.id ? teamA : teamB;
        const bowlingTeam = current.bowlingTeamId === teamA.id ? teamA : teamB;
        const bowlerStats = new Map(current.bowling.map((b) => [b.id, b]));
        const maxOvers = Math.max(1, Math.ceil(match.totalOvers / 5));
        const lastOverBowlerId = current.live?.lastOverBowlerId ?? null;
        const atCrease = new Set([current.live?.strikerId, current.live?.nonStrikerId].filter(Boolean));
        const yetToBat = battingTeam.players
            .filter((p) => !atCrease.has(p.id) && !current.batting.find((b) => b.id === p.id)?.batted)
            .map(playerLite);
        const ballsLeft = match.totalOvers * 6 - current.legalBalls;
        const bowlerOptions = bowlingTeam.players.map((p) => {
            const st = bowlerStats.get(p.id);
            const legalBalls = st?.legalBalls ?? 0;
            const completeOvers = Math.floor(legalBalls / 6);
            const isCurrentBowler = p.id === (current.live?.bowlerId ?? '');
            const limitReached = completeOvers >= maxOvers && legalBalls % 6 === 0;
            const consecutive = lastOverBowlerId !== null && p.id === lastOverBowlerId;
            let blockedReason = null;
            if (limitReached)
                blockedReason = `Over limit reached (${maxOvers} max)`;
            else if (consecutive)
                blockedReason = 'Bowled the previous over';
            return {
                id: p.id,
                name: p.name,
                overs: (0, cricket_1.oversStr)(legalBalls),
                runs: st?.runsConceded ?? 0,
                wickets: st?.wickets ?? 0,
                maxOvers,
                blocked: limitReached || consecutive || (isCurrentBowler && !current.live?.overComplete),
                blockedReason,
            };
        });
        live = {
            inningsNumber: current.number,
            battingTeamId: current.battingTeamId,
            bowlingTeamId: current.bowlingTeamId,
            strikerId: current.live?.strikerId ?? null,
            nonStrikerId: current.live?.nonStrikerId ?? null,
            bowlerId: current.live?.bowlerId ?? null,
            needsNewBatsman: current.live?.needsNewBatsman ?? null,
            overComplete: current.live?.overComplete ?? false,
            lastOverBowlerId,
            currentRunRate: current.runRate,
            requiredRunRate: match.target
                ? ballsLeft > 0
                    ? (0, cricket_1.round2)(((match.target - current.runs) * 6) / ballsLeft)
                    : null
                : null,
            target: match.target ?? null,
            ballsRemaining: ballsLeft,
            yetToBat,
            bowlers: bowlerOptions,
            thisOver: current.overs.length ? current.overs[current.overs.length - 1].balls : [],
            squadSizes: { batting: battingTeam.players.length, bowling: bowlingTeam.players.length },
            maxWickets: (0, cricket_1.maxWicketsFor)(battingTeam.players.length),
        };
    }
    const squadOf = (teamId) => (teamId === teamA.id ? teamA.players.length : teamB.players.length);
    const scores = stats.map((s) => ({
        number: s.number,
        battingTeamId: s.battingTeamId,
        runs: s.runs,
        wickets: s.wickets,
        overs: s.oversDisplay,
        declared: s.status === 'COMPLETED' &&
            s.legalBalls < match.totalOvers * 6 &&
            !(0, cricket_1.isAllOut)(s.wickets, squadOf(s.battingTeamId)),
    }));
    const matchSummary = {
        id: match.id,
        format: match.format,
        totalOvers: match.totalOvers,
        venue: match.venue,
        status: match.status,
        seasonId: match.seasonId ?? null,
        tournamentId: match.tournamentId ?? null,
        matchDate: match.matchDate instanceof Date ? match.matchDate.toISOString() : (match.matchDate ?? null),
        scorecardStatus: match.scorecardStatus ?? 'DRAFT',
        playerOfMatchId: match.playerOfMatchId ?? null,
        playingXIA: match.playingXIA ?? [],
        playingXIB: match.playingXIB ?? [],
        playerStatuses: match.playerStatuses ?? [],
        currentInnings: match.currentInnings,
        tossWinnerId: match.tossWinnerId,
        tossDecision: match.tossDecision,
        battingFirstId: match.battingFirstId,
        target: match.target,
        resultText: match.resultText,
        winnerId: match.winnerId,
        createdAt: match.createdAt.toISOString(),
        startedAt: match.startedAt?.toISOString() ?? null,
        endedAt: match.endedAt?.toISOString() ?? null,
        teamA: teamLite(teamA),
        teamB: teamLite(teamB),
        scores,
        liveTeamId: current ? current.battingTeamId : null,
    };
    return { match: matchSummary, innings: stats, live };
}
/** Lightweight list payload for match cards. */
async function buildMatchSummaries() {
    const matches = await db_1.db.match.findMany({
        orderBy: { createdAt: 'desc' },
        include: { innings: { include: { balls: true } } },
    });
    const teamIds = new Set();
    for (const m of matches) {
        teamIds.add(m.teamAId);
        teamIds.add(m.teamBId);
    }
    const teams = await db_1.db.team.findMany({ where: { id: { in: [...teamIds] } } });
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    const lit = (id) => {
        const t = teamMap.get(id);
        return t ? teamLite(t) : { id, name: 'Unknown', shortName: 'UNK', color: '#6b7280' };
    };
    return matches.map((m) => {
        const sorted = [...m.innings].sort((a, b) => a.number - b.number);
        const scores = sorted.map((inn) => {
            let runs = 0;
            let wickets = 0;
            let legal = 0;
            for (const b of inn.balls) {
                runs += b.runsOffBat + b.extraRuns;
                if (b.isWicket)
                    wickets++;
                if (b.isLegal)
                    legal++;
            }
            return {
                number: inn.number,
                battingTeamId: inn.battingTeamId,
                runs,
                wickets,
                overs: (0, cricket_1.oversStr)(legal),
                declared: inn.status === 'COMPLETED',
            };
        });
        return {
            id: m.id,
            format: m.format,
            totalOvers: m.totalOvers,
            venue: m.venue,
            status: m.status,
            seasonId: m.seasonId ?? null,
            tournamentId: m.tournamentId ?? null,
            matchDate: m.matchDate instanceof Date ? m.matchDate.toISOString() : (m.matchDate ?? null),
            scorecardStatus: m.scorecardStatus ?? 'DRAFT',
            playerOfMatchId: m.playerOfMatchId ?? null,
            playingXIA: m.playingXIA ?? [],
            playingXIB: m.playingXIB ?? [],
            playerStatuses: m.playerStatuses ?? [],
            currentInnings: m.currentInnings,
            tossWinnerId: m.tossWinnerId,
            tossDecision: m.tossDecision,
            battingFirstId: m.battingFirstId,
            target: m.target,
            resultText: m.resultText,
            winnerId: m.winnerId,
            createdAt: m.createdAt.toISOString(),
            startedAt: m.startedAt?.toISOString() ?? null,
            endedAt: m.endedAt?.toISOString() ?? null,
            teamA: lit(m.teamAId),
            teamB: lit(m.teamBId),
            scores,
            liveTeamId: m.status === 'LIVE' ? scores.find((s) => s.number === m.currentInnings)?.battingTeamId ?? null : null,
        };
    });
}
