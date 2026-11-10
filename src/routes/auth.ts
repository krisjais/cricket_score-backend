import { Router } from 'express'
import {
  verifyAdminCredentials,
  createSessionToken,
  getSession,
  ADMIN_COOKIE,
  SESSION_DAYS,
} from '../lib/auth'
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
  res.clearCookie(ADMIN_COOKIE, { path: '/' })
  return sendOk(res, { loggedOut: true })
})

router.get('/me', async (req, res) => {
  const session = await getSession(req)
  return sendOk(res, { isAdmin: !!session, username: session?.username ?? null })
})

export default router
