"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const api_utils_1 = require("../lib/api-utils");
const cricket_1 = require("../lib/cricket");
const stats_service_1 = require("../lib/stats-service");
const router = (0, express_1.Router)();
/**
 * Qualification thresholds prevent single-appearance outliers from topping rate-based rankings.
 */
function qualificationRule(category, scopeMatchesCount) {
    const minInnings = scopeMatchesCount <= 2 ? 1 : 2;
    const minBallsFaced = scopeMatchesCount <= 2 ? 1 : 20;
    const minLegalBallsBowled = scopeMatchesCount <= 2 ? 1 : 18;
    switch (category) {
        case 'batting_avg':
            return { minInnings, label: `Min ${minInnings} innings` };
        case 'strike_rate':
            return { minBallsFaced, label: `Min ${minBallsFaced} ball${minBallsFaced === 1 ? '' : 's'} faced` };
        case 'bowling_avg':
            return { minLegalBallsBowled, label: `Min ${minLegalBallsBowled} legal ball${minLegalBallsBowled === 1 ? '' : 's'} & 1+ wicket` };
        case 'economy':
            return { minLegalBallsBowled, label: `Min ${minLegalBallsBowled} legal ball${minLegalBallsBowled === 1 ? '' : 's'} bowled` };
        default:
            return { label: 'All matches' };
    }
}
// GET /api/leaderboards
router.get('/', async (req, res) => {
    try {
        await (0, db_1.connectDB)();
        const category = String(req.query.category || 'runs');
        const scope = String(req.query.scope || 'ALL_TIME').toUpperCase();
        const seasonId = typeof req.query.seasonId === 'string' && req.query.seasonId ? req.query.seasonId : null;
        const tournamentId = typeof req.query.tournamentId === 'string' && req.query.tournamentId ? req.query.tournamentId : null;
        const teamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : null;
        // Track all completed and live matches in scope (non-abandoned)
        const matchQuery = { status: { $ne: 'ABANDONED' } };
        if (scope === 'SEASON' && seasonId)
            matchQuery.seasonId = seasonId;
        if (scope === 'TOURNAMENT' && tournamentId)
            matchQuery.tournamentId = tournamentId;
        const matches = await db_1.Match.find(matchQuery).select({ _id: 1, scorecardStatus: 1 }).lean();
        const matchIds = matches.map((m) => m._id);
        if (matchIds.length === 0) {
            return (0, api_utils_1.sendOk)(res, {
                category,
                scope,
                qualification: qualificationRule(category, 0).label,
                totalVerifiedMatches: 0,
                totalMatches: 0,
                honors: {
                    bestBatsman: null,
                    bestBowler: null,
                    bestFielder: null,
                    playerOfTournament: null,
                    mostSixes: null,
                    mostFours: null,
                },
                entries: [],
            });
        }
        const statQuery = { matchId: { $in: matchIds } };
        if (scope === 'TEAM' && teamId)
            statQuery.teamId = teamId;
        const [existingMatchStats, players, teams] = await Promise.all([
            db_1.PlayerMatchStat.find(statQuery).lean(),
            db_1.Player.find({ status: { $ne: 'MERGED' } }).lean(),
            db_1.Team.find({}).lean(),
        ]);
        // Find matches that don't have persisted PlayerMatchStat rows yet (live or unverified completed)
        const matchesWithPersistedStats = new Set(existingMatchStats.map((s) => s.matchId));
        const missingMatchIds = matchIds.filter((mid) => !matchesWithPersistedStats.has(mid));
        let dynamicStats = [];
        if (missingMatchIds.length > 0) {
            const computed = await Promise.all(missingMatchIds.map((mid) => (0, stats_service_1.computeMatchPlayerStats)(mid, 0)
                .then((r) => r.rows)
                .catch((err) => {
                console.error(`Leaderboard computeMatchPlayerStats error for ${mid}:`, err);
                return [];
            })));
            dynamicStats = computed.flat();
            if (scope === 'TEAM' && teamId) {
                dynamicStats = dynamicStats.filter((s) => s.teamId === teamId);
            }
        }
        const matchStats = [...existingMatchStats, ...dynamicStats];
        const playerMap = new Map(players.map((p) => [p._id, p]));
        const teamMap = new Map(teams.map((t) => [t._id, t]));
        const buckets = new Map();
        for (const st of matchStats) {
            const p = playerMap.get(st.playerId);
            if (!p)
                continue;
            let b = buckets.get(st.playerId);
            if (!b) {
                b = {
                    playerId: st.playerId,
                    latestTeamId: st.teamId,
                    matches: 0,
                    inningsBatted: 0,
                    runs: 0,
                    ballsFaced: 0,
                    fours: 0,
                    sixes: 0,
                    notOuts: 0,
                    highestScore: 0,
                    fifties: 0,
                    hundreds: 0,
                    inningsBowled: 0,
                    legalBalls: 0,
                    runsConceded: 0,
                    wickets: 0,
                    maidens: 0,
                    bestW: 0,
                    bestR: 0,
                    catches: 0,
                    runOuts: 0,
                    stumpings: 0,
                    playerOfMatch: 0,
                };
                buckets.set(st.playerId, b);
            }
            b.latestTeamId = st.teamId;
            if (st.played && !st.absent)
                b.matches += 1;
            if (st.batting && st.batting.innings > 0) {
                b.inningsBatted += st.batting.innings;
                b.runs += st.batting.runs;
                b.ballsFaced += st.batting.balls;
                b.fours += st.batting.fours;
                b.sixes += st.batting.sixes;
                if (st.batting.notOut)
                    b.notOuts += 1;
                b.highestScore = Math.max(b.highestScore, st.batting.runs);
                b.fifties += st.batting.fifty;
                b.hundreds += st.batting.hundred;
            }
            if (st.bowling && st.bowling.innings > 0) {
                b.inningsBowled += st.bowling.innings;
                b.legalBalls += st.bowling.legalBalls;
                b.runsConceded += st.bowling.runsConceded;
                b.wickets += st.bowling.wickets;
                b.maidens += st.bowling.maidens;
                if (b.inningsBowled === st.bowling.innings ||
                    st.bowling.bestFiguresWickets > b.bestW ||
                    (st.bowling.bestFiguresWickets === b.bestW && st.bowling.bestFiguresRuns < b.bestR)) {
                    b.bestW = st.bowling.bestFiguresWickets;
                    b.bestR = st.bowling.bestFiguresRuns;
                }
            }
            if (st.fielding) {
                b.catches += st.fielding.catches;
                b.runOuts += st.fielding.runOuts;
                b.stumpings += st.fielding.stumpings;
            }
            if (st.isPlayerOfMatch)
                b.playerOfMatch += 1;
        }
        const verifiedMatchesCount = matches.filter((m) => m.scorecardStatus === 'VERIFIED').length;
        const totalMatchesCount = matches.length;
        const qual = qualificationRule(category, totalMatchesCount);
        const rows = [...buckets.values()].map((b) => {
            const p = playerMap.get(b.playerId);
            const tm = (b.latestTeamId ? teamMap.get(b.latestTeamId) : null) ?? (p.teamId ? teamMap.get(p.teamId) : null);
            const dismissals = b.inningsBatted - b.notOuts;
            const battingAverage = dismissals > 0 ? (0, cricket_1.round2)(b.runs / dismissals) : (b.runs > 0 ? b.runs : null);
            const strikeRate = b.ballsFaced > 0 ? (0, cricket_1.round2)((b.runs * 100) / b.ballsFaced) : 0;
            const bowlingAverage = b.wickets > 0 ? (0, cricket_1.round2)(b.runsConceded / b.wickets) : null;
            const economy = b.legalBalls > 0 ? (0, cricket_1.round2)((b.runsConceded * 6) / b.legalBalls) : 0;
            const allRounderScore = (0, cricket_1.round2)(b.runs + b.wickets * 25 + (b.catches + b.runOuts + b.stumpings) * 10);
            return {
                playerId: p._id,
                playerCode: p.playerCode,
                name: p.name,
                role: p.role,
                avatarUrl: p.avatarUrl ?? null,
                isVerified: Boolean(p.isVerified),
                team: tm ? { id: tm._id, name: tm.name, shortName: tm.shortName, color: tm.color, logoUrl: tm.logoUrl ?? null } : null,
                matches: b.matches,
                inningsBatted: b.inningsBatted,
                runs: b.runs,
                ballsFaced: b.ballsFaced,
                fours: b.fours,
                sixes: b.sixes,
                highestScore: b.highestScore,
                notOuts: b.notOuts,
                battingAverage,
                strikeRate,
                fifties: b.fifties,
                hundreds: b.hundreds,
                legalBalls: b.legalBalls,
                overs: (0, cricket_1.oversStr)(b.legalBalls),
                runsConceded: b.runsConceded,
                wickets: b.wickets,
                maidens: b.maidens,
                bowlingAverage,
                economy,
                bestBowlingWickets: b.bestW,
                bestBowlingRuns: b.bestR,
                bestBowlingDisplay: b.inningsBowled > 0 ? `${b.bestW}/${b.bestR}` : '0/0',
                catches: b.catches,
                runOuts: b.runOuts,
                stumpings: b.stumpings,
                playerOfMatch: b.playerOfMatch,
                allRounderScore,
            };
        });
        // Compute top honors for spotlight
        const topRuns = [...rows].filter((r) => r.runs > 0).sort((a, b) => b.runs - a.runs || b.strikeRate - a.strikeRate);
        const topWickets = [...rows].filter((r) => r.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.economy - b.economy);
        const topFielders = [...rows].filter((r) => (r.catches + r.runOuts + r.stumpings) > 0).sort((a, b) => (b.catches + b.runOuts + b.stumpings) - (a.catches + a.runOuts + a.stumpings));
        const topMvp = [...rows].filter((r) => r.allRounderScore > 0).sort((a, b) => b.allRounderScore - a.allRounderScore);
        const topSixes = [...rows].filter((r) => r.sixes > 0).sort((a, b) => b.sixes - a.sixes || b.runs - a.runs);
        const topFours = [...rows].filter((r) => r.fours > 0).sort((a, b) => b.fours - a.fours || b.runs - a.runs);
        const honors = {
            bestBatsman: topRuns[0] ?? null,
            bestBowler: topWickets[0] ?? null,
            bestFielder: topFielders[0] ?? null,
            playerOfTournament: topMvp[0] ?? null,
            mostSixes: topSixes[0] ?? null,
            mostFours: topFours[0] ?? null,
        };
        const filtered = rows.filter((r) => {
            switch (category) {
                case 'runs':
                    return r.runs > 0;
                case 'batting_avg':
                    return r.inningsBatted >= (qual.minInnings ?? 1) && r.battingAverage !== null && r.runs > 0;
                case 'strike_rate':
                    return r.ballsFaced >= (qual.minBallsFaced ?? 6);
                case 'hundreds':
                    return r.hundreds > 0;
                case 'fifties':
                    return r.fifties > 0;
                case 'sixes':
                    return r.sixes > 0;
                case 'wickets':
                    return r.wickets > 0;
                case 'bowling_avg':
                    return r.legalBalls >= (qual.minLegalBallsBowled ?? 6) && r.bowlingAverage !== null && r.wickets > 0;
                case 'economy':
                    return r.legalBalls >= (qual.minLegalBallsBowled ?? 6);
                case 'best_bowling':
                    return r.legalBalls > 0;
                case 'catches':
                    return r.catches > 0;
                case 'run_outs':
                    return r.runOuts > 0;
                case 'player_of_match':
                    return r.playerOfMatch > 0;
                case 'all_rounder':
                    return r.allRounderScore > 0;
                default:
                    return r.matches > 0;
            }
        });
        filtered.sort((a, b) => {
            switch (category) {
                case 'runs':
                    return b.runs - a.runs || b.strikeRate - a.strikeRate;
                case 'batting_avg':
                    return (b.battingAverage ?? 0) - (a.battingAverage ?? 0) || b.runs - a.runs;
                case 'strike_rate':
                    return b.strikeRate - a.strikeRate || b.runs - a.runs;
                case 'hundreds':
                    return b.hundreds - a.hundreds || b.runs - a.runs;
                case 'fifties':
                    return b.fifties - a.fifties || b.runs - a.runs;
                case 'sixes':
                    return b.sixes - a.sixes || b.runs - a.runs;
                case 'wickets':
                    return b.wickets - a.wickets || a.economy - b.economy;
                case 'bowling_avg':
                    return (a.bowlingAverage ?? 9999) - (b.bowlingAverage ?? 9999) || b.wickets - a.wickets;
                case 'economy':
                    return a.economy - b.economy || b.wickets - a.wickets;
                case 'best_bowling':
                    return b.bestBowlingWickets - a.bestBowlingWickets || a.bestBowlingRuns - b.bestBowlingRuns;
                case 'catches':
                    return b.catches - a.catches || b.matches - a.matches;
                case 'run_outs':
                    return b.runOuts - a.runOuts || b.matches - a.matches;
                case 'player_of_match':
                    return b.playerOfMatch - a.playerOfMatch || b.allRounderScore - a.allRounderScore;
                case 'all_rounder':
                    return b.allRounderScore - a.allRounderScore;
                default:
                    return b.runs - a.runs;
            }
        });
        return (0, api_utils_1.sendOk)(res, {
            category,
            scope,
            qualification: qual.label,
            totalVerifiedMatches: verifiedMatchesCount > 0 ? verifiedMatchesCount : totalMatchesCount,
            totalMatches: totalMatchesCount,
            honors,
            entries: filtered.slice(0, 50).map((r, i) => ({ ...r, rank: i + 1 })),
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Failed to compute leaderboards', 500);
    }
});
exports.default = router;
