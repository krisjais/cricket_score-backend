"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const api_utils_1 = require("../lib/api-utils");
const router = (0, express_1.Router)();
const BOWLER_WICKETS = new Set([
    'BOWLED',
    'CAUGHT',
    'CAUGHT_AND_BOWLED',
    'LBW',
    'STUMPED',
]);
const round2 = (n) => Math.round(n * 100) / 100;
function buildDivisionAwards(pool) {
    const topBatsmen = [...pool]
        .filter((p) => p.runs > 0 || p.ballsFaced > 0)
        .sort((a, b) => b.runs - a.runs ||
        b.strikeRate - a.strikeRate ||
        b.fours + b.sixes - (a.fours + a.sixes) ||
        a.name.localeCompare(b.name))
        .slice(0, 10);
    const topBowlers = [...pool]
        .filter((p) => p.wickets > 0 || p.legalBalls > 0)
        .sort((a, b) => b.wickets - a.wickets ||
        (a.legalBalls > 0 && b.legalBalls > 0 ? a.economy - b.economy : b.legalBalls - a.legalBalls) ||
        a.runsConceded - b.runsConceded ||
        a.name.localeCompare(b.name))
        .slice(0, 10);
    const topFielders = [...pool]
        .filter((p) => p.fieldingDismissals > 0)
        .sort((a, b) => b.catchRunOuts - a.catchRunOuts ||
        b.catches - a.catches ||
        b.runOuts - a.runOuts ||
        b.stumpings - a.stumpings ||
        a.name.localeCompare(b.name))
        .slice(0, 10);
    const topMvp = [...pool]
        .filter((p) => p.mvpPoints > 0)
        .sort((a, b) => b.mvpPoints - a.mvpPoints ||
        b.runs - a.runs ||
        b.wickets - a.wickets ||
        b.fieldingDismissals - a.fieldingDismissals ||
        a.name.localeCompare(b.name))
        .slice(0, 10);
    return {
        playerCount: pool.length,
        playerOfTournament: topMvp[0] ?? null,
        bestBatsman: topBatsmen.find((p) => p.runs > 0) ?? null,
        bestBowler: topBowlers.find((p) => p.wickets > 0) ?? null,
        bestFielder: topFielders.find((p) => p.catchRunOuts > 0) ?? null,
        topMvp,
        topBatsmen,
        topBowlers,
        topFielders,
    };
}
// GET /api/awards - Tournament awards & leaderboards split by Men & Women
router.get('/', async (_req, res) => {
    try {
        const [players, matches] = await Promise.all([
            db_1.db.player.findMany({
                orderBy: [{ name: 'asc' }],
                include: { team: true },
            }),
            db_1.db.match.findMany({
                include: { innings: { include: { balls: true } } },
            }),
        ]);
        const statsMap = new Map();
        for (const p of players) {
            statsMap.set(p.id, {
                playerId: p.id,
                name: p.name,
                role: p.role,
                gender: p.gender === 'FEMALE' ? 'FEMALE' : 'MALE',
                jerseyNumber: p.jerseyNumber ?? null,
                avatarUrl: p.avatarUrl ?? null,
                team: p.team
                    ? {
                        id: p.team.id,
                        name: p.team.name,
                        shortName: p.team.shortName,
                        color: p.team.color || '#0d3a24',
                        logoUrl: p.team.logoUrl ?? null,
                    }
                    : null,
                matches: 0,
                inningsBatted: 0,
                runs: 0,
                ballsFaced: 0,
                fours: 0,
                sixes: 0,
                highestScore: 0,
                strikeRate: 0,
                legalBalls: 0,
                overs: '0.0',
                runsConceded: 0,
                wickets: 0,
                economy: 0,
                catches: 0,
                runOuts: 0,
                stumpings: 0,
                catchRunOuts: 0,
                fieldingDismissals: 0,
                mvpPoints: 0,
            });
        }
        const validMatches = matches.filter((m) => m.status !== 'ABANDONED');
        for (const m of validMatches) {
            const matchTouched = new Set();
            const inningsList = m.innings || [];
            for (const inn of inningsList) {
                const balls = inn.balls || [];
                const battedInInn = new Set();
                const runsInInn = new Map();
                for (const b of balls) {
                    for (const pid of [b.strikerId, b.nonStrikerId, b.bowlerId, b.dismissedId, b.assistId]) {
                        if (pid && statsMap.has(pid))
                            matchTouched.add(pid);
                    }
                    // Batting stats
                    if (b.strikerId && statsMap.has(b.strikerId)) {
                        const st = statsMap.get(b.strikerId);
                        battedInInn.add(b.strikerId);
                        if (b.extraType !== 'WIDE')
                            st.ballsFaced++;
                        st.runs += b.runsOffBat;
                        runsInInn.set(b.strikerId, (runsInInn.get(b.strikerId) ?? 0) + b.runsOffBat);
                        if (b.runsOffBat === 4)
                            st.fours++;
                        if (b.runsOffBat === 6)
                            st.sixes++;
                    }
                    if (b.nonStrikerId && statsMap.has(b.nonStrikerId)) {
                        battedInInn.add(b.nonStrikerId);
                    }
                    // Bowling stats
                    if (b.bowlerId && statsMap.has(b.bowlerId)) {
                        const st = statsMap.get(b.bowlerId);
                        if (b.isLegal)
                            st.legalBalls++;
                        if (b.extraType === 'WIDE' || b.extraType === 'NO_BALL') {
                            st.runsConceded += b.runsOffBat + b.extraRuns;
                        }
                        else {
                            st.runsConceded += b.runsOffBat;
                        }
                        if (b.isWicket && BOWLER_WICKETS.has(b.wicketType || '')) {
                            st.wickets++;
                        }
                    }
                    // Fielding stats (catches, run-outs, stumpings)
                    if (b.isWicket) {
                        if (b.wicketType === 'CAUGHT' && b.assistId && statsMap.has(b.assistId)) {
                            statsMap.get(b.assistId).catches++;
                        }
                        else if (b.wicketType === 'CAUGHT_AND_BOWLED' && b.bowlerId && statsMap.has(b.bowlerId)) {
                            statsMap.get(b.bowlerId).catches++;
                        }
                        else if (b.wicketType === 'RUN_OUT' && b.assistId && statsMap.has(b.assistId)) {
                            statsMap.get(b.assistId).runOuts++;
                        }
                        else if (b.wicketType === 'STUMPED' && b.assistId && statsMap.has(b.assistId)) {
                            statsMap.get(b.assistId).stumpings++;
                        }
                    }
                }
                for (const pid of battedInInn) {
                    statsMap.get(pid).inningsBatted++;
                }
                for (const [pid, innRuns] of runsInInn) {
                    const st = statsMap.get(pid);
                    if (innRuns > st.highestScore)
                        st.highestScore = innRuns;
                }
            }
            for (const pid of matchTouched) {
                statsMap.get(pid).matches++;
            }
        }
        // Finalize derived metrics & MVP points
        const allStats = [...statsMap.values()].map((s) => {
            const catchRunOuts = s.catches + s.runOuts;
            const fieldingDismissals = s.catches + s.runOuts + s.stumpings;
            const mvpPoints = s.runs + s.wickets * 20 + fieldingDismissals * 10;
            return {
                ...s,
                strikeRate: s.ballsFaced > 0 ? round2((s.runs * 100) / s.ballsFaced) : 0,
                overs: `${Math.floor(s.legalBalls / 6)}.${s.legalBalls % 6}`,
                economy: s.legalBalls > 0 ? round2((s.runsConceded * 6) / s.legalBalls) : 0,
                catchRunOuts,
                fieldingDismissals,
                mvpPoints,
            };
        });
        const menPool = allStats.filter((p) => p.gender === 'MALE');
        const womenPool = allStats.filter((p) => p.gender === 'FEMALE');
        return (0, api_utils_1.sendOk)(res, {
            summary: {
                totalMatches: validMatches.length,
                completedMatches: validMatches.filter((m) => m.status === 'COMPLETED').length,
                liveMatches: validMatches.filter((m) => m.status === 'LIVE').length,
                totalPlayers: allStats.length,
                menPlayers: menPool.length,
                womenPlayers: womenPool.length,
            },
            men: buildDivisionAwards(menPool),
            women: buildDivisionAwards(womenPool),
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to compute tournament awards', 500);
    }
});
exports.default = router;
