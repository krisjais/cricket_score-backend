import { SignJWT, jwtVerify } from 'jose'
import type { Request, Response, NextFunction } from 'express'
import { db } from './db'

export const ADMIN_COOKIE = 'cricket_admin_session'
export const SESSION_DAYS = 7

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'cricket-live-dev-secret-key-change-in-production'
  return new TextEncoder().encode(secret)
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
  let token: string | undefined = req.cookies?.[ADMIN_COOKIE]

  if (!token && req.headers.cookie) {
    const header = req.headers.cookie
    for (const part of header.split(';')) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      if (k === ADMIN_COOKIE) {
        token = decodeURIComponent(v)
        break
      }
    }
  }

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim()
  }

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

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<{ id: string; username: string } | null> {
  const admin = await db.admin.findUnique({ where: { username } })
  if (!admin) return null
  const ok = await import('bcryptjs').then((b) => b.compare(password, admin.passwordHash))
  if (!ok) return null
  return { id: admin.id, username: admin.username }
}
