"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupTestSeasons = cleanupTestSeasons;
const db_1 = require("./db");
/**
 * Automatically purges any test seasons, test tournaments, test teams, and test players
 * created by test scripts (e.g., test-notification-system, test-captaincy).
 * NEVER touches default or real seasons such as "Season 2026".
 */
async function cleanupTestSeasons() {
    await (0, db_1.connectDB)();
    const testSeasons = await db_1.Season.find({
        $or: [
            { name: { $regex: /^Test Season/i } },
            { code: { $regex: /^S-[0-9a-f]{8}$/i } },
            { name: { $regex: /^NPL Season 2025 \(/i } },
        ],
        isDefault: { $ne: true },
    })
        .select({ _id: 1, name: 1 })
        .lean();
    if (!testSeasons.length)
        return 0;
    const seasonIds = testSeasons.map((s) => s._id);
    console.log(`> [Cleanup] Purging ${seasonIds.length} test season(s):`, testSeasons.map((s) => s.name));
    await Promise.all([
        db_1.Tournament.deleteMany({ seasonId: { $in: seasonIds } }),
        db_1.TeamMembership.deleteMany({ seasonId: { $in: seasonIds } }),
        db_1.CaptaincyAssignment.deleteMany({ seasonId: { $in: seasonIds } }),
        db_1.Season.deleteMany({ _id: { $in: seasonIds } }),
    ]);
    // Clean up any test teams or users left behind by test suites
    await Promise.all([
        db_1.Team.deleteMany({ name: { $regex: /^(Royal Knights|Thunder Bolts) [0-9a-f]{8}/i } }),
        db_1.Player.deleteMany({ name: { $regex: /^Captain Alpha [0-9a-f]{8}/i } }),
        db_1.User.deleteMany({ email: { $regex: /^captain\.[0-9a-f]{8}@test\.local$/i } }),
    ]);
    return seasonIds.length;
}
