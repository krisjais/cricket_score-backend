import {
  connectDB,
  Counter,
  Match,
  Player,
  Season,
  TeamMembership,
  Tournament,
} from './db'

/**
 * Generate a unique, permanent player code such as PLR-2026-000125.
 * Uses an atomic MongoDB Counter document per year so concurrent creations never collide.
 */
export async function generateNextPlayerCode(year = new Date().getFullYear()): Promise<string> {
  await connectDB()
  const counterId = `player_code_${year}`

  // Sync counter baseline once if manual/imported codes already exist
  for (let attempt = 0; attempt < 5; attempt++) {
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    )
    const seq = counter?.seq ?? 1
    const code = `PLR-${year}-${String(seq).padStart(6, '0')}`
    const existing = await Player.findOne({ playerCode: code }).select({ _id: 1 }).lean()
    if (!existing) {
      return code
    }
  }

  // Defensive fallback if counter trailed behind high manual sequence
  const latest = await Player.find({ playerCode: { $regex: `^PLR-${year}-\\d+$` } })
    .sort({ playerCode: -1 })
    .limit(1)
    .lean()
  const maxSeq = latest[0]?.playerCode ? Number(latest[0].playerCode.split('-')[2] || 0) : 0
  const bumped = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $max: { seq: maxSeq + 1 } },
    { upsert: true, new: true }
  )
  return `PLR-${year}-${String((bumped?.seq ?? maxSeq + 1)).padStart(6, '0')}`
}

/**
 * Ensure there is always an active default Season and default Tournament so matches,
 * memberships, and players created through existing flows have clean season anchors.
 */
export async function ensureDefaultSeasonAndTournament() {
  await connectDB()
  const currentYear = new Date().getFullYear()
  const code = `S${currentYear}`

  let season = await Season.findOne({ isDefault: true }).lean()
  if (!season) {
    season = await Season.findOne({ status: 'ACTIVE' }).sort({ year: -1 }).lean()
  }
  if (!season) {
    season = await Season.findOne({ code }).lean()
  }
  if (!season) {
    const created = await Season.create({
      name: `Season ${currentYear}`,
      code,
      year: currentYear,
      status: 'ACTIVE',
      isDefault: true,
      startDate: new Date(`${currentYear}-01-01T00:00:00.000Z`),
    })
    season = created.toObject()
  } else if (!season.isDefault) {
    await Season.updateOne({ _id: season._id }, { $set: { isDefault: true } })
  }

  let tournament = await Tournament.findOne({ seasonId: season._id }).sort({ createdAt: 1 }).lean()
  if (!tournament) {
    const createdT = await Tournament.create({
      name: `Nexcore Premier League ${season.year}`,
      shortName: `NPL-${String(season.year).slice(-2)}`,
      seasonId: season._id,
      format: 'T20',
      status: 'ACTIVE',
      startDate: season.startDate ?? new Date(),
    })
    tournament = createdT.toObject()
  }

  return { season, tournament }
}

/**
 * Assign or sync an ACTIVE-season TeamMembership without overwriting historical seasons.
 */
export async function ensureActiveMembershipForPlayer(
  playerId: string,
  teamId: string | null,
  seasonId?: string | null,
  options?: { designation?: 'PLAYER' | 'CAPTAIN' | 'VICE_CAPTAIN' | 'WICKETKEEPER'; jerseyNumber?: number | null; assignedBy?: string | null }
) {
  if (!teamId) return null
  await connectDB()

  const targetSeason =
    seasonId
      ? await Season.findById(seasonId).lean()
      : (await ensureDefaultSeasonAndTournament()).season
  if (!targetSeason) return null

  const existing = await TeamMembership.findOne({ playerId, seasonId: targetSeason._id })
  if (!existing) {
    const created = await TeamMembership.create({
      playerId,
      teamId,
      seasonId: targetSeason._id,
      joinedAt: new Date(),
      status: targetSeason.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
      designation: options?.designation ?? 'PLAYER',
      jerseyNumber: options?.jerseyNumber ?? null,
      assignedBy: options?.assignedBy ?? 'SYSTEM_SYNC',
    })
    return created.toObject()
  }

  // Only sync active season pointer when called for current roster sync; never overwrite COMPLETED season history
  if (targetSeason.status !== 'COMPLETED' && existing.teamId !== teamId && !seasonId) {
    existing.teamId = teamId
    existing.status = 'ACTIVE'
    await existing.save()
  }
  return existing.toObject()
}

let bootstrapPromise: Promise<void> | null = null

/**
 * Idempotent startup migration & backfill for pre-existing players, teams, and matches.
 */
export async function ensurePlayerSystemBootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    try {
      await connectDB()
      const { season, tournament } = await ensureDefaultSeasonAndTournament()

      // 1. Backfill permanent playerCode for any existing player missing it
      const missingCodePlayers = await Player.find({
        $or: [{ playerCode: null }, { playerCode: { $exists: false } }, { playerCode: '' }],
      }).sort({ createdAt: 1 })

      for (const p of missingCodePlayers) {
        const year = p.createdAt ? new Date(p.createdAt).getFullYear() : new Date().getFullYear()
        p.playerCode = await generateNextPlayerCode(year)
        if (typeof p.isClaimed !== 'boolean') p.isClaimed = Boolean(p.userId)
        if (!p.status) p.status = 'ACTIVE'
        await p.save()
      }

      // 2. Backfill current TeamMembership rows for existing players with teamId
      const teamedPlayers = await Player.find({ teamId: { $ne: null } }).lean()
      for (const p of teamedPlayers) {
        const exists = await TeamMembership.findOne({ playerId: p._id, seasonId: season._id }).select({ _id: 1 }).lean()
        if (!exists && p.teamId) {
          await TeamMembership.create({
            playerId: p._id,
            teamId: p.teamId,
            seasonId: season._id,
            joinedAt: p.createdAt ?? new Date(),
            status: 'ACTIVE',
            designation: 'PLAYER',
            jerseyNumber: p.jerseyNumber ?? null,
            assignedBy: 'MIGRATION',
          }).catch(() => undefined)
        }
      }

      // 3. Backfill seasonId / tournamentId / matchDate on matches where missing
      await Match.updateMany(
        { $or: [{ seasonId: null }, { seasonId: { $exists: false } }] },
        { $set: { seasonId: season._id, tournamentId: tournament._id } }
      )
      await Match.updateMany(
        { $or: [{ scorecardStatus: null }, { scorecardStatus: { $exists: false } }] },
        { $set: { scorecardStatus: 'DRAFT' } }
      )
    } catch (err) {
      bootstrapPromise = null
      console.error('> Bootstrap migration error:', err)
    }
  })()
  return bootstrapPromise
}

