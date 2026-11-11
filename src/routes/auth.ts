import { Router } from 'express'
import {
  verifyAdminCredentials,
  createSessionToken,
  getSession,
  clearAdminSessionCookie,
  ADMIN_COOKIE,
  SESSION_DAYS,
} from '../lib/auth'
import {
  clearPlayerAuthCookies,
  PLAYER_REFRESH_COOKIE,
  sha256,
} from '../lib/player-auth'
import { connectDB, RefreshToken } from '../lib/db'
import { sendOk, sendFail } from '../lib/api-utils'

const router = Router()

router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return sendFail(res, 'Username and password are required')
  }

  const admin = await verifyAdminCredentials(String(username).trim(), String(password))
  if (!admin) {
    return sendFail(res, 'Invalid username or password', 401)
  }

  // Enforce single active role per browser: revoke & clear any player session when signing in as Admin
  const rawRefresh: string | undefined = req.cookies?.[PLAYER_REFRESH_COOKIE]
  if (rawRefresh) {
    await connectDB()
    await RefreshToken.updateOne({ tokenHash: sha256(rawRefresh) }, { $set: { revokedAt: new Date() } }).catch(
      () => undefined
    )
  }
  clearPlayerAuthCookies(res)

  const token = await createSessionToken(admin.id, admin.username)

  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  })

  return sendOk(res, { username: admin.username })
})

router.post('/logout', (_req, res) => {
  clearAdminSessionCookie(res)
  return sendOk(res, { loggedOut: true })
})

router.get('/me', async (req, res) => {
  const session = await getSession(req)
  if (!session && req.cookies?.[ADMIN_COOKIE]) {
    clearAdminSessionCookie(res)
  }
  return sendOk(res, { isAdmin: !!session, username: session?.username ?? null })
})

export default router
