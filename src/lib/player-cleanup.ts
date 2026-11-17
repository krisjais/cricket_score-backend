import {
  connectDB,
  Player,
  User,
  RefreshToken,
  OtpVerification,
  PlayerCareerStat,
  PlayerMatchStat,
  TeamMembership,
  PlayerProfileClaim,
  PlayerAvailability,
  CaptaincyAssignment,
  InAppNotification,
  PushSubscription,
  NotificationPreferences,
  NotificationDeliveryJob,
  Award,
  Team,
} from './db'

/**
 * Permanently deletes a single player profile, its associated login user account (freeing email and mobile),
 * and all related stats, memberships, notifications, and tokens.
 */
export async function deletePlayerAndAssociatedData(
  playerId: string
): Promise<{ deleted: boolean; userDeleted: boolean }> {
  await connectDB()
  const player = await Player.findById(playerId)
  if (!player) return { deleted: false, userDeleted: false }

  // 1. Locate any linked User account(s)
  const userQuery: Array<Record<string, any>> = [{ playerId }]
  if (player.userId) {
    userQuery.push({ _id: player.userId })
  }
  const users = await User.find({ $or: userQuery, role: 'PLAYER' })
  const userIds = users.map((u) => u._id)
  const targetsToClear: string[] = []
  for (const u of users) {
    if (u.email) targetsToClear.push(u.email)
    if (u.mobile) targetsToClear.push(u.mobile)
  }

  // 2. Delete linked Player User accounts & their auth tokens
  let userDeleted = false
  if (userIds.length > 0) {
    await Promise.all([
      User.deleteMany({ _id: { $in: userIds } }),
      RefreshToken.deleteMany({ userId: { $in: userIds } }),
      OtpVerification.deleteMany({
        $or: [
          { userId: { $in: userIds } },
          { target: { $in: targetsToClear } },
        ],
      }),
    ])
    userDeleted = true
  }

  // 3. Delete all associated statistics, memberships, claims, notifications, push subscriptions, availability, and awards
  await Promise.all([
    PlayerCareerStat.deleteMany({ playerId }),
    PlayerMatchStat.deleteMany({ playerId }),
    TeamMembership.deleteMany({ playerId }),
    PlayerProfileClaim.deleteMany({
      $or: [
        { targetPlayerId: playerId },
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
      ],
    }),
    PlayerAvailability.deleteMany({ playerId }),
    CaptaincyAssignment.deleteMany({ playerId }),
    InAppNotification.deleteMany({ recipientPlayerId: playerId }),
    PushSubscription.deleteMany({ playerId }),
    NotificationPreferences.deleteMany({ playerId }),
    NotificationDeliveryJob.deleteMany({ recipientPlayerId: playerId }),
    Award.deleteMany({ playerId }),
    Team.updateMany({ players: playerId }, { $pull: { players: playerId } }),
  ])

  // 4. Finally delete the player
  await Player.findByIdAndDelete(playerId)
  return { deleted: true, userDeleted }
}

/**
 * Permanently deletes all player profiles and all player login user accounts (retaining admin accounts).
 */
export async function deleteAllPlayersAndAssociatedData(): Promise<{
  deletedPlayersCount: number
  deletedUsersCount: number
}> {
  await connectDB()
  const [usersRes, playersRes] = await Promise.all([
    User.deleteMany({ role: 'PLAYER' }),
    Player.deleteMany({}),
    RefreshToken.deleteMany({}),
    OtpVerification.deleteMany({}),
    PlayerCareerStat.deleteMany({}),
    PlayerMatchStat.deleteMany({}),
    TeamMembership.deleteMany({}),
    PlayerProfileClaim.deleteMany({}),
    PlayerAvailability.deleteMany({}),
    CaptaincyAssignment.deleteMany({}),
    InAppNotification.deleteMany({}),
    PushSubscription.deleteMany({}),
    NotificationPreferences.deleteMany({}),
    NotificationDeliveryJob.deleteMany({}),
    Award.deleteMany({}),
    Team.updateMany({}, { $set: { players: [] } }),
  ])
  return {
    deletedPlayersCount: playersRes.deletedCount,
    deletedUsersCount: usersRes.deletedCount,
  }
}

/**
 * Finds and deletes any orphaned PLAYER user accounts whose associated Player profile no longer exists.
 * Frees up previously registered emails and phone numbers.
 */
export async function cleanupOrphanedPlayerAccounts(): Promise<number> {
  try {
    await connectDB()
    const playerUsers = await User.find({ role: 'PLAYER' })
      .select({ _id: 1, email: 1, mobile: 1, playerId: 1 })
      .lean()
    if (!playerUsers.length) return 0

    const playerIds = playerUsers.map((u) => u.playerId).filter(Boolean) as string[]
    const userIds = playerUsers.map((u) => u._id)

    const [playersById, playersByUserId] = await Promise.all([
      Player.find({ _id: { $in: playerIds } }).select({ _id: 1 }).lean(),
      Player.find({ userId: { $in: userIds } }).select({ userId: 1 }).lean(),
    ])

    const validPlayerIds = new Set(playersById.map((p) => String(p._id)))
    const validUserIds = new Set(playersByUserId.map((p) => String(p.userId)))

    const orphanedUserIds: string[] = []
    const targetsToClear: string[] = []

    for (const u of playerUsers) {
      const hasPlayer = (u.playerId && validPlayerIds.has(String(u.playerId))) || validUserIds.has(String(u._id))
      if (!hasPlayer) {
        orphanedUserIds.push(String(u._id))
        if (u.email) targetsToClear.push(u.email)
        if (u.mobile) targetsToClear.push(u.mobile)
      }
    }

    if (orphanedUserIds.length > 0) {
      console.log(
        `> [Cleanup] Purging ${orphanedUserIds.length} orphaned player account(s) whose profiles were deleted.`
      )
      await Promise.all([
        User.deleteMany({ _id: { $in: orphanedUserIds } }),
        RefreshToken.deleteMany({ userId: { $in: orphanedUserIds } }),
        OtpVerification.deleteMany({
          $or: [
            { userId: { $in: orphanedUserIds } },
            { target: { $in: targetsToClear } },
          ],
        }),
      ])
    }
    return orphanedUserIds.length
  } catch (err) {
    console.error('> [Cleanup] Error purging orphaned player accounts:', err)
    return 0
  }
}

/**
 * Checks if a given User document is an orphaned player account (player was deleted).
 * If so, immediately purges it so the email and mobile are available for new registration.
 */
export async function purgeIfOrphanedPlayerUser(userDoc: any): Promise<boolean> {
  if (!userDoc || userDoc.role !== 'PLAYER') return false
  await connectDB()
  let hasPlayer = false
  if (userDoc.playerId) {
    hasPlayer = Boolean(await Player.exists({ _id: userDoc.playerId }))
  }
  if (!hasPlayer) {
    hasPlayer = Boolean(await Player.exists({ userId: userDoc._id }))
  }
  if (!hasPlayer) {
    console.log(`> [Auth] Purging orphaned player account: email=${userDoc.email}, mobile=${userDoc.mobile}`)
    await Promise.all([
      User.findByIdAndDelete(userDoc._id),
      RefreshToken.deleteMany({ userId: userDoc._id }),
      OtpVerification.deleteMany({
        $or: [
          { userId: userDoc._id },
          ...(userDoc.email ? [{ target: userDoc.email }] : []),
          ...(userDoc.mobile ? [{ target: userDoc.mobile }] : []),
        ],
      }),
    ])
    return true
  }
  return false
}
