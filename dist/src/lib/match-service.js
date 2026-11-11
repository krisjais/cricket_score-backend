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
exports.isAllOut = exports.maxWicketsFor = exports.teamLite = exports.buildMatchPayload = exports.MatchError = void 0;
exports.emitMatchUpdate = emitMatchUpdate;
exports.currentInningsState = currentInningsState;
exports.setToss = setToss;
exports.startMatch = startMatch;
exports.startInnings2 = startInnings2;
exports.recordBall = recordBall;
exports.undoLastBall = undoLastBall;
exports.applyAction = applyAction;
/**
 * Match service — all admin scoring operations with validation.
 * Every mutation re-syncs the match state machine and broadcasts fresh
 * payloads over Socket.IO so audience scoreboards update in real time.
 */
const db_1 = require("./db");
const cricket_1 = require("./cricket");
Object.defineProperty(exports, "isAllOut", { enumerable: true, get: function () { return cricket_1.isAllOut; } });
Object.defineProperty(exports, "maxWicketsFor", { enumerable: true, get: function () { return cricket_1.maxWicketsFor; } });
const match_state_1 = require("./match-state");
Object.defineProperty(exports, "buildMatchPayload", { enumerable: true, get: function () { return match_state_1.buildMatchPayload; } });
Object.defineProperty(exports, "teamLite", { enumerable: true, get: function () { return match_state_1.teamLite; } });
const broadcast_1 = require("./broadcast");
async function emitMatchUpdate(matchId) {
    const payload = await (0, match_state_1.buildMatchPayload)(matchId);
    await (0, broadcast_1.emitToRoom)(`match:${matchId}`, 'match:update', payload);
    const summaries = await (0, match_state_1.buildMatchSummaries)();
    await (0, broadcast_1.emitToRoom)('matches', 'matches:update', summaries);
}
async function loadMatchWithInnings(matchId) {
    return db_1.db.match.findUnique({
        where: { id: matchId },
        include: { innings: { include: { balls: { orderBy: { sequence: 'asc' } } } } },
    });
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
    name: p.name,
    jerseyNumber: p.jerseyNumber,
    role: p.role,
});
/** Derived live state of the innings that is currently being scored. */
function currentInningsState(innings, battingPlayers, bowlingPlayers, totalOvers) {
    const balls = innings.balls.map(toBallData);
    const stats = (0, cricket_1.computeInnings)({
        inningsId: innings.id,
        number: innings.number,
        battingTeamId: innings.battingTeamId,
        bowlingTeamId: innings.bowlingTeamId,
        status: innings.status,
        currentStrikerId: innings.currentStrikerId,
        currentNonStrikerId: innings.currentNonStrikerId,
        currentBowlerId: innings.currentBowlerId,
    }, balls, battingPlayers, bowlingPlayers, totalOvers);
    return { balls, stats, live: stats.live };
}
class MatchError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
exports.MatchError = MatchError;
async function requireMatch(matchId) {
    const match = await loadMatchWithInnings(matchId);
    if (!match)
        throw new MatchError('Match not found', 404);
    return match;
}
async function requireSquads(match) {
    const { teamA, teamB } = await (0, match_state_1.loadSquads)(match);
    if (!teamA || !teamB)
        throw new MatchError('Match teams not found', 404);
    return { teamA, teamB };
}
async function liveInningsOf(match) {
    const innings = match.innings.find((i) => i.number === match.currentInnings);
    if (!innings)
        throw new MatchError('No innings in progress');
    if (innings.status !== 'IN_PROGRESS')
        throw new MatchError('This innings is already over');
    const { teamA, teamB } = await requireSquads(match);
    const battingTeam = innings.battingTeamId === teamA.id ? teamA : teamB;
    const bowlingTeam = innings.bowlingTeamId === teamA.id ? teamA : teamB;
    const { balls, stats, live } = currentInningsState(innings, battingTeam.players, bowlingTeam.players, match.totalOvers);
    if (!live)
        throw new MatchError('Innings is not live');
    return { innings: innings, battingTeam, bowlingTeam, balls, stats, live, teamA, teamB };
}
// ---------------------------------------------------------------------------
// Toss
// ---------------------------------------------------------------------------
async function setToss(matchId, input) {
    const match = await requireMatch(matchId);
    if (!['SCHEDULED', 'TOSS_DONE'].includes(match.status))
        throw new MatchError('Toss can only be set before the match starts');
    const { teamA, teamB } = await requireSquads(match);
    const tossWinnerId = input.tossWinnerId;
    if (tossWinnerId !== teamA.id && tossWinnerId !== teamB.id)
        throw new MatchError('Toss winner must be one of the playing teams');
    const decision = input.decision === 'BAT' || input.decision === 'BOWL' ? input.decision : null;
    if (!decision)
        throw new MatchError('Toss decision must be BAT or BOWL');
    const battingFirstId = decision === 'BAT' ? tossWinnerId : tossWinnerId === teamA.id ? teamB.id : teamA.id;
    await db_1.db.match.update({
        where: { id: matchId },
        data: { status: 'TOSS_DONE', tossWinnerId, tossDecision: decision, battingFirstId },
    });
    await emitMatchUpdate(matchId);
    return (await (0, match_state_1.buildMatchPayload)(matchId)).match;
}
// ---------------------------------------------------------------------------
// Start match (innings 1)
// ---------------------------------------------------------------------------
async function startMatch(matchId, input) {
    const match = await requireMatch(matchId);
    if (match.status !== 'TOSS_DONE')
        throw new MatchError('Set the toss result before starting the match');
    if (!match.battingFirstId)
        throw new MatchError('Toss result is incomplete');
    const { teamA, teamB } = await requireSquads(match);
    const battingTeam = match.battingFirstId === teamA.id ? teamA : teamB;
    const bowlingTeam = match.battingFirstId === teamA.id ? teamB : teamA;
    const { strikerId, nonStrikerId, bowlerId } = input;
    if (!strikerId || !nonStrikerId || !bowlerId)
        throw new MatchError('Two openers and the opening bowler are required');
    if (strikerId === nonStrikerId)
        throw new MatchError('Openers must be different players');
    const batIds = new Set(battingTeam.players.map((p) => p.id));
    const bowlIds = new Set(bowlingTeam.players.map((p) => p.id));
    if (!batIds.has(strikerId) || !batIds.has(nonStrikerId))
        throw new MatchError('Openers must belong to the batting team');
    if (!bowlIds.has(bowlerId))
        throw new MatchError('Opening bowler must belong to the bowling team');
    if (battingTeam.players.length < 2)
        throw new MatchError('Batting team needs at least 2 players');
    if (bowlingTeam.players.length < 1)
        throw new MatchError('Bowling team needs at least 1 player');
    await db_1.db.innings.create({
        data: {
            matchId,
            number: 1,
            battingTeamId: battingTeam.id,
            bowlingTeamId: bowlingTeam.id,
            status: 'IN_PROGRESS',
            currentStrikerId: strikerId,
            currentNonStrikerId: nonStrikerId,
            currentBowlerId: bowlerId,
        },
    });
    await db_1.db.match.update({
        where: { id: matchId },
        data: { status: 'LIVE', currentInnings: 1, startedAt: new Date() },
    });
    await emitMatchUpdate(matchId);
}
// ---------------------------------------------------------------------------
// Start innings 2
// ---------------------------------------------------------------------------
async function startInnings2(matchId, input) {
    const match = await requireMatch(matchId);
    if (match.status !== 'INNINGS_BREAK')
        throw new MatchError('Second innings can only start after the first innings ends');
    const innings1 = match.innings.find((i) => i.number === 1);
    if (!innings1)
        throw new MatchError('First innings missing');
    const { teamA, teamB } = await requireSquads(match);
    const battingTeam = innings1.bowlingTeamId === teamA.id ? teamA : teamB;
    const bowlingTeam = innings1.battingTeamId === teamA.id ? teamA : teamB;
    const { strikerId, nonStrikerId, bowlerId } = input;
    if (!strikerId || !nonStrikerId || !bowlerId)
        throw new MatchError('Two openers and the opening bowler are required');
    if (strikerId === nonStrikerId)
        throw new MatchError('Openers must be different players');
    const batIds = new Set(battingTeam.players.map((p) => p.id));
    const bowlIds = new Set(bowlingTeam.players.map((p) => p.id));
    if (!batIds.has(strikerId) || !batIds.has(nonStrikerId))
        throw new MatchError('Openers must belong to the batting team');
    if (!bowlIds.has(bowlerId))
        throw new MatchError('Opening bowler must belong to the bowling team');
    await db_1.db.innings.create({
        data: {
            matchId,
            number: 2,
            battingTeamId: battingTeam.id,
            bowlingTeamId: bowlingTeam.id,
            status: 'IN_PROGRESS',
            currentStrikerId: strikerId,
            currentNonStrikerId: nonStrikerId,
            currentBowlerId: bowlerId,
        },
    });
    await db_1.db.match.update({
        where: { id: matchId },
        data: { status: 'LIVE', currentInnings: 2 },
    });
    await emitMatchUpdate(matchId);
}
// ---------------------------------------------------------------------------
// Record a delivery
// ---------------------------------------------------------------------------
async function recordBall(matchId, input) {
    const match = await requireMatch(matchId);
    if (match.status !== 'LIVE')
        throw new MatchError('Scoring is only allowed while the match is LIVE');
    const ctx = await liveInningsOf(match);
    const validationError = (0, cricket_1.validateBallInput)(input);
    if (validationError)
        throw new MatchError(validationError);
    if (ctx.live.overComplete)
        throw new MatchError('Over complete — select the bowler for the next over first');
    if (ctx.live.needsNewBatsman)
        throw new MatchError('Select the new batsman first');
    // effective crease state: innings fields (authoritative incl. new-batsman selection)
    const strikerId = ctx.innings.currentStrikerId ?? ctx.live.strikerId;
    const nonStrikerId = ctx.innings.currentNonStrikerId ?? ctx.live.nonStrikerId;
    const bowlerId = ctx.innings.currentBowlerId ?? ctx.live.bowlerId;
    if (!strikerId || !nonStrikerId || !bowlerId)
        throw new MatchError('Batsmen or bowler are not set');
    // wicket specifics
    let dismissedId = null;
    let assistId = null;
    if (input.wicketType) {
        if (input.wicketType === 'RUN_OUT') {
            dismissedId = input.dismissedId ?? strikerId;
            if (dismissedId !== strikerId && dismissedId !== nonStrikerId)
                throw new MatchError('Dismissed player must be one of the two batsmen at the crease');
        }
        else {
            dismissedId = strikerId; // bowled/caught/lbw/stumped/hit-wicket dismiss the striker
        }
        if (['CAUGHT', 'RUN_OUT', 'STUMPED'].includes(input.wicketType)) {
            assistId = input.assistId ?? null;
            if (assistId) {
                const bowlIds = new Set(ctx.bowlingTeam.players.map((p) => p.id));
                if (!bowlIds.has(assistId))
                    throw new MatchError('Fielder must belong to the bowling team');
            }
        }
        const dismissedIdsSoFar = new Set();
        for (const b of ctx.stats.batting)
            if (b.out)
                dismissedIdsSoFar.add(b.id);
        if (dismissedIdsSoFar.has(dismissedId))
            throw new MatchError('This player is already out');
    }
    const legalBallsBefore = ctx.stats.legalBalls;
    const overNumber = Math.floor(legalBallsBefore / 6);
    const sequence = (ctx.innings.balls[ctx.innings.balls.length - 1]?.sequence ?? 0) + 1;
    const isLegal = input.extraType !== 'WIDE' && input.extraType !== 'NO_BALL';
    const ball = await db_1.db.ball.create({
        data: {
            inningsId: ctx.innings.id,
            sequence,
            overNumber,
            strikerId,
            nonStrikerId,
            bowlerId,
            runsOffBat: input.runsOffBat ?? 0,
            extraType: input.extraType,
            extraRuns: input.extraRuns ?? 0,
            isLegal,
            isWicket: !!input.wicketType,
            wicketType: input.wicketType ?? null,
            dismissedId,
            assistId,
        },
    });
    // ---- advance innings state (mirrors engine rules) ----
    let newStriker = strikerId;
    let newNonStriker = nonStrikerId;
    if (input.extraType === 'WIDE') {
        if ((input.extraRuns - 1) % 2 === 1)
            [newStriker, newNonStriker] = [newNonStriker, newStriker];
    }
    else if (input.extraType === 'NO_BALL') {
        if ((input.runsOffBat + input.extraRuns - 1) % 2 === 1)
            [newStriker, newNonStriker] = [newNonStriker, newStriker];
    }
    else if (input.extraType === 'BYE' || input.extraType === 'LEG_BYE') {
        if ((input.extraRuns ?? 0) % 2 === 1)
            [newStriker, newNonStriker] = [newNonStriker, newStriker];
    }
    else {
        if ((input.runsOffBat ?? 0) % 2 === 1)
            [newStriker, newNonStriker] = [newNonStriker, newStriker];
    }
    const legalInThisOver = ctx.balls.filter((b) => b.overNumber === overNumber && b.isLegal).length + (isLegal ? 1 : 0);
    const overComplete = legalInThisOver >= 6;
    if (overComplete)
        [newStriker, newNonStriker] = [newNonStriker, newStriker];
    if (ball.isWicket && dismissedId) {
        if (dismissedId === newStriker)
            newStriker = '';
        else if (dismissedId === newNonStriker)
            newNonStriker = '';
    }
    await db_1.db.innings.update({
        where: { id: ctx.innings.id },
        data: {
            currentStrikerId: newStriker || null,
            currentNonStrikerId: newNonStriker || null,
            currentBowlerId: overComplete ? null : bowlerId,
        },
    });
    await syncAndEmit(matchId);
}
// ---------------------------------------------------------------------------
// Undo last delivery
// ---------------------------------------------------------------------------
async function undoLastBall(matchId) {
    const match = await requireMatch(matchId);
    if (!['LIVE', 'INNINGS_BREAK', 'COMPLETED'].includes(match.status))
        throw new MatchError('Undo is not available for this match state');
    const innings = match.innings.find((i) => i.number === match.currentInnings);
    if (!innings)
        throw new MatchError('No innings to undo');
    const last = [...innings.balls].sort((a, b) => b.sequence - a.sequence)[0];
    if (!last)
        throw new MatchError('Nothing to undo');
    await db_1.db.ball.delete({ where: { id: last.id } });
    // restore innings state to what it was BEFORE that delivery
    const reopen = innings.status === 'COMPLETED' || ['INNINGS_BREAK', 'COMPLETED'].includes(match.status);
    const inningsUpdate = {
        currentStrikerId: last.strikerId,
        currentNonStrikerId: last.nonStrikerId,
        currentBowlerId: last.bowlerId,
    };
    if (innings.status === 'COMPLETED')
        inningsUpdate.status = 'IN_PROGRESS';
    await db_1.db.innings.update({ where: { id: innings.id }, data: inningsUpdate });
    const matchUpdate = {};
    if (reopen) {
        matchUpdate.status = 'LIVE';
        matchUpdate.resultText = null;
        matchUpdate.winnerId = null;
        matchUpdate.endedAt = null;
        if (match.currentInnings === 1)
            matchUpdate.target = null;
    }
    if (Object.keys(matchUpdate).length > 0) {
        await db_1.db.match.update({ where: { id: matchId }, data: matchUpdate });
    }
    await syncAndEmit(matchId);
}
async function applyAction(matchId, action, input = {}) {
    const match = await requireMatch(matchId);
    switch (action) {
        case 'NEW_BATSMAN': {
            if (match.status !== 'LIVE')
                throw new MatchError('Match is not live');
            const ctx = await liveInningsOf(match);
            if (!ctx.live.needsNewBatsman)
                throw new MatchError('No batsman selection is pending');
            const pid = input.playerId;
            if (!pid)
                throw new MatchError('Select a player');
            const atCrease = new Set([ctx.live.strikerId, ctx.live.nonStrikerId].filter(Boolean));
            const batIds = new Set(ctx.battingTeam.players.map((p) => p.id));
            if (!batIds.has(pid))
                throw new MatchError('Player must belong to the batting team');
            if (atCrease.has(pid))
                throw new MatchError('Player is already at the crease');
            const card = ctx.stats.batting.find((b) => b.id === pid);
            if (card?.out)
                throw new MatchError('This player is already out');
            const field = ctx.live.needsNewBatsman === 'STRIKER' ? 'currentStrikerId' : 'currentNonStrikerId';
            await db_1.db.innings.update({ where: { id: ctx.innings.id }, data: { [field]: pid } });
            break;
        }
        case 'NEW_BOWLER': {
            if (match.status !== 'LIVE')
                throw new MatchError('Match is not live');
            const ctx = await liveInningsOf(match);
            const pid = input.playerId;
            if (!pid)
                throw new MatchError('Select a player');
            const bowlIds = new Set(ctx.bowlingTeam.players.map((p) => p.id));
            if (!bowlIds.has(pid))
                throw new MatchError('Player must belong to the bowling team');
            if (ctx.live.overComplete && ctx.live.lastOverBowlerId === pid)
                throw new MatchError('This bowler bowled the previous over');
            const maxOvers = (0, cricket_1.maxOversPerBowler)(match.totalOvers);
            const card = ctx.stats.bowling.find((b) => b.id === pid);
            const completeOvers = card ? Math.floor(card.legalBalls / 6) : 0;
            const partialBalls = card ? card.legalBalls % 6 : 0;
            if (partialBalls === 0 && completeOvers >= maxOvers)
                throw new MatchError(`${maxOvers}-over limit reached for this bowler`);
            await db_1.db.innings.update({ where: { id: ctx.innings.id }, data: { currentBowlerId: pid } });
            break;
        }
        case 'SWAP_STRIKE': {
            if (match.status !== 'LIVE')
                throw new MatchError('Match is not live');
            const ctx = await liveInningsOf(match);
            const s = ctx.innings.currentStrikerId ?? ctx.live.strikerId;
            const n = ctx.innings.currentNonStrikerId ?? ctx.live.nonStrikerId;
            if (!s || !n)
                throw new MatchError('Both batsmen must be set');
            await db_1.db.innings.update({
                where: { id: ctx.innings.id },
                data: { currentStrikerId: n, currentNonStrikerId: s },
            });
            break;
        }
        case 'PAUSE': {
            if (match.status !== 'LIVE')
                throw new MatchError('Match is not live');
            await db_1.db.match.update({ where: { id: matchId }, data: { status: 'PAUSED' } });
            break;
        }
        case 'RESUME': {
            if (match.status !== 'PAUSED')
                throw new MatchError('Match is not paused');
            await db_1.db.match.update({ where: { id: matchId }, data: { status: 'LIVE' } });
            break;
        }
        case 'END_INNINGS': {
            if (match.status !== 'LIVE')
                throw new MatchError('Match is not live');
            const ctx = await liveInningsOf(match);
            await db_1.db.innings.update({ where: { id: ctx.innings.id }, data: { status: 'COMPLETED' } });
            if (match.currentInnings === 1) {
                await db_1.db.match.update({
                    where: { id: matchId },
                    data: { status: 'INNINGS_BREAK', target: ctx.stats.runs + 1 },
                });
            }
            else {
                // innings 2 declared: finalize the match from current scores
                const { teamA, teamB } = await requireSquads(match);
                const inn1 = match.innings.find((i) => i.number === 1);
                const stats1 = (0, cricket_1.computeInnings)({
                    inningsId: inn1.id,
                    number: 1,
                    battingTeamId: inn1.battingTeamId,
                    bowlingTeamId: inn1.bowlingTeamId,
                    status: inn1.status,
                    currentStrikerId: inn1.currentStrikerId,
                    currentNonStrikerId: inn1.currentNonStrikerId,
                    currentBowlerId: inn1.currentBowlerId,
                }, inn1.balls.map(toBallData), (inn1.battingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), (inn1.bowlingTeamId === teamA.id ? teamA.players : teamB.players).map(playerLite), match.totalOvers);
                const battingTeam2 = ctx.battingTeam;
                const { text, winnerId } = (0, cricket_1.buildResultText)(stats1, ctx.stats, battingTeam2.players.length, (id) => (id === teamA.id ? teamA.name : teamB.name));
                await db_1.db.match.update({
                    where: { id: matchId },
                    data: { status: 'COMPLETED', resultText: text, winnerId, endedAt: new Date() },
                });
            }
            break;
        }
        case 'ABANDON': {
            if (['COMPLETED', 'ABANDONED'].includes(match.status))
                throw new MatchError('Match is already finished');
            await db_1.db.match.update({
                where: { id: matchId },
                data: { status: 'ABANDONED', resultText: 'Match abandoned', endedAt: new Date() },
            });
            break;
        }
        default:
            throw new MatchError('Unknown action');
    }
    await syncAndEmit(matchId);
}
/** Re-run the state machine and broadcast the fresh payload. */
async function syncAndEmit(matchId) {
    const { syncMatchState } = await Promise.resolve().then(() => __importStar(require('./match-state')));
    await syncMatchState(matchId);
    await emitMatchUpdate(matchId);
}
