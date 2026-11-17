"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePlayerAndAssociatedData = deletePlayerAndAssociatedData;
exports.deleteAllPlayersAndAssociatedData = deleteAllPlayersAndAssociatedData;
exports.cleanupOrphanedPlayerAccounts = cleanupOrphanedPlayerAccounts;
exports.purgeIfOrphanedPlayerUser = purgeIfOrphanedPlayerUser;
const db_1 = require("./db");
/**
 * Permanently deletes a single player profile, its associated login user account (freeing email and mobile),
 * and all related stats, memberships, notifications, and tokens.
 */
async function deletePlayerAndAssociatedData(playerId) {
    await (0, db_1.connectDB)();
    const player = await db_1.Player.findById(playerId);
    if (!player)
        return { deleted: false, userDeleted: false };
    // 1. Locate any linked User account(s)
    const userQuery = [{ playerId }];
    if (player.userId) {
        userQuery.push({ _id: player.userId });
    }
    const users = await db_1.User.find({ $or: userQuery, role: 'PLAYER' });
    const userIds = users.map((u) => u._id);
    const targetsToClear = [];
    for (const u of users) {
        if (u.email)
            targetsToClear.push(u.email);
        if (u.mobile)
            targetsToClear.push(u.mobile);
    }
    // 2. Delete linked Player User accounts & their auth tokens
    let userDeleted = false;
    if (userIds.length > 0) {
        await Promise.all([
            db_1.User.deleteMany({ _id: { $in: userIds } }),
            db_1.RefreshToken.deleteMany({ userId: { $in: userIds } }),
            db_1.OtpVerification.deleteMany({
                $or: [
                    { userId: { $in: userIds } },
                    { target: { $in: targetsToClear } },
                ],
            }),
        ]);
        userDeleted = true;
    }
    // 3. Delete all associated statistics, memberships, claims, notifications, push subscriptions, availability, and awards
    await Promise.all([
        db_1.PlayerCareerStat.deleteMany({ playerId }),
        db_1.PlayerMatchStat.deleteMany({ playerId }),
        db_1.TeamMembership.deleteMany({ playerId }),
        db_1.PlayerProfileClaim.deleteMany({
            $or: [
                { targetPlayerId: playerId },
                ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
            ],
        }),
        db_1.PlayerAvailability.deleteMany({ playerId }),
        db_1.CaptaincyAssignment.deleteMany({ playerId }),
        db_1.InAppNotification.deleteMany({ recipientPlayerId: playerId }),
        db_1.PushSubscription.deleteMany({ playerId }),
        db_1.NotificationPreferences.deleteMany({ playerId }),
        db_1.NotificationDeliveryJob.deleteMany({ recipientPlayerId: playerId }),
        db_1.Award.deleteMany({ playerId }),
        db_1.Team.updateMany({ players: playerId }, { $pull: { players: playerId } }),
    ]);
    // 4. Finally delete the player
    await db_1.Player.findByIdAndDelete(playerId);
    return { deleted: true, userDeleted };
}
/**
 * Permanently deletes all player profiles and all player login user accounts (retaining admin accounts).
 */
async function deleteAllPlayersAndAssociatedData() {
    await (0, db_1.connectDB)();
    const [usersRes, playersRes] = await Promise.all([
        db_1.User.deleteMany({ role: 'PLAYER' }),
        db_1.Player.deleteMany({}),
        db_1.RefreshToken.deleteMany({}),
        db_1.OtpVerification.deleteMany({}),
        db_1.PlayerCareerStat.deleteMany({}),
        db_1.PlayerMatchStat.deleteMany({}),
        db_1.TeamMembership.deleteMany({}),
        db_1.PlayerProfileClaim.deleteMany({}),
        db_1.PlayerAvailability.deleteMany({}),
        db_1.CaptaincyAssignment.deleteMany({}),
        db_1.InAppNotification.deleteMany({}),
        db_1.PushSubscription.deleteMany({}),
        db_1.NotificationPreferences.deleteMany({}),
        db_1.NotificationDeliveryJob.deleteMany({}),
        db_1.Award.deleteMany({}),
        db_1.Team.updateMany({}, { $set: { players: [] } }),
    ]);
    return {
        deletedPlayersCount: playersRes.deletedCount,
        deletedUsersCount: usersRes.deletedCount,
    };
}
/**
 * Finds and deletes any orphaned PLAYER user accounts whose associated Player profile no longer exists.
 * Frees up previously registered emails and phone numbers.
 */
async function cleanupOrphanedPlayerAccounts() {
    try {
        await (0, db_1.connectDB)();
        const playerUsers = await db_1.User.find({ role: 'PLAYER' })
            .select({ _id: 1, email: 1, mobile: 1, playerId: 1 })
            .lean();
        if (!playerUsers.length)
            return 0;
        const playerIds = playerUsers.map((u) => u.playerId).filter(Boolean);
        const userIds = playerUsers.map((u) => u._id);
        const [playersById, playersByUserId] = await Promise.all([
            db_1.Player.find({ _id: { $in: playerIds } }).select({ _id: 1 }).lean(),
            db_1.Player.find({ userId: { $in: userIds } }).select({ userId: 1 }).lean(),
        ]);
        const validPlayerIds = new Set(playersById.map((p) => String(p._id)));
        const validUserIds = new Set(playersByUserId.map((p) => String(p.userId)));
        const orphanedUserIds = [];
        const targetsToClear = [];
        for (const u of playerUsers) {
            const hasPlayer = (u.playerId && validPlayerIds.has(String(u.playerId))) || validUserIds.has(String(u._id));
            if (!hasPlayer) {
                orphanedUserIds.push(String(u._id));
                if (u.email)
                    targetsToClear.push(u.email);
                if (u.mobile)
                    targetsToClear.push(u.mobile);
            }
        }
        if (orphanedUserIds.length > 0) {
            console.log(`> [Cleanup] Purging ${orphanedUserIds.length} orphaned player account(s) whose profiles were deleted.`);
            await Promise.all([
                db_1.User.deleteMany({ _id: { $in: orphanedUserIds } }),
                db_1.RefreshToken.deleteMany({ userId: { $in: orphanedUserIds } }),
                db_1.OtpVerification.deleteMany({
                    $or: [
                        { userId: { $in: orphanedUserIds } },
                        { target: { $in: targetsToClear } },
                    ],
                }),
            ]);
        }
        return orphanedUserIds.length;
    }
    catch (err) {
        console.error('> [Cleanup] Error purging orphaned player accounts:', err);
        return 0;
    }
}
/**
 * Checks if a given User document is an orphaned player account (player was deleted).
 * If so, immediately purges it so the email and mobile are available for new registration.
 */
async function purgeIfOrphanedPlayerUser(userDoc) {
    if (!userDoc || userDoc.role !== 'PLAYER')
        return false;
    await (0, db_1.connectDB)();
    let hasPlayer = false;
    if (userDoc.playerId) {
        hasPlayer = Boolean(await db_1.Player.exists({ _id: userDoc.playerId }));
    }
    if (!hasPlayer) {
        hasPlayer = Boolean(await db_1.Player.exists({ userId: userDoc._id }));
    }
    if (!hasPlayer) {
        console.log(`> [Auth] Purging orphaned player account: email=${userDoc.email}, mobile=${userDoc.mobile}`);
        await Promise.all([
            db_1.User.findByIdAndDelete(userDoc._id),
            db_1.RefreshToken.deleteMany({ userId: userDoc._id }),
            db_1.OtpVerification.deleteMany({
                $or: [
                    { userId: userDoc._id },
                    ...(userDoc.email ? [{ target: userDoc.email }] : []),
                    ...(userDoc.mobile ? [{ target: userDoc.mobile }] : []),
                ],
            }),
        ]);
        return true;
    }
    return false;
}
