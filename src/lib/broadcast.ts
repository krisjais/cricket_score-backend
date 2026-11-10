import type { Server } from 'socket.io'

let ioInstance: Server | null = null

export function setSocketServer(io: Server) {
  ioInstance = io
}

export function getSocketServer(): Server | null {
  return ioInstance
}

/** Emit an arbitrary event to a room directly through Socket.IO. */
export async function emitToRoom(room: string, event: string, data: unknown): Promise<void> {
  if (ioInstance) {
    ioInstance.to(room).emit(event, data ?? null)
  }
}
