"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketServer = initSocketServer;
const socket_io_1 = require("socket.io");
const broadcast_1 = require("./lib/broadcast");
function initSocketServer(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: process.env.CLIENT_URL || '*',
            methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });
    io.on('connection', (socket) => {
        socket.on('subscribe:match', (matchId) => {
            if (typeof matchId !== 'string' || !matchId)
                return;
            void socket.join(`match:${matchId}`);
        });
        socket.on('unsubscribe:match', (matchId) => {
            if (typeof matchId !== 'string' || !matchId)
                return;
            void socket.leave(`match:${matchId}`);
        });
        socket.on('subscribe:matches', () => {
            void socket.join('matches');
        });
        socket.on('unsubscribe:matches', () => {
            void socket.leave('matches');
        });
        socket.on('error', (error) => {
            console.error(`Socket error (${socket.id}):`, error);
        });
    });
    (0, broadcast_1.setSocketServer)(io);
    return io;
}
