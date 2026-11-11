"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_BOWLER_WICKETS = void 0;
exports.writeAuditLog = writeAuditLog;
exports.computeMatchSnapshotHash = computeMatchSnapshotHash;
exports.computeMatchPlayerStats = computeMatchPlayerStats;
exports.rebuildCareerStatsForPlayers = rebuildCareerStatsForPlayers;
exports.finalizeMatchScorecard = finalizeMatchScorecard;
exports.verifyMatchAndSyncStats = verifyMatchAndSyncStats;
exports.correctMatchAndRecalculate = correctMatchAndRecalculate;
exports.recalculateStats = recalculateStats;
exports.mergePlayersAndRecalculate = mergePlayersAndRecalculate;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const cricket_1 = require("./cricket");
/**
 * Official tournament rules per specification:
 * Run-outs, hit wickets, retired hurt, retired out, absent, and obstructing-the-field
 * are NEVER credited as bowler wickets.
 */
exports.OFFICIAL_BOWLER_WICKETS = new Set([
    'BOWLED',
    'CAUGHT',
    'CAUGHT_AND_BOWLED',
    'LBW',
    'STUMPED',
]);
const NON_DISMISSAL_WICKET_TYPES = new Set(['RETIRED_HURT', 'ABSENT']);
function toBallData(b) {
    return {
        id: String(b._id ?? b.id),
        sequence: b.sequence,
        overNumber: b.overNumber,
        strikerId: b.strikerId,
        nonStrikerId: b.nonStrikerId,
        bowlerId: b.bowlerId,
        runsOffBat: b.runsOffBat ?? 0,
        extraType: b.extraType ?? null,
        extraRuns: b.extraRuns ?? 0,
        isLegal: Boolean(b.isLegal),
        isWicket: Boolean(b.isWicket),
        wicketType: b.wicketType ?? null,
        dismissedId: b.dismissedId ?? null,
        assistId: b.assistId ?? null,
        createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt ?? ''),
    };
}
function dismissalLabel(ball, nameOf) {
    const bowler = nameOf(ball.bowlerId);
    switch (ball.wicketType) {
        case 'BOWLED':
            return `b ${bowler}`;
        case 'CAUGHT':
            return `c ${ball.assistId ? nameOf(ball.assistId) : 'fielder'} b ${bowler}`;
        case 'CAUGHT_AND_BOWLED':
            return `c & b ${bowler}`;
        case 'LBW':
            return `lbw b ${bowler}`;
        case 'STUMPED':
            return `st ${ball.assistId ? nameOf(ball.assistId) : 'wk'} b ${bowler}`;
        case 'HIT_WICKET':
            return `hit wicket`;
        case 'RUN_OUT':
            return `run out${ball.assistId ? ` (${nameOf(ball.assistId)})` : ''}`;
        case 'RETIRED_HURT':
            return 'retired hurt';
        case 'RETIRED_OUT':
            return 'retired out';
        case 'ABSENT':
            return 'absent';
        case 'OBSTRUCTING_FIELD':
            return 'obstructing the field';
        default:
            return 'out';
    }
}
async function writeAuditLog(entry, session = null) {
    await db_1.StatisticsAuditLog.create([
        {
            action: entry.action,
            actorType: entry.actor.type,
            actorId: entry.actor.id,
            actorName: entry.actor.name,
            matchId: entry.matchId ?? null,
            playerId: entry.playerId ?? null,
            sourcePlayerId: entry.sourcePlayerId ?? null,
            targetPlayerId: entry.targetPlayerId ?? null,
            reason: entry.reason ?? null,
            beforeSummary: entry.beforeSummary ?? null,
            afterSummary: entry.afterSummary ?? null,
            metadata: entry.metadata ?? null,
        },
    ], session ? { session } : undefined);
}
function computeMatchSnapshotHash(match, inningsWithBalls) {
    const canonical = {
        matchId: match._id,
        status: match.status,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        seasonId: match.seasonId ?? null,
        tournamentId: match.tournamentId ?? null,
        winnerId: match.winnerId ?? null,
        resultText: match.resultText ?? null,
        playerOfMatchId: match.playerOfMatchId ?? null,
        playingXIA: [...(match.playingXIA ?? [])].sort(),
        playingXIB: [...(match.playingXIB ?? [])].sort(),
        playerStatuses: [...(match.playerStatuses ?? [])].sort((a, b) => a.playerId.localeCompare(b.playerId)),
        innings: inningsWithBalls
            .sort((a, b) => String(a._id ?? a.id).localeCompare(String(b._id ?? b.id)))
            .map((inn) => ({
            battingTeamId: inn.battingTeamId,
            bowlingTeamId: inn.bowlingTeamId,
            balls: (inn.balls ?? []).map((b) => ({
                seq: b.sequence,
                over: b.overNumber,
                s: b.strikerId,
                ns: b.nonStrikerId,
                bw: b.bowlerId,
                r: b.runsOffBat,
                et: b.extraType ?? null,
                er: b.extraRuns,
                l: Boolean(b.isLegal),
                w: Boolean(b.isWicket),
                wt: b.wicketType ?? null,
                di: b.dismissedId ?? null,
                ai: b.assistId ?? null,
            })),
        })),
    };
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical)).digest('hex');
}
async function resolveMatchParticipants(match, inningsList, session) {
    const playerTeamMap = new Map();
    const setIfMissing = (pid, tid) => {
        if (pid && tid && !playerTeamMap.has(pid)) {
            playerTeamMap.set(pid, tid);
        }
    };
    // 1. Explicit Playing XI takes top precedence
    for (const pid of match.playingXIA ?? [])
        setIfMissing(pid, match.teamAId);
    for (const pid of match.playingXIB ?? [])
        setIfMissing(pid, match.teamBId);
    // 2. Anyone who actually appeared in ball events (bat/bowl) is assigned from innings teams
    for (const inn of inningsList) {
        for (const ball of inn.balls) {
            setIfMissing(ball.strikerId, inn.battingTeamId);
            setIfMissing(ball.nonStrikerId, inn.battingTeamId);
            if (ball.dismissedId)
                setIfMissing(ball.dismissedId, inn.battingTeamId);
            setIfMissing(ball.bowlerId, inn.bowlingTeamId);
            if (ball.assistId)
                setIfMissing(ball.assistId, inn.bowlingTeamId);
        }
    }
    // 3. Fallback when Playing XI wasn't explicitly set: include season memberships / active team roster
    if ((match.playingXIA?.length ?? 0) === 0 || (match.playingXIB?.length ?? 0) === 0) {
        const teamIdsToFill = [];
        if ((match.playingXIA?.length ?? 0) === 0)
            teamIdsToFill.push(match.teamAId);
        if ((match.playingXIB?.length ?? 0) === 0)
            teamIdsToFill.push(match.teamBId);
        if (match.seasonId) {
            const memberships = await db_1.TeamMembership.find({
                seasonId: match.seasonId,
                teamId: { $in: teamIdsToFill },
                status: { $in: ['ACTIVE', 'COMPLETED'] },
            })
                .session(session)
                .lean();
            for (const m of memberships) {
                setIfMissing(m.playerId, m.teamId);
            }
        }
        const fallbackPlayers = await db_1.Player.find({
            teamId: { $in: teamIdsToFill },
            status: { $ne: 'MERGED' },
        })
            .select({ _id: 1, teamId: 1 })
            .session(session)
            .lean();
        for (const p of fallbackPlayers) {
            if (p.teamId)
                setIfMissing(p._id, p.teamId);
        }
    }
    return playerTeamMap;
}
async function computeMatchPlayerStats(matchId, verificationVersion, session = null) {
    const match = await db_1.Match.findById(matchId).session(session).lean();
    if (!match)
        throw new Error('Match not found');
    const inningsDocs = await db_1.Innings.find({ matchId }).sort({ number: 1 }).session(session).lean();
    const innIds = inningsDocs.map((i) => i._id);
    const rawBalls = await db_1.Ball.find({ inningsId: { $in: innIds } }).sort({ sequence: 1 }).session(session).lean();
    const ballsByInn = new Map();
    for (const b of rawBalls) {
        const list = ballsByInn.get(b.inningsId) ?? [];
        list.push(toBallData(b));
        ballsByInn.set(b.inningsId, list);
    }
    const inningsWithBalls = inningsDocs.map((inn) => ({
        ...inn,
        balls: ballsByInn.get(inn._id) ?? [],
    }));
    const participants = await resolveMatchParticipants(match, inningsWithBalls, session);
    const playerIds = [...participants.keys()];
    const playerDocs = await db_1.Player.find({ _id: { $in: playerIds } }).select({ _id: 1, name: 1 }).session(session).lean();
    const nameMap = new Map(playerDocs.map((p) => [p._id, p.name]));
    const nameOf = (id) => nameMap.get(id) ?? 'Player';
    const statusOverrideMap = new Map((match.playerStatuses ?? []).map((entry) => [entry.playerId, entry.status]));
    const aggMap = new Map();
    const ensure = (pid) => {
        let a = aggMap.get(pid);
        if (!a) {
            a = {
                teamId: participants.get(pid) ?? match.teamAId,
                battedInnings: 0,
                runs: 0,
                balls: 0,
                fours: 0,
                sixes: 0,
                out: false,
                retiredHurt: false,
                retiredOut: false,
                dismissalType: null,
                dismissalText: null,
                bowledInnings: 0,
                legalBalls: 0,
                runsConceded: 0,
                wickets: 0,
                maidens: 0,
                wides: 0,
                noBalls: 0,
                dots: 0,
                bestW: 0,
                bestR: 0,
                catches: 0,
                runOuts: 0,
                stumpings: 0,
            };
            aggMap.set(pid, a);
        }
        return a;
    };
    for (const pid of playerIds)
        ensure(pid);
    for (const inn of inningsWithBalls) {
        const innBatters = new Set();
        const innOutBatters = new Set();
        const innRetiredHurtBatters = new Set();
        const innBowlers = new Map();
        const perOver = new Map();
        const overBowler = new Map();
        for (const ball of inn.balls) {
            innBatters.add(ball.strikerId);
            innBatters.add(ball.nonStrikerId);
            const batter = ensure(ball.strikerId);
            const bowler = ensure(ball.bowlerId);
            let bowInn = innBowlers.get(ball.bowlerId);
            if (!bowInn) {
                bowInn = { legalBalls: 0, runsConceded: 0, wickets: 0 };
                innBowlers.set(ball.bowlerId, bowInn);
            }
            const teamRuns = (0, cricket_1.teamRunsOf)(ball);
            const legal = (0, cricket_1.isLegalBall)(ball);
            // Official cricket scoring rule: Wides are NOT balls faced by the batter; No-balls ARE balls faced.
            if (ball.extraType !== 'WIDE') {
                batter.balls += 1;
            }
            if (legal) {
                bowler.legalBalls += 1;
                bowInn.legalBalls += 1;
                if (teamRuns === 0)
                    bowler.dots += 1;
            }
            if (ball.extraType === 'WIDE')
                bowler.wides += 1;
            if (ball.extraType === 'NO_BALL')
                bowler.noBalls += 1;
            batter.runs += ball.runsOffBat;
            if (ball.runsOffBat === 4)
                batter.fours += 1;
            if (ball.runsOffBat === 6)
                batter.sixes += 1;
            const conceded = ball.extraType === 'WIDE' || ball.extraType === 'NO_BALL' ? teamRuns : ball.runsOffBat;
            bowler.runsConceded += conceded;
            bowInn.runsConceded += conceded;
            const overKey = `${ball.overNumber}:${ball.bowlerId}`;
            const prevOver = perOver.get(overKey) ?? { legal: 0, conceded: 0 };
            perOver.set(overKey, {
                legal: prevOver.legal + (legal ? 1 : 0),
                conceded: prevOver.conceded + conceded,
            });
            overBowler.set(ball.overNumber, ball.bowlerId);
            if (ball.isWicket) {
                const dismissedId = ball.dismissedId || ball.strikerId;
                const targetBatter = ensure(dismissedId);
                targetBatter.dismissalType = ball.wicketType ?? null;
                targetBatter.dismissalText = dismissalLabel(ball, nameOf);
                if (ball.wicketType === 'RETIRED_HURT') {
                    innRetiredHurtBatters.add(dismissedId);
                    targetBatter.retiredHurt = true;
                }
                else if (!NON_DISMISSAL_WICKET_TYPES.has(ball.wicketType || '')) {
                    innOutBatters.add(dismissedId);
                    targetBatter.out = true;
                    if (ball.wicketType === 'RETIRED_OUT') {
                        targetBatter.retiredOut = true;
                    }
                }
                // Strict rule: run-outs, hit wickets & retirements NEVER credit bowler wickets
                if (ball.wicketType && exports.OFFICIAL_BOWLER_WICKETS.has(ball.wicketType)) {
                    bowler.wickets += 1;
                    bowInn.wickets += 1;
                }
                // Fielding credits
                if (ball.wicketType === 'CAUGHT' && ball.assistId) {
                    ensure(ball.assistId).catches += 1;
                }
                else if (ball.wicketType === 'CAUGHT_AND_BOWLED') {
                    ensure(ball.bowlerId).catches += 1;
                }
                else if (ball.wicketType === 'STUMPED' && ball.assistId) {
                    ensure(ball.assistId).stumpings += 1;
                }
                else if (ball.wicketType === 'RUN_OUT' && ball.assistId) {
                    ensure(ball.assistId).runOuts += 1;
                }
            }
        }
        for (const pid of innBatters) {
            const a = ensure(pid);
            a.battedInnings += 1;
            if (statusOverrideMap.get(pid) === 'RETIRED_HURT') {
                a.retiredHurt = true;
                a.out = false;
            }
            else if (statusOverrideMap.get(pid) === 'RETIRED_OUT') {
                a.retiredOut = true;
                a.out = true;
                a.dismissalType = a.dismissalType ?? 'RETIRED_OUT';
                a.dismissalText = a.dismissalText ?? 'retired out';
            }
        }
        for (const [overNo, bowlerId] of overBowler) {
            const ov = perOver.get(`${overNo}:${bowlerId}`);
            if (ov && ov.legal === 6 && ov.conceded === 0) {
                ensure(bowlerId).maidens += 1;
            }
        }
        for (const [bowlerId, bowInn] of innBowlers) {
            const a = ensure(bowlerId);
            a.bowledInnings += 1;
            if (bowInn.wickets > a.bestW ||
                (bowInn.wickets === a.bestW && (a.bowledInnings === 1 || bowInn.runsConceded < a.bestR))) {
                a.bestW = bowInn.wickets;
                a.bestR = bowInn.runsConceded;
            }
        }
    }
    const matchDate = match.matchDate ?? match.endedAt ?? match.startedAt ?? match.createdAt ?? new Date();
    const rows = [];
    for (const [playerId, a] of aggMap.entries()) {
        const opponentTeamId = a.teamId === match.teamAId ? match.teamBId : match.teamAId;
        const override = statusOverrideMap.get(playerId);
        const isAbsent = override === 'ABSENT' && a.battedInnings === 0 && a.bowledInnings === 0;
        const didNotBat = a.battedInnings === 0;
        const notOut = !isAbsent && a.battedInnings > 0 && (!a.out || a.retiredHurt);
        let result = 'NO_RESULT';
        if (match.status === 'COMPLETED') {
            if (!match.winnerId)
                result = 'TIED';
            else if (match.winnerId === a.teamId)
                result = 'WON';
            else
                result = 'LOST';
        }
        rows.push({
            matchId: match._id,
            playerId,
            teamId: a.teamId,
            opponentTeamId,
            seasonId: match.seasonId ?? null,
            tournamentId: match.tournamentId ?? null,
            matchDate,
            played: !isAbsent,
            didNotBat,
            absent: isAbsent,
            isPlayerOfMatch: match.playerOfMatchId === playerId,
            result,
            matchResultText: match.resultText ?? null,
            verificationVersion,
            computedAt: new Date(),
            batting: {
                innings: a.battedInnings,
                runs: a.runs,
                balls: a.balls,
                fours: a.fours,
                sixes: a.sixes,
                notOut,
                retiredHurt: a.retiredHurt,
                retiredOut: a.retiredOut,
                dismissalType: a.dismissalType,
                dismissalText: isAbsent
                    ? 'absent'
                    : a.battedInnings > 0
                        ? a.dismissalText ?? (notOut ? 'not out' : 'out')
                        : null,
                strikeRate: a.balls > 0 ? (0, cricket_1.round2)((a.runs * 100) / a.balls) : 0,
                fifty: a.runs >= 50 && a.runs < 100 ? 1 : 0,
                hundred: a.runs >= 100 ? 1 : 0,
            },
            bowling: {
                innings: a.bowledInnings,
                legalBalls: a.legalBalls,
                overs: (0, cricket_1.oversStr)(a.legalBalls),
                maidens: a.maidens,
                runsConceded: a.runsConceded,
                wickets: a.wickets,
                wides: a.wides,
                noBalls: a.noBalls,
                dots: a.dots,
                economy: a.legalBalls > 0 ? (0, cricket_1.round2)((a.runsConceded * 6) / a.legalBalls) : 0,
                bestFiguresWickets: a.bestW,
                bestFiguresRuns: a.bestR,
            },
            fielding: {
                catches: a.catches,
                runOuts: a.runOuts,
                stumpings: a.stumpings,
            },
        });
    }
    return { match, inningsWithBalls, rows };
}
function finalizeBreakdown(acc) {
    const dismissals = acc.inningsBatted - acc.notOuts;
    return {
        key: acc.key,
        seasonId: acc.seasonId ?? null,
        seasonName: acc.seasonName ?? null,
        year: acc.year ?? null,
        teamId: acc.teamId ?? null,
        teamName: acc.teamName ?? null,
        teamShortName: acc.teamShortName ?? null,
        tournamentId: acc.tournamentId ?? null,
        tournamentName: acc.tournamentName ?? null,
        matches: acc.matches,
        inningsBatted: acc.inningsBatted,
        runs: acc.runs,
        ballsFaced: acc.ballsFaced,
        fours: acc.fours,
        sixes: acc.sixes,
        highestScore: acc.highestScore,
        highestScoreNotOut: acc.highestScoreNotOut,
        notOuts: acc.notOuts,
        battingAverage: dismissals > 0 ? (0, cricket_1.round2)(acc.runs / dismissals) : null,
        strikeRate: acc.ballsFaced > 0 ? (0, cricket_1.round2)((acc.runs * 100) / acc.ballsFaced) : 0,
        fifties: acc.fifties,
        hundreds: acc.hundreds,
        inningsBowled: acc.inningsBowled,
        legalBalls: acc.legalBalls,
        overs: (0, cricket_1.oversStr)(acc.legalBalls),
        runsConceded: acc.runsConceded,
        wickets: acc.wickets,
        maidens: acc.maidens,
        bowlingAverage: acc.wickets > 0 ? (0, cricket_1.round2)(acc.runsConceded / acc.wickets) : null,
        economy: acc.legalBalls > 0 ? (0, cricket_1.round2)((acc.runsConceded * 6) / acc.legalBalls) : 0,
        bowlingStrikeRate: acc.wickets > 0 ? (0, cricket_1.round2)(acc.legalBalls / acc.wickets) : null,
        bestBowlingWickets: acc.bestBowlingWickets,
        bestBowlingRuns: acc.bestBowlingRuns,
        bestBowlingDisplay: acc.inningsBowled > 0 ? `${acc.bestBowlingWickets}/${acc.bestBowlingRuns}` : '0/0',
        catches: acc.catches,
        runOuts: acc.runOuts,
        stumpings: acc.stumpings,
        playerOfMatchAwards: acc.playerOfMatchAwards,
    };
}
function accumulateMatchInto(acc, stat) {
    if (stat.played && !stat.absent)
        acc.matches += 1;
    if (stat.batting.innings > 0) {
        acc.inningsBatted += stat.batting.innings;
        acc.runs += stat.batting.runs;
        acc.ballsFaced += stat.batting.balls;
        acc.fours += stat.batting.fours;
        acc.sixes += stat.batting.sixes;
        if (stat.batting.notOut)
            acc.notOuts += 1;
        acc.fifties += stat.batting.fifty;
        acc.hundreds += stat.batting.hundred;
        if (stat.batting.runs > acc.highestScore ||
            (stat.batting.runs === acc.highestScore && stat.batting.notOut && !acc.highestScoreNotOut)) {
            acc.highestScore = stat.batting.runs;
            acc.highestScoreNotOut = stat.batting.notOut;
        }
    }
    if (stat.bowling.innings > 0) {
        acc.inningsBowled += stat.bowling.innings;
        acc.legalBalls += stat.bowling.legalBalls;
        acc.runsConceded += stat.bowling.runsConceded;
        acc.wickets += stat.bowling.wickets;
        acc.maidens += stat.bowling.maidens;
        const bw = stat.bowling.bestFiguresWickets;
        const br = stat.bowling.bestFiguresRuns;
        if (acc.inningsBowled === stat.bowling.innings ||
            bw > acc.bestBowlingWickets ||
            (bw === acc.bestBowlingWickets && br < acc.bestBowlingRuns)) {
            acc.bestBowlingWickets = bw;
            acc.bestBowlingRuns = br;
        }
    }
    acc.catches += stat.fielding.catches;
    acc.runOuts += stat.fielding.runOuts;
    acc.stumpings += stat.fielding.stumpings;
    if (stat.isPlayerOfMatch)
        acc.playerOfMatchAwards += 1;
}
function makeEmptyAcc(key) {
    return {
        key,
        matches: 0,
        inningsBatted: 0,
        runs: 0,
        ballsFaced: 0,
        fours: 0,
        sixes: 0,
        highestScore: 0,
        highestScoreNotOut: false,
        notOuts: 0,
        fifties: 0,
        hundreds: 0,
        inningsBowled: 0,
        legalBalls: 0,
        runsConceded: 0,
        wickets: 0,
        maidens: 0,
        bestBowlingWickets: 0,
        bestBowlingRuns: 0,
        catches: 0,
        runOuts: 0,
        stumpings: 0,
        playerOfMatchAwards: 0,
    };
}
async function rebuildCareerStatsForPlayers(playerIds, session = null) {
    const uniqueIds = [...new Set(playerIds.filter(Boolean))];
    if (uniqueIds.length === 0)
        return;
    const verifiedMatches = await db_1.Match.find({ scorecardStatus: 'VERIFIED' })
        .select({ _id: 1 })
        .session(session)
        .lean();
    const verifiedMatchIds = verifiedMatches.map((m) => m._id);
    // MongoDB replica-set transactions disallow concurrent operations sharing one session
    const seasons = await db_1.Season.find({}).session(session).lean();
    const teams = await db_1.Team.find({}).session(session).lean();
    const tournaments = await db_1.Tournament.find({}).session(session).lean();
    const seasonMap = new Map(seasons.map((s) => [s._id, s]));
    const teamMap = new Map(teams.map((t) => [t._id, t]));
    const tournamentMap = new Map(tournaments.map((t) => [t._id, t]));
    const allMatchStats = verifiedMatchIds.length > 0
        ? await db_1.PlayerMatchStat.find({
            playerId: { $in: uniqueIds },
            matchId: { $in: verifiedMatchIds },
        })
            .sort({ matchDate: 1 })
            .session(session)
            .lean()
        : [];
    const byPlayer = new Map();
    for (const st of allMatchStats) {
        const arr = byPlayer.get(st.playerId) ?? [];
        arr.push(st);
        byPlayer.set(st.playerId, arr);
    }
    for (const playerId of uniqueIds) {
        const statsList = byPlayer.get(playerId) ?? [];
        const overall = makeEmptyAcc('OVERALL');
        const seasonBuckets = new Map();
        const teamBuckets = new Map();
        const tournamentBuckets = new Map();
        const distinctSeasons = new Set();
        const distinctTeams = new Set();
        const distinctTournaments = new Set();
        for (const st of statsList) {
            accumulateMatchInto(overall, st);
            if (st.seasonId)
                distinctSeasons.add(st.seasonId);
            distinctTeams.add(st.teamId);
            if (st.tournamentId)
                distinctTournaments.add(st.tournamentId);
            const sObj = st.seasonId ? seasonMap.get(st.seasonId) : null;
            const tmObj = teamMap.get(st.teamId);
            const tourObj = st.tournamentId ? tournamentMap.get(st.tournamentId) : null;
            // Season-wise (grouped by season + team to clearly reflect season team transitions)
            const sKey = `${st.seasonId ?? 'UNASSIGNED'}::${st.teamId}`;
            let sAcc = seasonBuckets.get(sKey);
            if (!sAcc) {
                sAcc = {
                    ...makeEmptyAcc(sKey),
                    seasonId: st.seasonId ?? null,
                    seasonName: sObj?.name ?? 'General Season',
                    year: sObj?.year ?? new Date(st.matchDate).getFullYear(),
                    teamId: st.teamId,
                    teamName: tmObj?.name ?? 'Unknown Team',
                    teamShortName: tmObj?.shortName ?? 'UNK',
                };
                seasonBuckets.set(sKey, sAcc);
            }
            accumulateMatchInto(sAcc, st);
            // Team-wise
            let tmAcc = teamBuckets.get(st.teamId);
            if (!tmAcc) {
                tmAcc = {
                    ...makeEmptyAcc(st.teamId),
                    teamId: st.teamId,
                    teamName: tmObj?.name ?? 'Unknown Team',
                    teamShortName: tmObj?.shortName ?? 'UNK',
                };
                teamBuckets.set(st.teamId, tmAcc);
            }
            accumulateMatchInto(tmAcc, st);
            // Tournament-wise
            const tKey = st.tournamentId ?? 'GENERAL';
            let trAcc = tournamentBuckets.get(tKey);
            if (!trAcc) {
                trAcc = {
                    ...makeEmptyAcc(tKey),
                    tournamentId: st.tournamentId ?? null,
                    tournamentName: tourObj?.name ?? 'Standalone / Friendly',
                };
                tournamentBuckets.set(tKey, trAcc);
            }
            accumulateMatchInto(trAcc, st);
        }
        const fin = finalizeBreakdown(overall);
        const seasonRows = [...seasonBuckets.values()]
            .map(finalizeBreakdown)
            .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
        const teamRows = [...teamBuckets.values()].map(finalizeBreakdown);
        const tournamentRows = [...tournamentBuckets.values()].map(finalizeBreakdown);
        await db_1.PlayerCareerStat.findOneAndUpdate({ playerId }, {
            $set: {
                playerId,
                matches: fin.matches,
                inningsBatted: fin.inningsBatted,
                runs: fin.runs,
                ballsFaced: fin.ballsFaced,
                fours: fin.fours,
                sixes: fin.sixes,
                highestScore: fin.highestScore,
                highestScoreNotOut: fin.highestScoreNotOut,
                notOuts: fin.notOuts,
                battingAverage: fin.battingAverage,
                strikeRate: fin.strikeRate,
                fifties: fin.fifties,
                hundreds: fin.hundreds,
                inningsBowled: fin.inningsBowled,
                legalBallsBowled: fin.legalBalls,
                oversBowled: fin.overs,
                runsConceded: fin.runsConceded,
                wickets: fin.wickets,
                maidens: fin.maidens,
                bowlingAverage: fin.bowlingAverage,
                economy: fin.economy,
                bowlingStrikeRate: fin.bowlingStrikeRate,
                bestBowlingWickets: fin.bestBowlingWickets,
                bestBowlingRuns: fin.bestBowlingRuns,
                bestBowlingDisplay: fin.bestBowlingDisplay,
                catches: fin.catches,
                runOuts: fin.runOuts,
                stumpings: fin.stumpings,
                playerOfMatchAwards: fin.playerOfMatchAwards,
                seasonsCount: distinctSeasons.size,
                teamsCount: distinctTeams.size,
                tournamentsCount: distinctTournaments.size,
                seasonBreakdown: seasonRows,
                teamBreakdown: teamRows,
                tournamentBreakdown: tournamentRows,
                lastUpdatedAt: new Date(),
            },
        }, { upsert: true, new: true, session: session ?? undefined });
    }
}
async function finalizeMatchScorecard(matchId, actor) {
    const match = await db_1.Match.findById(matchId);
    if (!match)
        throw new Error('Match not found');
    if (match.status !== 'COMPLETED') {
        throw new Error('Only completed matches can be finalized for official statistics');
    }
    const prevStatus = match.scorecardStatus;
    match.scorecardStatus = 'FINALIZED';
    match.finalizedAt = match.finalizedAt ?? new Date();
    match.finalizedBy = match.finalizedBy ?? (actor.name || actor.id || 'Admin');
    await match.save();
    await writeAuditLog({
        action: 'FINALIZE_MATCH',
        actor,
        matchId,
        beforeSummary: { scorecardStatus: prevStatus },
        afterSummary: { scorecardStatus: 'FINALIZED' },
    });
    return match.toObject();
}
async function verifyMatchAndSyncStats(matchId, actor, options = {}) {
    return (0, db_1.withMongoTransaction)(async (session) => {
        const match = await db_1.Match.findById(matchId).session(session);
        if (!match)
            throw new Error('Match not found');
        if (match.status !== 'COMPLETED') {
            throw new Error('Match must be COMPLETED before scorecard verification');
        }
        const existingStats = await db_1.PlayerMatchStat.find({ matchId }).select({ playerId: 1 }).session(session).lean();
        const existingPlayerIds = existingStats.map((s) => s.playerId);
        const nextVersion = (match.statsProcessedVersion ?? 0) + 1;
        const { inningsWithBalls, rows } = await computeMatchPlayerStats(matchId, nextVersion, session);
        const snapshotHash = computeMatchSnapshotHash(match.toObject(), inningsWithBalls);
        if (match.scorecardStatus === 'VERIFIED' && match.statsSnapshotHash === snapshotHash && !options.force) {
            return {
                idempotent: true,
                alreadyVerified: true,
                matchId,
                statsVersion: match.statsProcessedVersion,
                playersUpdated: existingPlayerIds.length,
            };
        }
        // Replace per-match rows atomically & idempotently
        await db_1.PlayerMatchStat.deleteMany({ matchId }).session(session);
        if (rows.length > 0) {
            await db_1.PlayerMatchStat.insertMany(rows, session ? { session } : {});
        }
        // Sync Player of the Match persisted award
        if (match.playerOfMatchId) {
            const pomTeam = rows.find((r) => r.playerId === match.playerOfMatchId)?.teamId ?? null;
            await db_1.Award.findOneAndUpdate({ scope: 'MATCH', matchId, awardType: 'PLAYER_OF_MATCH' }, {
                $set: {
                    scope: 'MATCH',
                    matchId,
                    awardType: 'PLAYER_OF_MATCH',
                    tournamentId: match.tournamentId ?? null,
                    seasonId: match.seasonId ?? null,
                    playerId: match.playerOfMatchId,
                    teamId: pomTeam,
                    awardedBy: actor.name || actor.id || 'Admin',
                    awardedAt: new Date(),
                },
            }, { upsert: true, new: true, session: session ?? undefined });
        }
        else {
            await db_1.Award.deleteOne({ scope: 'MATCH', matchId, awardType: 'PLAYER_OF_MATCH' }).session(session);
        }
        const now = new Date();
        match.scorecardStatus = 'VERIFIED';
        match.finalizedAt = match.finalizedAt ?? now;
        match.finalizedBy = match.finalizedBy ?? (actor.name || actor.id || 'Admin');
        match.verifiedAt = now;
        match.verifiedBy = actor.name || actor.id || 'Admin';
        match.statsProcessedVersion = nextVersion;
        match.statsSnapshotHash = snapshotHash;
        await match.save({ session: session ?? undefined });
        const affectedPlayers = [...new Set([...existingPlayerIds, ...rows.map((r) => r.playerId)])];
        await rebuildCareerStatsForPlayers(affectedPlayers, session);
        await writeAuditLog({
            action: options.action ?? 'VERIFY_MATCH',
            actor,
            matchId,
            reason: options.reason ?? null,
            beforeSummary: options.beforeSummary ?? {
                scorecardStatus: match.scorecardStatus,
                playersCount: existingPlayerIds.length,
            },
            afterSummary: {
                scorecardStatus: 'VERIFIED',
                statsProcessedVersion: nextVersion,
                playersCount: rows.length,
                snapshotHash,
            },
        }, session);
        return {
            idempotent: false,
            alreadyVerified: false,
            matchId,
            statsVersion: nextVersion,
            playersUpdated: affectedPlayers.length,
        };
    });
}
async function correctMatchAndRecalculate(matchId, updates, actor, reason) {
    const existing = await db_1.Match.findById(matchId).lean();
    if (!existing)
        throw new Error('Match not found');
    const beforeSummary = {
        seasonId: existing.seasonId,
        tournamentId: existing.tournamentId,
        playerOfMatchId: existing.playerOfMatchId,
        winnerId: existing.winnerId,
        resultText: existing.resultText,
        scorecardStatus: existing.scorecardStatus,
        playerStatuses: existing.playerStatuses,
    };
    await (0, db_1.withMongoTransaction)(async (session) => {
        const match = await db_1.Match.findById(matchId).session(session);
        if (!match)
            throw new Error('Match not found');
        if (updates.seasonId !== undefined)
            match.seasonId = updates.seasonId;
        if (updates.tournamentId !== undefined)
            match.tournamentId = updates.tournamentId;
        if (updates.matchDate !== undefined)
            match.matchDate = updates.matchDate;
        if (updates.playerOfMatchId !== undefined)
            match.playerOfMatchId = updates.playerOfMatchId;
        if (updates.resultText !== undefined)
            match.resultText = updates.resultText;
        if (updates.winnerId !== undefined)
            match.winnerId = updates.winnerId;
        if (Array.isArray(updates.playingXIA))
            match.playingXIA = updates.playingXIA;
        if (Array.isArray(updates.playingXIB))
            match.playingXIB = updates.playingXIB;
        if (Array.isArray(updates.playerStatuses))
            match.playerStatuses = updates.playerStatuses;
        match.scorecardStatus = 'CORRECTION_REQUIRED';
        if (Array.isArray(updates.ballEdits)) {
            for (const edit of updates.ballEdits) {
                const patch = {};
                if (edit.strikerId !== undefined)
                    patch.strikerId = edit.strikerId;
                if (edit.nonStrikerId !== undefined)
                    patch.nonStrikerId = edit.nonStrikerId;
                if (edit.bowlerId !== undefined)
                    patch.bowlerId = edit.bowlerId;
                if (edit.runsOffBat !== undefined)
                    patch.runsOffBat = edit.runsOffBat;
                if (edit.extraType !== undefined) {
                    patch.extraType = edit.extraType;
                    patch.isLegal = edit.extraType !== 'WIDE' && edit.extraType !== 'NO_BALL';
                }
                if (edit.extraRuns !== undefined)
                    patch.extraRuns = edit.extraRuns;
                if (edit.isWicket !== undefined)
                    patch.isWicket = edit.isWicket;
                if (edit.wicketType !== undefined)
                    patch.wicketType = edit.wicketType;
                if (edit.dismissedId !== undefined)
                    patch.dismissedId = edit.dismissedId;
                if (edit.assistId !== undefined)
                    patch.assistId = edit.assistId;
                if (Object.keys(patch).length > 0) {
                    await db_1.Ball.updateOne({ _id: edit.ballId }, { $set: patch }).session(session);
                }
            }
        }
        await match.save({ session: session ?? undefined });
    });
    if (updates.reverify !== false && existing.status === 'COMPLETED') {
        return verifyMatchAndSyncStats(matchId, actor, {
            force: true,
            action: 'CORRECT_MATCH',
            reason,
            beforeSummary,
        });
    }
    // If left unverified / marked CORRECTION_REQUIRED, strip its verified contribution and rebuild affected players
    const priorStats = await db_1.PlayerMatchStat.find({ matchId }).select({ playerId: 1 }).lean();
    await rebuildCareerStatsForPlayers(priorStats.map((s) => s.playerId));
    await writeAuditLog({
        action: 'CORRECT_MATCH',
        actor,
        matchId,
        reason,
        beforeSummary,
        afterSummary: { scorecardStatus: 'CORRECTION_REQUIRED' },
    });
    return { idempotent: false, matchId, scorecardStatus: 'CORRECTION_REQUIRED' };
}
async function recalculateStats(targetPlayerId, actor, reason = 'Manual recalculation requested by admin') {
    return (0, db_1.withMongoTransaction)(async (session) => {
        const verifiedMatches = await db_1.Match.find({ status: 'COMPLETED', scorecardStatus: 'VERIFIED' })
            .sort({ matchDate: 1, createdAt: 1 })
            .session(session)
            .lean();
        const affected = new Set();
        if (targetPlayerId) {
            affected.add(targetPlayerId);
            const statMatches = await db_1.PlayerMatchStat.find({ playerId: targetPlayerId }).select({ matchId: 1 }).session(session).lean();
            for (const sm of statMatches) {
                const vm = verifiedMatches.find((m) => m._id === sm.matchId);
                if (vm) {
                    const { rows } = await computeMatchPlayerStats(vm._id, vm.statsProcessedVersion || 1, session);
                    const row = rows.find((r) => r.playerId === targetPlayerId);
                    if (row) {
                        await db_1.PlayerMatchStat.findOneAndUpdate({ matchId: vm._id, playerId: targetPlayerId }, { $set: row }, { upsert: true, session: session ?? undefined });
                    }
                }
            }
            await rebuildCareerStatsForPlayers([targetPlayerId], session);
        }
        else {
            for (const vm of verifiedMatches) {
                const { rows } = await computeMatchPlayerStats(vm._id, vm.statsProcessedVersion || 1, session);
                await db_1.PlayerMatchStat.deleteMany({ matchId: vm._id }).session(session);
                if (rows.length > 0) {
                    await db_1.PlayerMatchStat.insertMany(rows, session ? { session } : {});
                }
                for (const r of rows)
                    affected.add(r.playerId);
            }
            const allPlayers = await db_1.Player.find({ status: { $ne: 'MERGED' } }).select({ _id: 1 }).session(session).lean();
            for (const p of allPlayers)
                affected.add(p._id);
            await rebuildCareerStatsForPlayers([...affected], session);
        }
        await writeAuditLog({
            action: targetPlayerId ? 'RECALCULATE_PLAYER' : 'RECALCULATE_ALL',
            actor,
            playerId: targetPlayerId,
            reason,
            afterSummary: {
                playersRecalculated: affected.size,
                verifiedMatchesCount: verifiedMatches.length,
            },
        }, session);
        return {
            playersRecalculated: affected.size,
            verifiedMatchesCount: verifiedMatches.length,
        };
    });
}
async function mergePlayersAndRecalculate(sourcePlayerId, targetPlayerId, actor, reason = 'Duplicate profile merge after verification') {
    if (sourcePlayerId === targetPlayerId) {
        throw new Error('Source and target player cannot be the same');
    }
    return (0, db_1.withMongoTransaction)(async (session) => {
        const source = await db_1.Player.findById(sourcePlayerId).session(session);
        const target = await db_1.Player.findById(targetPlayerId).session(session);
        if (!source)
            throw new Error('Source player not found');
        if (!target)
            throw new Error('Target player not found');
        if (source.status === 'MERGED')
            throw new Error('Source player is already merged');
        if (target.status === 'MERGED')
            throw new Error('Cannot merge into an already merged profile');
        const beforeSummary = {
            sourcePlayerCode: source.playerCode,
            sourceName: source.name,
            targetPlayerCode: target.playerCode,
            targetName: target.name,
        };
        // 1. Reassign balls & innings references sequentially on transaction session
        for (const field of ['strikerId', 'nonStrikerId', 'bowlerId', 'dismissedId', 'assistId']) {
            await db_1.Ball.updateMany({ [field]: sourcePlayerId }, { $set: { [field]: targetPlayerId } }).session(session);
        }
        for (const field of ['currentStrikerId', 'currentNonStrikerId', 'currentBowlerId']) {
            await db_1.Innings.updateMany({ [field]: sourcePlayerId }, { $set: { [field]: targetPlayerId } }).session(session);
        }
        // 2. Reassign matches playingXI, playerStatuses & POM
        const impactedMatches = await db_1.Match.find({
            $or: [
                { playingXIA: sourcePlayerId },
                { playingXIB: sourcePlayerId },
                { 'playerStatuses.playerId': sourcePlayerId },
                { playerOfMatchId: sourcePlayerId },
            ],
        }).session(session);
        const impactedMatchIds = new Set();
        for (const m of impactedMatches) {
            impactedMatchIds.add(m._id);
            m.playingXIA = [...new Set((m.playingXIA ?? []).map((id) => (id === sourcePlayerId ? targetPlayerId : id)))];
            m.playingXIB = [...new Set((m.playingXIB ?? []).map((id) => (id === sourcePlayerId ? targetPlayerId : id)))];
            for (const ps of m.playerStatuses ?? []) {
                if (ps.playerId === sourcePlayerId)
                    ps.playerId = targetPlayerId;
            }
            if (m.playerOfMatchId === sourcePlayerId)
                m.playerOfMatchId = targetPlayerId;
            await m.save({ session: session ?? undefined });
        }
        // Also include matches referenced by PlayerMatchStat rows of source
        const sourceMatchStats = await db_1.PlayerMatchStat.find({ playerId: sourcePlayerId }).select({ matchId: 1 }).session(session).lean();
        for (const sm of sourceMatchStats)
            impactedMatchIds.add(sm.matchId);
        // 3. Reassign Awards
        await db_1.Award.updateMany({ playerId: sourcePlayerId }, { $set: { playerId: targetPlayerId } }).session(session);
        // 4. Preserve non-conflicting season TeamMemberships on target
        const sourceMemberships = await db_1.TeamMembership.find({ playerId: sourcePlayerId }).session(session);
        const targetMemberships = await db_1.TeamMembership.find({ playerId: targetPlayerId }).session(session);
        const targetSeasons = new Set(targetMemberships.map((m) => m.seasonId));
        for (const sm of sourceMemberships) {
            if (!targetSeasons.has(sm.seasonId)) {
                sm.playerId = targetPlayerId;
                await sm.save({ session: session ?? undefined });
                targetSeasons.add(sm.seasonId);
            }
            else {
                await db_1.TeamMembership.deleteOne({ _id: sm._id }).session(session);
            }
        }
        // 5. Preserve claimed link if source had userId and target didn't (rare admin merge case)
        if (!target.teamId && source.teamId)
            target.teamId = source.teamId;
        if (!target.avatarUrl && source.avatarUrl)
            target.avatarUrl = source.avatarUrl;
        await target.save({ session: session ?? undefined });
        // 6. Rebuild stats for all impacted verified matches & remove source stats
        await db_1.PlayerMatchStat.deleteMany({ playerId: sourcePlayerId }).session(session);
        for (const mid of impactedMatchIds) {
            const mDoc = await db_1.Match.findById(mid).session(session).lean();
            if (mDoc && mDoc.status === 'COMPLETED' && mDoc.scorecardStatus === 'VERIFIED') {
                const { rows } = await computeMatchPlayerStats(mid, mDoc.statsProcessedVersion || 1, session);
                await db_1.PlayerMatchStat.deleteMany({ matchId: mid }).session(session);
                if (rows.length > 0) {
                    await db_1.PlayerMatchStat.insertMany(rows, session ? { session } : {});
                }
            }
        }
        await db_1.PlayerCareerStat.deleteOne({ playerId: sourcePlayerId }).session(session);
        source.status = 'MERGED';
        source.mergedIntoPlayerId = targetPlayerId;
        source.teamId = null;
        source.userId = null;
        await source.save({ session: session ?? undefined });
        await rebuildCareerStatsForPlayers([targetPlayerId], session);
        await writeAuditLog({
            action: 'MERGE_PLAYERS',
            actor,
            playerId: targetPlayerId,
            sourcePlayerId,
            targetPlayerId,
            reason,
            beforeSummary,
            afterSummary: {
                mergedInto: target.playerCode,
                impactedMatches: impactedMatchIds.size,
            },
        }, session);
        return {
            sourcePlayerId,
            targetPlayerId,
            targetPlayerCode: target.playerCode,
            impactedMatches: impactedMatchIds.size,
        };
    });
}
