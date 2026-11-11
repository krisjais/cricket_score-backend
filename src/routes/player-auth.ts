import { Router } from 'express'
import {
  connectDB,
  Award,
  Match,
  Player,
  PlayerCareerStat,
  PlayerMatchStat,
  PlayerProfileClaim,
  RefreshToken,
  Season,
  Team,
  TeamMembership,
  Tournament,
  User,
  withMongoTransaction,
} from '../lib/db'
import { sendOk, sendFail } from '../lib/api-utils'
import { ensureDefaultSeasonAndTournament } from '../lib/bootstrap'
import {
  computeEarnedAchievements,
  computePersonalBests,
  computeSeasonPerformance,
  enrichPerformanceSeries,
  resolveUpcomingMatchesForPlayer,
  type DashboardMatchHistoryEntry,
} from '../lib/player-dashboard-analytics'
import {
  PLAYER_REFRESH_COOKIE,
  clearPlayerAuthCookies,
  createOtpChallenge,
  createOtpProofToken,
  hashPassword,
  isValidEmail,
  isValidMobile,
  issuePlayerAuthCookies,
  normalizeEmail,
  normalizeMobile,
  requirePlayer,
  sha256,
  validatePasswordStrength,
  verifyOtpChallenge,
  verifyOtpProofToken,
  verifyPassword,
} from '../lib/player-auth'
import { rebuildCareerStatsForPlayers, writeAuditLog } from '../lib/stats-service'
import type { OtpChannel, OtpPurpose } from '../models'

const router = Router()

function sanitizeUser(u: any) {
  return {
    id: String(u._id ?? u.id),
    name: u.name,
    email: u.email ?? null,
    mobile: u.mobile ?? null,
    role: u.role,
    emailVerified: Boolean(u.emailVerified),
    mobileVerified: Boolean(u.mobileVerified),
    playerId: u.playerId ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
  }
}

const ALLOWED_OTP_PURPOSES: OtpPurpose[] = [
  'REGISTER',
  'VERIFY_EMAIL',
  'VERIFY_MOBILE',
  'CLAIM_PROFILE',
  'RESET_PASSWORD',
]

function parseOtpPurpose(raw: unknown): OtpPurpose {
  return typeof raw === 'string' && ALLOWED_OTP_PURPOSES.includes(raw as OtpPurpose)
    ? (raw as OtpPurpose)
    : 'REGISTER'
}

async function sendPasswordResetOtp(rawEmail: unknown): Promise<{
  status: number
  error?: string
  data?: Awaited<ReturnType<typeof createOtpChallenge>>
}> {
  const email = normalizeEmail(typeof rawEmail === 'string' ? rawEmail : null)
  if (!email || !isValidEmail(email)) {
    return { status: 400, error: 'Please enter a valid registered email address' }
  }

  const user = await User.findOne({ email })
    .select({ _id: 1, isActive: 1, playerId: 1 })
    .lean()
  if (!user || !user.isActive) {
    return { status: 404, error: 'No registered player account found for this email address' }
  }

  if (user.playerId) {
    const player = await Player.findById(user.playerId).select({ _id: 1, status: 1 }).lean()
    if (player?.status === 'MERGED') {
      return { status: 403, error: 'Player profile unavailable for this account' }
    }
  }

  const data = await createOtpChallenge({
    channel: 'EMAIL',
    target: email,
    purpose: 'RESET_PASSWORD',
    userId: user._id,
  })
  return { status: 200, data }
}

// POST /api/player-auth/otp/send
router.post('/otp/send', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const purpose = parseOtpPurpose(body.purpose)
    if (purpose === 'RESET_PASSWORD') {
      if (body.channel === 'MOBILE') {
        return sendFail(res, 'Password reset OTP can only be sent to your email inbox')
      }
      const outcome = await sendPasswordResetOtp(body.target)
      if (outcome.error || !outcome.data) {
        return sendFail(res, outcome.error || 'Failed to send password reset code', outcome.status)
      }
      return sendOk(res, outcome.data)
    }

    const channel: OtpChannel = body.channel === 'MOBILE' ? 'MOBILE' : 'EMAIL'
    const normalized = channel === 'EMAIL' ? normalizeEmail(body.target) : normalizeMobile(body.target)
    if (!normalized) {
      return sendFail(res, channel === 'EMAIL' ? 'Valid email address is required' : 'Valid mobile number is required')
    }
    if (channel === 'EMAIL' && !isValidEmail(normalized)) {
      return sendFail(res, 'Please enter a valid email address')
    }
    if (channel === 'MOBILE' && !isValidMobile(normalized)) {
      return sendFail(res, 'Please enter a valid 8-15 digit mobile number')
    }

    if (purpose === 'REGISTER') {
      const existing =
        channel === 'EMAIL'
          ? await User.findOne({ email: normalized }).select({ _id: 1 }).lean()
          : await User.findOne({ mobile: normalized }).select({ _id: 1 }).lean()
      if (existing) {
        return sendFail(
          res,
          channel === 'EMAIL'
            ? 'An account with this email already exists'
            : 'An account with this mobile number already exists',
          409
        )
      }
    }

    const result = await createOtpChallenge({
      channel,
      target: normalized,
      purpose,
    })
    return sendOk(res, result)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to send verification code', 400)
  }
})

// POST /api/player-auth/otp/verify
router.post('/otp/verify', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const purpose = parseOtpPurpose(body.purpose)
    if (purpose === 'RESET_PASSWORD' && body.channel === 'MOBILE') {
      return sendFail(res, 'Password reset verification only supports email OTP')
    }
    const channel: OtpChannel = body.channel === 'MOBILE' ? 'MOBILE' : 'EMAIL'
    const code = String(body.code ?? '').trim()
    const normalized = channel === 'EMAIL' ? normalizeEmail(body.target) : normalizeMobile(body.target)

    if (!normalized || !code) {
      return sendFail(res, 'Verification target and 6-digit OTP code are required')
    }

    const check = await verifyOtpChallenge({ channel, target: normalized, purpose, code })
    if (!check.ok) {
      return sendFail(res, check.error || 'OTP verification failed', 400)
    }

    const otpProofToken = await createOtpProofToken({ channel, target: normalized, purpose })
    return sendOk(res, { verified: true, channel, target: normalized, purpose, otpProofToken })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to verify OTP', 500)
  }
})

// POST /api/player-auth/forgot-password/send
router.post('/forgot-password/send', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const outcome = await sendPasswordResetOtp(body.email ?? body.target)
    if (outcome.error || !outcome.data) {
      return sendFail(res, outcome.error || 'Failed to send password reset code', outcome.status)
    }
    return sendOk(res, outcome.data)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to send password reset code', 400)
  }
})

// POST /api/player-auth/forgot-password/reset
router.post('/forgot-password/reset', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const email = normalizeEmail(typeof body.email === 'string' ? body.email : body.target)
    const newPassword =
      typeof body.newPassword === 'string'
        ? body.newPassword
        : typeof body.password === 'string'
          ? body.password
          : ''
    const otpCode = String(body.otpCode ?? body.code ?? '').trim()
    const otpProofToken = typeof body.otpProofToken === 'string' ? body.otpProofToken.trim() : ''

    if (!email || !isValidEmail(email)) {
      return sendFail(res, 'Please enter a valid registered email address')
    }

    const pwdErr = validatePasswordStrength(newPassword)
    if (pwdErr) {
      return sendFail(res, pwdErr)
    }

    const user = await User.findOne({ email })
    if (!user || !user.isActive) {
      return sendFail(res, 'No registered player account found for this email address', 404)
    }

    if (user.playerId) {
      const player = await Player.findById(user.playerId).select({ _id: 1, status: 1 }).lean()
      if (!player || player.status === 'MERGED') {
        return sendFail(res, 'Player profile unavailable for this account', 403)
      }
    }

    if (otpProofToken) {
      const proof = await verifyOtpProofToken(otpProofToken, 'RESET_PASSWORD')
      if (!proof || proof.channel !== 'EMAIL' || proof.target !== email) {
        return sendFail(res, 'Invalid or expired password reset verification proof. Please request a new OTP.')
      }
    } else if (otpCode) {
      const check = await verifyOtpChallenge({
        channel: 'EMAIL',
        target: email,
        purpose: 'RESET_PASSWORD',
        code: otpCode,
      })
      if (!check.ok) {
        return sendFail(res, check.error || 'Invalid or expired OTP code')
      }
    } else {
      return sendFail(res, 'Please enter the 6-digit OTP code from your email inbox')
    }

    user.passwordHash = await hashPassword(newPassword)
    user.emailVerified = true
    await user.save()

    // Invalidate all active refresh tokens so old sessions must sign in with the new password.
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    )
    clearPlayerAuthCookies(res)

    return sendOk(res, { reset: true, email })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to reset password', 500)
  }
})

// POST /api/player-auth/register
router.post('/register', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = normalizeEmail(body.email)
    const mobile = normalizeMobile(body.mobile)
    const password = typeof body.password === 'string' ? body.password : ''

    if (!name || name.length < 2) return sendFail(res, 'Full name is required (min 2 characters)')
    if (!email || !isValidEmail(email)) return sendFail(res, 'Valid email address is required')
    if (!mobile || !isValidMobile(mobile)) return sendFail(res, 'Valid mobile number (8-15 digits) is required')

    const pwdErr = validatePasswordStrength(password)
    if (pwdErr) return sendFail(res, pwdErr)

    // Duplicate account prevention
    const [dupEmail, dupMobile] = await Promise.all([
      User.findOne({ email }).select({ _id: 1 }).lean(),
      User.findOne({ mobile }).select({ _id: 1 }).lean(),
    ])
    if (dupEmail) return sendFail(res, 'An account with this email is already registered', 409)
    if (dupMobile) return sendFail(res, 'An account with this mobile number is already registered', 409)

    // OTP verification via either otpProofToken or direct otpCode + otpChannel
    let verifiedChannel: OtpChannel | null = null
    if (typeof body.otpProofToken === 'string' && body.otpProofToken.trim()) {
      const proof = await verifyOtpProofToken(body.otpProofToken.trim(), 'REGISTER')
      if (!proof) return sendFail(res, 'Invalid or expired OTP verification proof. Please verify again.')
      if (proof.channel === 'EMAIL' && proof.target !== email) {
        return sendFail(res, 'Verified email does not match registration email')
      }
      if (proof.channel === 'MOBILE' && proof.target !== mobile) {
        return sendFail(res, 'Verified mobile does not match registration mobile')
      }
      verifiedChannel = proof.channel
    } else if (typeof body.otpCode === 'string' && body.otpCode.trim()) {
      const ch: OtpChannel = body.otpChannel === 'MOBILE' ? 'MOBILE' : 'EMAIL'
      const target = ch === 'EMAIL' ? email : mobile
      const check = await verifyOtpChallenge({
        channel: ch,
        target,
        purpose: 'REGISTER',
        code: body.otpCode.trim(),
      })
      if (!check.ok) return sendFail(res, check.error || 'OTP verification failed')
      verifiedChannel = ch
    } else {
      return sendFail(res, 'Email or mobile OTP verification is required to register')
    }

    const role = ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)
      ? body.role
      : 'ALL_ROUNDER'
    const gender = body.gender === 'FEMALE' ? 'FEMALE' : 'MALE'
    const battingStyle = ['RIGHT_HAND', 'LEFT_HAND'].includes(body.battingStyle) ? body.battingStyle : null
    const bowlingStyle = [
      'RIGHT_ARM_FAST',
      'RIGHT_ARM_MEDIUM',
      'RIGHT_ARM_OFF_SPIN',
      'RIGHT_ARM_LEG_SPIN',
      'LEFT_ARM_FAST',
      'LEFT_ARM_MEDIUM',
      'LEFT_ARM_ORTHODOX',
      'LEFT_ARM_CHINAMAN',
      'NONE',
    ].includes(body.bowlingStyle)
      ? body.bowlingStyle
      : null

    let dob: Date | null = null
    if (body.dob) {
      const parsed = new Date(body.dob)
      if (!Number.isNaN(parsed.getTime())) dob = parsed
    }

    const passwordHash = await hashPassword(password)
    await ensureDefaultSeasonAndTournament()

    const { user, player } = await withMongoTransaction(async (session) => {
      const [createdPlayer] = await Player.create(
        [
          {
            playerCode: null,
            name,
            role,
            gender,
            avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() || null : null,
            dob,
            battingStyle,
            bowlingStyle,
            city: typeof body.city === 'string' ? body.city.trim() || null : null,
            bio: typeof body.bio === 'string' ? body.bio.trim() || null : null,
            isClaimed: true,
            isVerified: false,
            status: 'ACTIVE',
          },
        ],
        session ? { session } : undefined
      )

      const [createdUser] = await User.create(
        [
          {
            name,
            email,
            mobile,
            passwordHash,
            role: 'PLAYER',
            emailVerified: verifiedChannel === 'EMAIL',
            mobileVerified: verifiedChannel === 'MOBILE',
            isActive: true,
            playerId: createdPlayer._id,
            lastLoginAt: new Date(),
          },
        ],
        session ? { session } : undefined
      )

      createdPlayer.userId = createdUser._id
      await createdPlayer.save({ session: session ?? undefined })

      await PlayerCareerStat.create([{ playerId: createdPlayer._id }], session ? { session } : undefined)

      return { user: createdUser, player: createdPlayer }
    })

    const { accessToken } = await issuePlayerAuthCookies(res, user, player, req)

    return sendOk(
      res,
      {
        user: sanitizeUser(user),
        player: player.toObject(),
        accessToken,
      },
      201
    )
  } catch (err: any) {
    if (err?.code === 11000) {
      return sendFail(res, 'An account with this email or mobile number already exists', 409)
    }
    return sendFail(res, err?.message || 'Registration failed', 500)
  }
})

// POST /api/player-auth/login
router.post('/login', async (req, res) => {
  try {
    await connectDB()
    const body = req.body ?? {}
    const rawIdentifier = typeof body.identifier === 'string' ? body.identifier : body.email || body.mobile || ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!rawIdentifier.trim() || !password) {
      return sendFail(res, 'Email/mobile and password are required', 400)
    }

    const emailCandidate = normalizeEmail(rawIdentifier)
    const mobileCandidate = normalizeMobile(rawIdentifier)

    const user = await User.findOne({
      $or: [
        ...(emailCandidate && emailCandidate.includes('@') ? [{ email: emailCandidate }] : []),
        ...(mobileCandidate ? [{ mobile: mobileCandidate }] : []),
      ],
    })

    if (!user || !user.isActive) {
      return sendFail(res, 'Invalid credentials', 401)
    }

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) {
      return sendFail(res, 'Invalid credentials', 401)
    }

    let player = user.playerId ? await Player.findById(user.playerId) : null
    if (!player) {
      player = await Player.findOne({ userId: user._id })
    }
    if (!player || player.status === 'MERGED') {
      return sendFail(res, 'Player profile unavailable for this account', 403)
    }

    user.lastLoginAt = new Date()
    await user.save()

    const { accessToken } = await issuePlayerAuthCookies(res, user, player, req)

    return sendOk(res, {
      user: sanitizeUser(user),
      player: player.toObject(),
      accessToken,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Login failed', 500)
  }
})

// POST /api/player-auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    await connectDB()
    const rawRefresh: string | undefined = req.cookies?.[PLAYER_REFRESH_COOKIE]
    if (!rawRefresh) {
      return sendFail(res, 'Refresh token missing', 401)
    }

    const tokenDoc = await RefreshToken.findOne({
      tokenHash: sha256(rawRefresh),
      revokedAt: null,
    })
    if (!tokenDoc || tokenDoc.expiresAt.getTime() < Date.now()) {
      clearPlayerAuthCookies(res)
      return sendFail(res, 'Session expired. Please sign in again.', 401)
    }

    const user = await User.findById(tokenDoc.userId)
    const player = user?.playerId ? await Player.findById(user.playerId) : null
    if (!user || !user.isActive || !player || player.status === 'MERGED') {
      clearPlayerAuthCookies(res)
      return sendFail(res, 'Account unavailable', 401)
    }

    // Rotate refresh token
    tokenDoc.revokedAt = new Date()
    await tokenDoc.save()

    await issuePlayerAuthCookies(res, user, player, req)

    return sendOk(res, {
      refreshed: true,
      user: sanitizeUser(user),
      player: player.toObject(),
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to refresh session', 500)
  }
})

// POST /api/player-auth/logout
router.post('/logout', async (req, res) => {
  try {
    await connectDB()
    const rawRefresh: string | undefined = req.cookies?.[PLAYER_REFRESH_COOKIE]
    if (rawRefresh) {
      await RefreshToken.updateOne({ tokenHash: sha256(rawRefresh) }, { $set: { revokedAt: new Date() } })
    }
    clearPlayerAuthCookies(res)
    return sendOk(res, { loggedOut: true })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Logout failed', 500)
  }
})

// GET /api/player-auth/me
router.get('/me', async (req, res) => {
  try {
    await connectDB()
    const sess = await requirePlayer(req)
    if (!sess) {
      return sendOk(res, { isAuthenticated: false, user: null, player: null, currentMembership: null })
    }

    const [user, player, memberships] = await Promise.all([
      User.findById(sess.userId).lean(),
      Player.findById(sess.playerId).lean(),
      TeamMembership.find({ playerId: sess.playerId }).sort({ joinedAt: -1 }).lean(),
    ])
    if (!user || !player) {
      return sendOk(res, { isAuthenticated: false, user: null, player: null, currentMembership: null })
    }

    const activeMembership = memberships.find((m) => m.status === 'ACTIVE') ?? memberships[0] ?? null
    let currentMembership: any = null
    if (activeMembership) {
      const [team, season] = await Promise.all([
        Team.findById(activeMembership.teamId).lean(),
        Season.findById(activeMembership.seasonId).lean(),
      ])
      currentMembership = {
        ...activeMembership,
        id: activeMembership._id,
        team: team ? { id: team._id, name: team.name, shortName: team.shortName, color: team.color, logoUrl: team.logoUrl } : null,
        season: season ? { id: season._id, name: season.name, year: season.year, status: season.status } : null,
      }
    }

    return sendOk(res, {
      isAuthenticated: true,
      user: sanitizeUser(user),
      player: { ...player, id: player._id },
      currentMembership,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load profile session', 500)
  }
})

// PATCH /api/player-auth/profile - Personal & privacy edits only (official stats locked)
router.patch('/profile', async (req, res) => {
  try {
    await connectDB()
    const sess = await requirePlayer(req)
    if (!sess) return sendFail(res, 'Player authentication required', 401)

    const body = req.body ?? {}
    // Explicitly refuse attempts to tamper with official career identity or statistics
    const forbiddenFields = [
      'playerCode',
      'stats',
      'careerStats',
      'runs',
      'wickets',
      'matches',
      'isVerified',
      'isClaimed',
      'status',
    ]
    for (const f of forbiddenFields) {
      if (f in body) {
        return sendFail(res, `Players cannot manually edit official field "${f}"`, 403)
      }
    }

    const player = await Player.findById(sess.playerId)
    const user = await User.findById(sess.userId)
    if (!player || !user) return sendFail(res, 'Player not found', 404)

    if (typeof body.name === 'string' && body.name.trim().length >= 2) {
      player.name = body.name.trim()
      user.name = body.name.trim()
    }
    if (body.avatarUrl !== undefined) {
      player.avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() || null : null
    }
    if (body.dob !== undefined) {
      if (body.dob === null || body.dob === '') {
        player.dob = null
      } else {
        const d = new Date(body.dob)
        if (Number.isNaN(d.getTime())) return sendFail(res, 'Invalid date of birth')
        player.dob = d
      }
    }
    if (body.role && ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'].includes(body.role)) {
      player.role = body.role
    }
    if (body.battingStyle !== undefined) {
      player.battingStyle = ['RIGHT_HAND', 'LEFT_HAND'].includes(body.battingStyle) ? body.battingStyle : null
    }
    if (body.bowlingStyle !== undefined) {
      player.bowlingStyle = [
        'RIGHT_ARM_FAST',
        'RIGHT_ARM_MEDIUM',
        'RIGHT_ARM_OFF_SPIN',
        'RIGHT_ARM_LEG_SPIN',
        'LEFT_ARM_FAST',
        'LEFT_ARM_MEDIUM',
        'LEFT_ARM_ORTHODOX',
        'LEFT_ARM_CHINAMAN',
        'NONE',
      ].includes(body.bowlingStyle)
        ? body.bowlingStyle
        : null
    }
    if (body.city !== undefined) {
      player.city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) || null : null
    }
    if (body.bio !== undefined) {
      player.bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 400) || null : null
    }
    if (body.privacy && typeof body.privacy === 'object') {
      player.privacy = {
        showDob: Boolean(body.privacy.showDob ?? player.privacy?.showDob),
        showCity: Boolean(body.privacy.showCity ?? player.privacy?.showCity),
        showBio: Boolean(body.privacy.showBio ?? player.privacy?.showBio),
        showSeasonHistory: Boolean(body.privacy.showSeasonHistory ?? player.privacy?.showSeasonHistory),
        isPublic: Boolean(body.privacy.isPublic ?? player.privacy?.isPublic),
      }
    }

    await Promise.all([player.save(), user.save()])
    return sendOk(res, { user: sanitizeUser(user), player: player.toObject() })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update profile', 500)
  }
})

// GET /api/player-auth/dashboard - Full authenticated career dashboard
router.get('/dashboard', async (req, res) => {
  try {
    await connectDB()
    const sess = await requirePlayer(req)
    if (!sess) return sendFail(res, 'Player authentication required', 401)

    const [
      user,
      player,
      memberships,
      teams,
      seasons,
      tournaments,
      verifiedMatches,
      activeMatches,
      awards,
      pendingClaims,
    ] = await Promise.all([
      User.findById(sess.userId).lean(),
      Player.findById(sess.playerId).lean(),
      TeamMembership.find({ playerId: sess.playerId }).sort({ joinedAt: -1 }).lean(),
      Team.find({}).lean(),
      Season.find({}).lean(),
      Tournament.find({}).lean(),
      Match.find({ status: 'COMPLETED', scorecardStatus: 'VERIFIED' })
        .select({ _id: 1, format: 1, venue: 1 })
        .lean(),
      Match.find({ status: { $in: ['SCHEDULED', 'TOSS_DONE', 'LIVE', 'PAUSED', 'INNINGS_BREAK'] } })
        .select({
          _id: 1,
          format: 1,
          status: 1,
          venue: 1,
          matchDate: 1,
          teamAId: 1,
          teamBId: 1,
          seasonId: 1,
          tournamentId: 1,
          playerStatuses: 1,
        })
        .lean(),
      Award.find({ playerId: sess.playerId }).sort({ awardedAt: -1 }).lean(),
      PlayerProfileClaim.find({ userId: sess.userId }).sort({ createdAt: -1 }).lean(),
    ])
    if (!user || !player) return sendFail(res, 'Player not found', 404)

    let career = await PlayerCareerStat.findOne({ playerId: player._id }).lean()
    if (!career) {
      await rebuildCareerStatsForPlayers([player._id])
      career = await PlayerCareerStat.findOne({ playerId: player._id }).lean()
    }

    const teamMap = new Map(teams.map((t) => [t._id, t]))
    const seasonMap = new Map(seasons.map((s) => [s._id, s]))
    const tournamentMap = new Map(tournaments.map((t) => [t._id, t]))
    const verifiedMap = new Map(verifiedMatches.map((m) => [m._id, m]))

    const enrichedMemberships = memberships
      .map((m) => {
        const s = seasonMap.get(m.seasonId)
        const t = teamMap.get(m.teamId)
        return {
          ...m,
          id: m._id,
          season: s ? { id: s._id, name: s.name, code: s.code, year: s.year, status: s.status } : null,
          team: t ? { id: t._id, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl } : null,
        }
      })
      .sort((a, b) => (b.season?.year ?? 0) - (a.season?.year ?? 0))

    const currentMembership =
      enrichedMemberships.find((m) => m.season?.status === 'ACTIVE' && m.status === 'ACTIVE') ??
      enrichedMemberships[0] ??
      null

    const verifiedMatchIds = [...verifiedMap.keys()]
    const rawMatchStats =
      verifiedMatchIds.length > 0
        ? await PlayerMatchStat.find({ playerId: player._id, matchId: { $in: verifiedMatchIds } })
            .sort({ matchDate: -1 })
            .lean()
        : []

    const matchHistory: DashboardMatchHistoryEntry[] = rawMatchStats.map((st) => {
      const tm = teamMap.get(st.teamId)
      const opp = teamMap.get(st.opponentTeamId)
      const s = st.seasonId ? seasonMap.get(st.seasonId) : null
      const tr = st.tournamentId ? tournamentMap.get(st.tournamentId) : null
      const mMeta = verifiedMap.get(st.matchId)
      return {
        ...st,
        id: st._id,
        format: mMeta?.format ?? 'T20',
        venue: mMeta?.venue ?? null,
        team: tm
          ? { id: tm._id, name: tm.name, shortName: tm.shortName, color: tm.color, logoUrl: tm.logoUrl ?? null }
          : null,
        opponent: opp
          ? { id: opp._id, name: opp.name, shortName: opp.shortName, color: opp.color, logoUrl: opp.logoUrl ?? null }
          : null,
        season: s ? { id: s._id, name: s.name, year: s.year } : null,
        tournament: tr ? { id: tr._id, name: tr.name, shortName: tr.shortName } : null,
      }
    })

    const chronological = [...matchHistory].reverse()
    const performanceSeries = enrichPerformanceSeries(chronological)
    const seasonPerformance = computeSeasonPerformance(matchHistory, seasonMap)
    const personalBests = computePersonalBests(matchHistory)
    const achievements = computeEarnedAchievements({
      matchHistoryDesc: matchHistory,
      career,
      awards,
      tournaments,
      memberships,
      seasonMap,
    })
    const upcomingMatches = resolveUpcomingMatchesForPlayer({
      player,
      memberships,
      seasonMap,
      tournamentMap,
      teamMap,
      activeMatches,
    })

    return sendOk(res, {
      user: sanitizeUser(user),
      player: { ...player, id: player._id },
      currentMembership,
      memberships: enrichedMemberships,
      career,
      matchHistory,
      performanceSeries,
      seasonPerformance,
      personalBests,
      achievements,
      upcomingMatches,
      awards,
      claims: pendingClaims,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load player dashboard', 500)
  }
})

// GET /api/player-auth/claim-candidates - Search unclaimed historical players
router.get('/claim-candidates', async (req, res) => {
  try {
    await connectDB()
    const sess = await requirePlayer(req)
    if (!sess) return sendFail(res, 'Player authentication required', 401)

    const q = String(req.query.q ?? '').trim()
    const filter: any = {
      isClaimed: false,
      status: 'ACTIVE',
      _id: { $ne: sess.playerId },
    }
    if (q) {
      filter.name = { $regex: q, $options: 'i' }
    }

    const candidates = await Player.find(filter).sort({ createdAt: -1 }).limit(20).lean()
    const cIds = candidates.map((c) => c._id)
    const [teams, careerDocs] = await Promise.all([
      Team.find({}).lean(),
      PlayerCareerStat.find({ playerId: { $in: cIds } }).lean(),
    ])
    const teamMap = new Map(teams.map((t) => [t._id, t]))
    const careerMap = new Map(careerDocs.map((c) => [c.playerId, c]))

    return sendOk(
      res,
      candidates.map((c) => {
        const tm = c.teamId ? teamMap.get(c.teamId) : null
        const cr = careerMap.get(c._id)
        return {
          id: c._id,
          playerCode: c.playerCode,
          name: c.name,
          role: c.role,
          team: tm ? { id: tm._id, name: tm.name, shortName: tm.shortName } : null,
          matches: cr?.matches ?? 0,
          runs: cr?.runs ?? 0,
          wickets: cr?.wickets ?? 0,
        }
      })
    )
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to search claim candidates', 500)
  }
})

// POST /api/player-auth/claims - Submit verified profile claim for an unclaimed record
router.post('/claims', async (req, res) => {
  try {
    await connectDB()
    const sess = await requirePlayer(req)
    if (!sess) return sendFail(res, 'Player authentication required', 401)

    const body = req.body ?? {}
    const targetPlayerId = String(body.targetPlayerId ?? '').trim()
    if (!targetPlayerId) return sendFail(res, 'targetPlayerId is required')
    if (targetPlayerId === sess.playerId) return sendFail(res, 'This is already your active player profile')

    const [user, targetPlayer, existingPending] = await Promise.all([
      User.findById(sess.userId).lean(),
      Player.findById(targetPlayerId).lean(),
      PlayerProfileClaim.findOne({
        userId: sess.userId,
        targetPlayerId,
        status: 'PENDING',
      }).lean(),
    ])

    if (!user) return sendFail(res, 'User not found', 404)
    if (!targetPlayer) return sendFail(res, 'Target player profile not found', 404)
    if (targetPlayer.isClaimed || targetPlayer.status !== 'ACTIVE') {
      return sendFail(res, 'This player profile has already been claimed or merged', 409)
    }
    if (existingPending) {
      return sendFail(res, 'A claim request for this profile is already pending review', 409)
    }

    const method = body.verificationMethod === 'OTP_MOBILE' ? 'OTP_MOBILE' : 'OTP_EMAIL'
    let otpVerified = false

    if (typeof body.otpProofToken === 'string' && body.otpProofToken.trim()) {
      const proof = await verifyOtpProofToken(body.otpProofToken.trim(), 'CLAIM_PROFILE')
      if (!proof) return sendFail(res, 'Invalid or expired OTP proof for claim verification')
      otpVerified = true
    } else if (typeof body.otpCode === 'string' && body.otpCode.trim()) {
      const target = method === 'OTP_MOBILE' ? user.mobile : user.email
      if (!target) return sendFail(res, 'Verified contact channel not found on your account')
      const check = await verifyOtpChallenge({
        channel: method === 'OTP_MOBILE' ? 'MOBILE' : 'EMAIL',
        target,
        purpose: 'CLAIM_PROFILE',
        code: body.otpCode.trim(),
      })
      if (!check.ok) return sendFail(res, check.error || 'Invalid verification code')
      otpVerified = true
    } else {
      return sendFail(res, 'OTP verification is required before submitting a profile claim')
    }

    const claim = await PlayerProfileClaim.create({
      userId: user._id,
      targetPlayerId,
      requestedEmail: user.email,
      requestedMobile: user.mobile,
      verificationMethod: method,
      otpVerified,
      evidenceNotes: typeof body.evidenceNotes === 'string' ? body.evidenceNotes.trim().slice(0, 400) || null : null,
      status: 'PENDING',
    })

    await writeAuditLog({
      action: 'CLAIM_PLAYER',
      actor: { type: 'PLAYER', id: user._id, name: user.name },
      playerId: sess.playerId,
      sourcePlayerId: targetPlayerId,
      targetPlayerId: sess.playerId,
      reason: 'Player submitted OTP-verified historical profile claim (pending admin approval)',
      metadata: { claimId: claim._id, verificationMethod: method },
    })

    return sendOk(res, claim.toObject(), 201)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to submit profile claim', 500)
  }
})

export default router

