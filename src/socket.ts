import type { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { setSocketServer } from './lib/broadcast'
import { corsOriginHandler } from './lib/cors'

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOriginHandler,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  io.on('connection', (socket: Socket) => {
    socket.on('subscribe:match', (matchId: string) => {
      if (typeof matchId !== 'string' || !matchId) return
      void socket.join(`match:${matchId}`)
    })

    socket.on('unsubscribe:match', (matchId: string) => {
      if (typeof matchId !== 'string' || !matchId) return
      void socket.leave(`match:${matchId}`)
    })

    socket.on('subscribe:matches', () => {
      void socket.join('matches')
    })

    socket.on('unsubscribe:matches', () => {
      void socket.leave('matches')
    })

    socket.on('subscribe:player', (playerId: string) => {
      if (typeof playerId !== 'string' || !playerId) return
      void socket.join(`player:${playerId}`)
    })

    socket.on('unsubscribe:player', (playerId: string) => {
      if (typeof playerId !== 'string' || !playerId) return
      void socket.leave(`player:${playerId}`)
    })

    socket.on('error', (error) => {
      console.error(`Socket error (${socket.id}):`, error)
    })
  })

  setSocketServer(io)
  return io
}
