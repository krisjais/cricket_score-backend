import { SignJWT, jwtVerify } from 'jose'
import type { Request, Response, NextFunction } from 'express'
import { db } from './db'

export const ADMIN_COOKIE = 'cricket_admin_session'
export const SESSION_DAYS = 7

export function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'cricket-live-dev-secret-key-change-in-production'
  return new TextEncoder().encode(secret)
}

export function extractTokenFromRequest(req: Request, cookieName: string): string | undefined {
  let token: string | undefined = req.cookies?.[cookieName]

  if (!token && req.headers.cookie) {
    for (const part of req.headers.cookie.split(';')) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      if (k === cookieName) {
        token = decodeURIComponent(v)
        break
      }
    }
  }

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim()
  }

  return token
}

export async function createSessionToken(adminId: string, username: string): Promise<string> {
  return new SignJWT({ sub: adminId, username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey())
}

export interface AdminSession {
  adminId: string
  username: string
}

export async function getSession(req: Request): Promise<AdminSession | null> {
  const token = extractTokenFromRequest(req, ADMIN_COOKIE)

  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (!payload.sub || typeof payload.username !== 'string') return null
    return { adminId: payload.sub, username: payload.username }
  } catch {
    return null
  }
}

export async function requireAdmin(req: Request): Promise<AdminSession | null> {
  return getSession(req)
}

export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req)
  if (!session) {
    res.status(401).json({ ok: false, error: 'Admin authentication required' })
    return
  }
  ;(req as Request & { admin?: AdminSession }).admin = session
  next()
}

/** Ensure a default admin exists when the admins collection is completely empty. */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await db.admin.count()
  if (count > 0) return
  const passwordHash = await import('bcryptjs').then((b) => b.hash('admin123', 10))
  try {
    await db.admin.create({ data: { username: 'admin', passwordHash } })
  } catch (err) {
    // Ignore duplicate key error if a concurrent request created it first
    const code = (err as { code?: number })?.code
    if (code !== 11000) throw err
  }
}

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<{ id: string; username: string } | null> {
  let admin = await db.admin.findUnique({ where: { username } })
  if (!admin && (await db.admin.count()) === 0) {
    await ensureDefaultAdmin()
    admin = await db.admin.findUnique({ where: { username } })
  }
  if (!admin) return null
  const ok = await import('bcryptjs').then((b) => b.compare(password, admin.passwordHash))
  if (!ok) return null
  return { id: admin.id, username: admin.username }
}
