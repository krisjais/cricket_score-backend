"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../src/lib/env");
const db_1 = require("../src/lib/db");
async function main() {
    await (0, db_1.connectDB)();
    const [admins, teams, players, matches, innings, balls] = await Promise.all([
        db_1.db.admin.count(),
        db_1.db.team.count(),
        db_1.db.player.count(),
        db_1.db.match.count(),
        db_1.db.innings.count(),
        db_1.db.ball.count(),
    ]);
    console.log({ admins, teams, players, matches, innings, balls });
    const ms = await db_1.db.match.findMany({ select: { id: true, status: true, format: true, currentInnings: true } });
    console.log(JSON.stringify(ms));
    await db_1.db.$disconnect();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
