"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Verification: recompute innings totals straight from raw Ball rows and
 * compare against the engine-computed payload.
 *
 * Identities checked per innings:
 *  1. raw team runs (sum of runsOffBat + extraRuns) === engine runs
 *  2. raw wicket count === engine wickets
 *  3. raw legal-ball count === engine legalBalls
 *  4. sum of batter runs + extras.total === team runs
 *  5. sum of bowler conceded === runs - byes - leg-byes (byes/leg-byes not charged to bowler)
 *  6. balls faced by batters === legal deliveries (byes/leg-byes count as faced)
 */
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const db_1 = require("../src/lib/db");
const match_state_1 = require("../src/lib/match-state");
async function main() {
    await (0, db_1.connectDB)();
    const matches = await db_1.db.match.findMany({ include: { innings: { include: { balls: true } } } });
    let failures = 0;
    for (const m of matches) {
        const payload = await (0, match_state_1.buildMatchPayload)(m.id);
        if (!payload)
            continue;
        for (const inn of m.innings) {
            const rawRuns = inn.balls.reduce((s, b) => s + b.runsOffBat + b.extraRuns, 0);
            const rawWkts = inn.balls.filter((b) => b.isWicket).length;
            const rawLegal = inn.balls.filter((b) => b.isLegal).length;
            const stats = payload.innings.find((i) => i.inningsId === inn.id);
            const batSum = stats.batting.reduce((s, b) => s + b.runs, 0);
            const faced = stats.batting.reduce((s, b) => s + b.balls, 0);
            const conceded = stats.bowling.reduce((s, b) => s + b.runsConceded, 0);
            const expectedConceded = stats.runs - stats.extras.byes - stats.extras.legByes;
            const checks = [
                ['runs', rawRuns === stats.runs],
                ['wickets', rawWkts === stats.wickets],
                ['legalBalls', rawLegal === stats.legalBalls],
                ['batRuns+extras', batSum + stats.extras.total === stats.runs],
                ['bowlerConceded', conceded === expectedConceded],
                ['ballsFaced', faced === stats.legalBalls],
            ];
            const allOk = checks.every(([, v]) => v);
            if (!allOk)
                failures++;
            const bad = checks.filter(([, v]) => !v).map(([k]) => k).join(',');
            console.log(`inn${inn.number}: ${stats.runs}/${stats.wickets} in ${stats.oversDisplay} | extras ${stats.extras.total} (wd ${stats.extras.wides}, nb ${stats.extras.noBalls}, b ${stats.extras.byes}, lb ${stats.extras.legByes}) | ${allOk ? 'OK' : 'FAIL: ' + bad}`);
        }
    }
    console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
    await db_1.db.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
