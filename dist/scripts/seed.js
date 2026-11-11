"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Seed script: admin account + sample teams/players + one fully-scored
 * completed T20 match (driven through the REAL match-service functions so
 * all rules/rotations/results are guaranteed correct) + one scheduled match.
 *
 * Run: bun run scripts/seed.ts
 */
require("../src/lib/env");
const db_1 = require("../src/lib/db");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const match_service_1 = require("../src/lib/match-service");
const match_state_1 = require("../src/lib/match-state");
// deterministic PRNG for reproducible sample data
let seed = 42;
function rnd() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
}
function pick(arr) {
    return arr[Math.floor(rnd() * arr.length)];
}
const SQUAD_A = [
    ['Arjun Mehta', 'BATTER', 1],
    ['Rohan Sharma', 'BATTER', 2],
    ['Vikram Rao', 'WICKETKEEPER', 3],
    ['Surya Patel', 'BATTER', 4],
    ['Karan Singh', 'ALL_ROUNDER', 5],
    ['Dev Chauhan', 'ALL_ROUNDER', 6],
    ['Aditya Verma', 'BOWLER', 7],
    ['Nitin Joshi', 'BOWLER', 8],
    ['Farhan Ali', 'BOWLER', 9],
    ['Sameer Khan', 'BOWLER', 10],
    ['Rahul Dubey', 'ALL_ROUNDER', 11],
];
const SQUAD_B = [
    ['Aarav Nair', 'BATTER', 21],
    ['Ishaan Kulkarni', 'BATTER', 22],
    ['Manav Desai', 'WICKETKEEPER', 23],
    ['Kabir Malhotra', 'BATTER', 24],
    ['Rehan Pillai', 'ALL_ROUNDER', 25],
    ['Zaid Sheikh', 'ALL_ROUNDER', 26],
    ['Tarun Iyer', 'BOWLER', 27],
    ['Omkar Reddy', 'BOWLER', 28],
    ['Sahil Bansal', 'BOWLER', 29],
    ['Yash Gowda', 'BOWLER', 30],
    ['Nikhil Saxena', 'ALL_ROUNDER', 31],
];
async function main() {
    await (0, db_1.connectDB)();
    console.log('— Resetting data —');
    await db_1.db.ball.deleteMany();
    await db_1.db.innings.deleteMany();
    await db_1.db.match.deleteMany();
    await db_1.db.player.deleteMany();
    await db_1.db.team.deleteMany();
    await db_1.db.admin.deleteMany();
    console.log('— Creating admin (admin / admin123) —');
    await db_1.db.admin.create({
        data: { username: 'admin', passwordHash: await bcryptjs_1.default.hash('admin123', 10) },
    });
    console.log('— Creating teams & squads —');
    const teamA = await db_1.db.team.create({
        data: { name: 'Rising Stars CC', shortName: 'RSC', color: '#0e7490', captain: 'Arjun Mehta' },
    });
    const teamB = await db_1.db.team.create({
        data: { name: 'Royal Warriors', shortName: 'RW', color: '#b45309', captain: 'Aarav Nair' },
    });
    for (const [name, role, jersey] of SQUAD_A) {
        await db_1.db.player.create({ data: { name, role, jerseyNumber: jersey, teamId: teamA.id } });
    }
    for (const [name, role, jersey] of SQUAD_B) {
        await db_1.db.player.create({ data: { name, role, jerseyNumber: jersey, teamId: teamB.id } });
    }
    console.log('— Simulating a completed T20 through the real scoring service —');
    const match = await db_1.db.match.create({
        data: {
            teamAId: teamA.id,
            teamBId: teamB.id,
            format: 'T20',
            totalOvers: 20,
            venue: 'City Cricket Ground',
            status: 'SCHEDULED',
        },
    });
    const mid = match.id;
    // toss: A wins and bats
    await (0, match_service_1.setToss)(mid, { tossWinnerId: teamA.id, decision: 'BAT' });
    const payloadOf = async () => (await (0, match_state_1.buildMatchPayload)(mid));
    const load = async () => {
        const p = await payloadOf();
        if (!p.live)
            throw new Error('load() called while no innings is live');
        const batting = await db_1.db.player.findMany({ where: { teamId: p.live.battingTeamId } });
        const bowling = await db_1.db.player.findMany({ where: { teamId: p.live.bowlingTeamId } });
        return { p, batting, bowling };
    };
    const roleWeight = (role) => (role === 'BOWLER' ? 2 : role === 'ALL_ROUNDER' ? 1 : 0);
    const startInnings = async () => {
        const p = await payloadOf();
        const isSecond = p.match.status === 'INNINGS_BREAK';
        let battingTeamId;
        if (!isSecond) {
            battingTeamId = p.match.battingFirstId;
        }
        else {
            const inn1 = p.innings.find((i) => i.number === 1);
            battingTeamId = inn1.bowlingTeamId;
        }
        const bowlingTeamId = battingTeamId === p.match.teamA.id ? p.match.teamB.id : p.match.teamA.id;
        const batting = await db_1.db.player.findMany({ where: { teamId: battingTeamId } });
        const bowling = await db_1.db.player.findMany({ where: { teamId: bowlingTeamId } });
        const sortedBat = [...batting].sort((a, b) => roleWeight(a.role) - roleWeight(b.role) || (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99));
        const sortedBowl = [...bowling].sort((a, b) => roleWeight(b.role) - roleWeight(a.role));
        const striker = sortedBat[0];
        const nonStriker = sortedBat[1];
        const bowler = sortedBowl[0];
        if (p.match.status === 'TOSS_DONE') {
            await (0, match_service_1.startMatch)(mid, { strikerId: striker.id, nonStrikerId: nonStriker.id, bowlerId: bowler.id });
        }
        else {
            await (0, match_service_1.startInnings2)(mid, { strikerId: striker.id, nonStrikerId: nonStriker.id, bowlerId: bowler.id });
        }
    };
    // outcome model for a believable T20 innings
    function nextDelivery() {
        const r = rnd();
        if (r < 0.035)
            return { runsOffBat: 0, extraType: 'WIDE', extraRuns: 1 };
        if (r < 0.042)
            return { runsOffBat: 0, extraType: 'NO_BALL', extraRuns: 1 };
        if (r < 0.049)
            return { runsOffBat: 0, extraType: 'BYE', extraRuns: pick([1, 1, 2]) };
        if (r < 0.06)
            return { runsOffBat: 0, extraType: 'LEG_BYE', extraRuns: pick([1, 1, 2]) };
        if (r < 0.105) {
            const types = ['CAUGHT', 'CAUGHT', 'CAUGHT', 'BOWLED', 'BOWLED', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', 'CAUGHT_AND_BOWLED'];
            const wicketType = pick(types);
            return { runsOffBat: 0, extraType: null, extraRuns: 0, wicketType };
        }
        const runsPick = rnd();
        let runs = 0;
        if (runsPick < 0.34)
            runs = 0;
        else if (runsPick < 0.66)
            runs = 1;
        else if (runsPick < 0.78)
            runs = 2;
        else if (runsPick < 0.81)
            runs = 3;
        else if (runsPick < 0.94)
            runs = 4;
        else
            runs = 6;
        return { runsOffBat: runs, extraType: null, extraRuns: 0 };
    }
    const resolvePrompts = async () => {
        let p = await payloadOf();
        for (let guard = 0; guard < 600; guard++) {
            if (p.match.status !== 'LIVE')
                return p;
            const live = p.live;
            if (live.needsNewBatsman) {
                const { p: fresh, batting } = await (async () => ({ p, batting: await db_1.db.player.findMany({ where: { teamId: live.battingTeamId } }) }))();
                void fresh;
                const inn = p.innings.find((i) => i.number === live.inningsNumber);
                const usedIds = new Set(inn.batting.filter((b) => b.batted || b.out).map((b) => b.id));
                const atCrease = new Set([live.strikerId, live.nonStrikerId].filter(Boolean));
                const next = batting.find((x) => !usedIds.has(x.id) && !atCrease.has(x.id));
                if (!next)
                    throw new Error('No batter left — unexpected');
                await (0, match_service_1.applyAction)(mid, 'NEW_BATSMAN', { playerId: next.id });
            }
            else if (live.overComplete) {
                const bowling = await db_1.db.player.findMany({ where: { teamId: live.bowlingTeamId } });
                const inn = p.innings.find((i) => i.number === live.inningsNumber);
                const oversMap = new Map(inn.bowling.map((b) => [b.id, b]));
                const lastBowler = live.lastOverBowlerId;
                const candidates = bowling.filter((x) => {
                    if (x.id === lastBowler)
                        return false;
                    const card = oversMap.get(x.id);
                    const legal = card?.legalBalls ?? 0;
                    const completeOvers = Math.floor(legal / 6);
                    const partial = legal % 6;
                    return partial !== 0 || completeOvers < 4; // T20: max 4 overs per bowler
                });
                if (candidates.length === 0)
                    throw new Error('No bowler available — unexpected');
                await (0, match_service_1.applyAction)(mid, 'NEW_BOWLER', { playerId: pick(candidates).id });
            }
            else {
                return p;
            }
            p = await payloadOf();
        }
        throw new Error('Prompt resolution loop exceeded');
    };
    await startInnings();
    let p = await resolvePrompts();
    // innings 1
    for (let guard = 0; guard < 2000; guard++) {
        if (p.match.status !== 'LIVE')
            break;
        const delivery = nextDelivery();
        if (delivery.wicketType === 'RUN_OUT') {
            const live = p.live;
            delivery.dismissedId = rnd() < 0.75 ? live.strikerId : live.nonStrikerId;
            delivery.runsOffBat = pick([0, 1, 1, 2]);
        }
        if (delivery.wicketType && !['BOWLED', 'LBW', 'HIT_WICKET', 'RUN_OUT'].includes(delivery.wicketType)) {
            const { bowling } = await load();
            const fielders = bowling.filter((x) => x.id !== p.live.bowlerId);
            const fielder = pick(fielders);
            delivery.assistId = delivery.wicketType === 'CAUGHT_AND_BOWLED' ? p.live.bowlerId : fielder.id;
        }
        try {
            await (0, match_service_1.recordBall)(mid, delivery);
        }
        catch (e) {
            if (e instanceof match_service_1.MatchError)
                break; // innings just ended by previous ball
            throw e;
        }
        p = await resolvePrompts();
    }
    console.log('Innings 1 status:', (await payloadOf()).match.status);
    // innings 2 if at break
    p = await payloadOf();
    if (p.match.status === 'INNINGS_BREAK') {
        await startInnings();
        p = await resolvePrompts();
        for (let guard = 0; guard < 2000; guard++) {
            if (p.match.status !== 'LIVE')
                break;
            const target = p.match.target;
            const live = p.live;
            const battingScore = p.innings.find((i) => i.number === 2);
            const runsNeeded = target - battingScore.runs;
            const ballsLeft = live.ballsRemaining ?? 120;
            const needRate = runsNeeded / Math.max(ballsLeft / 6, 0.5);
            const delivery = nextDelivery();
            if (needRate > 9 && delivery.extraType === null && !delivery.wicketType && rnd() < 0.35) {
                delivery.runsOffBat = pick([4, 6, 6, 2, 4]);
            }
            if (delivery.wicketType === 'RUN_OUT') {
                const dismissed = rnd() < 0.75 ? 'striker' : 'nonStriker';
                delivery.dismissedId = dismissed === 'striker' ? live.strikerId : live.nonStrikerId;
                delivery.runsOffBat = pick([0, 1, 1, 2]);
            }
            if (delivery.wicketType && !['BOWLED', 'LBW', 'HIT_WICKET', 'RUN_OUT'].includes(delivery.wicketType)) {
                const { bowling } = await load();
                const fielders = bowling.filter((x) => x.id !== p.live.bowlerId);
                const fielder = pick(fielders);
                delivery.assistId = delivery.wicketType === 'CAUGHT_AND_BOWLED' ? p.live.bowlerId : fielder.id;
            }
            try {
                await (0, match_service_1.recordBall)(mid, delivery);
            }
            catch (e) {
                if (e instanceof match_service_1.MatchError)
                    break;
                throw e;
            }
            p = await resolvePrompts();
        }
    }
    const final = await payloadOf();
    console.log('— Match result —');
    console.log(final.match.status, '|', final.match.resultText);
    for (const inn of final.innings) {
        console.log(`Innings ${inn.number}: ${inn.runs}/${inn.wickets} in ${inn.oversDisplay} ov | extras ${inn.extras.total}`);
    }
    // a scheduled upcoming match so the home page has an "upcoming" card
    await db_1.db.match.create({
        data: {
            teamAId: teamB.id,
            teamBId: teamA.id,
            format: 'T10',
            totalOvers: 10,
            venue: 'Riverside Park Oval',
            status: 'SCHEDULED',
        },
    });
    console.log('— Seed complete —');
    process.exit(0);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
