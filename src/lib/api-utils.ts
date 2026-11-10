import type { Response } from 'express'

export function sendOk(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ ok: true, data })
}

export function sendFail(res: Response, error: string, status = 400) {
  return res.status(status).json({ ok: false, error })
}

export function unauthorized(res: Response, message = 'Admin authentication required') {
  return sendFail(res, message, 401)
}
