"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSocketServer = setSocketServer;
exports.getSocketServer = getSocketServer;
exports.emitToRoom = emitToRoom;
let ioInstance = null;
function setSocketServer(io) {
    ioInstance = io;
}
function getSocketServer() {
    return ioInstance;
}
/** Emit an arbitrary event to a room directly through Socket.IO. */
async function emitToRoom(room, event, data) {
    if (ioInstance) {
        ioInstance.to(room).emit(event, data ?? null);
    }
}
