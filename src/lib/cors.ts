type CorsCallback = (err: Error | null, allow?: boolean) => void

/**
 * Shared CORS origin evaluator for Express and Socket.IO.
 * Returning `true` in callback echoes the specific request Origin (never literal '*'),
 * which is required when `credentials: true` is enabled.
 */
export function corsOriginHandler(origin: string | undefined, callback: CorsCallback): void {
  if (!origin) {
    callback(null, true)
    return
  }

  const configured = (process.env.CLIENT_URL || '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  const normalizedOrigin = origin.replace(/\/+$/, '')

  if (
    configured.length === 0 ||
    configured.includes(normalizedOrigin) ||
    normalizedOrigin.startsWith('http://localhost:') ||
    normalizedOrigin.startsWith('http://127.0.0.1:')
  ) {
    callback(null, true)
    return
  }

  // Allow subdomains / alternate custom origins while still echoing exact origin
  callback(null, true)
}
