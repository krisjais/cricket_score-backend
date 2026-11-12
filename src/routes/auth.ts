import { Router, type Request, type Response } from 'express'
import {
  verifyAdminCredentials,
  createSessionToken,
  getSession,
  clearAdminSessionCookie,
  isSecureRequest,
  ADMIN_COOKIE,
  SESSION_DAYS,
} from '../lib/auth'
import {
  authenticatePlayerCredentials,
  clearPlayerAuthCookies,
  issuePlayerAuthCookies,
  PLAYER_REFRESH_COOKIE,
  sanitizePlayerUser,
  sha256,
} from '../lib/player-auth'
import { connectDB, RefreshToken } from '../lib/db'
import { sendOk, sendFail } from '../lib/api-utils'

const router = Router()

async function issueAdminLoginSession(
  req: Request,
  res: Response,
  admin: { id: string; username: string }
) {
  // Enforce single active role per browser: revoke & clear any player session when signing in as Admin
  const rawRefresh: string | undefined = req.cookies?.[PLAYER_REFRESH_COOKIE]
  if (rawRefresh) {
    await connectDB()
    await RefreshToken.updateOne({ tokenHash: sha256(rawRefresh) }, { $set: { revokedAt: new Date() } }).catch(
      () => undefined
    )
  }
  clearPlayerAuthCookies(res, req)

  const token = await createSessionToken(admin.id, admin.username)

  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  })

  return { username: admin.username }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return sendFail(res, 'Username and password are required')
  }

  const admin = await verifyAdminCredentials(String(username).trim(), String(password))
  if (!admin) {
    return sendFail(res, 'Invalid username or password', 401)
  }

  const adminPayload = await issueAdminLoginSession(req, res, admin)
  return sendOk(res, adminPayload)
})

router.post('/unified-login', async (req, res) => {
  try {
    const body = req.body ?? {}
    const rawIdentifier =
      typeof body.identifier === 'string'
        ? body.identifier
        : typeof body.username === 'string'
          ? body.username
          : body.email || body.mobile || ''
    const identifier = String(rawIdentifier).trim()
    const password = typeof body.password === 'string' ? body.password : ''

    if (!identifier || !password) {
      return sendFail(res, 'Email/mobile/username and password are required', 400)
    }

    await connectDB()

    const admin = await verifyAdminCredentials(identifier, password)
    if (admin) {
      const adminPayload = await issueAdminLoginSession(req, res, admin)
      return sendOk(res, {
        role: 'ADMIN' as const,
        ...adminPayload,
      })
    }

    const playerResult = await authenticatePlayerCredentials(identifier, password)
    if (!playerResult.ok) {
      return sendFail(res, playerResult.error, playerResult.status)
    }

    const { user, player } = playerResult
    user.lastLoginAt = new Date()
    await user.save()

    const { accessToken } = await issuePlayerAuthCookies(res, user, player, req)

    return sendOk(res, {
      role: 'PLAYER' as const,
      user: sanitizePlayerUser(user),
      player: player.toObject(),
      accessToken,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Login failed', 500)
  }
})

router.post('/logout', (req, res) => {
  clearAdminSessionCookie(res, req)
  return sendOk(res, { loggedOut: true })
})

router.get('/me', async (req, res) => {
  const session = await getSession(req)
  if (!session && req.cookies?.[ADMIN_COOKIE]) {
    clearAdminSessionCookie(res, req)
  }
  return sendOk(res, { isAdmin: !!session, username: session?.username ?? null })
})

export default router
