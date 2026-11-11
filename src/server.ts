import './lib/env'
import http from 'http'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'

import { initSocketServer } from './socket'
import { connectDB } from './lib/db'
import { ensureDefaultAdmin } from './lib/auth'
import { ensurePlayerSystemBootstrap } from './lib/bootstrap'
import authRouter from './routes/auth'
import playerAuthRouter from './routes/player-auth'
import matchesRouter from './routes/matches'
import playersRouter from './routes/players'
import teamsRouter from './routes/teams'
import adminRouter from './routes/admin'
import awardsRouter from './routes/awards'
import standingsRouter from './routes/standings'
import seasonsRouter from './routes/seasons'
import tournamentsRouter from './routes/tournaments'
import membershipsRouter from './routes/memberships'
import leaderboardsRouter from './routes/leaderboards'

const app = express()
const server = http.createServer(app)

const PORT = process.env.PORT || 5000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000'

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin || origin === CLIENT_URL || origin.startsWith('http://localhost:')) {
        callback(null, true)
      } else {
        callback(null, true) // permissive for local dev
      }
    },
    credentials: true,
  })
)

app.use(cookieParser())
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Health check
app.get('/api', (_req, res) => {
  res.json({ ok: true, message: 'Cricket Live API is running' })
})

// Route modules
app.use('/api/auth', authRouter)
app.use('/api/player-auth', playerAuthRouter)
app.use('/api/matches', matchesRouter)
app.use('/api/players', playersRouter)
app.use('/api/teams', teamsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/awards', awardsRouter)
app.use('/api/standings', standingsRouter)
app.use('/api/seasons', seasonsRouter)
app.use('/api/tournaments', tournamentsRouter)
app.use('/api/memberships', membershipsRouter)
app.use('/api/leaderboards', leaderboardsRouter)

// Fallback 404
app.use('/api/*', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' })
})

// Initialize Socket.IO
initSocketServer(server)

async function start() {
  try {
    await connectDB()
    await ensureDefaultAdmin()
    await ensurePlayerSystemBootstrap()
  } catch (err) {
    console.warn('> Warning: MongoDB connection failed on start. Queries will retry on demand.')
  }

  server.listen(PORT, () => {
    console.log(`> Cricket Live Backend Server running on http://localhost:${PORT}`)
    console.log(`> WebSocket server ready on ws://localhost:${PORT}`)
  })
}

start()

// Graceful shutdown
const shutdown = async () => {
  const { db } = await import('./lib/db')
  await db.$disconnect()
  server.close(() => {
    console.log('Server shut down gracefully')
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
