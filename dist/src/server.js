"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./lib/env");
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const socket_1 = require("./socket");
const db_1 = require("./lib/db");
const auth_1 = require("./lib/auth");
const bootstrap_1 = require("./lib/bootstrap");
const cors_2 = require("./lib/cors");
const auth_2 = __importDefault(require("./routes/auth"));
const player_auth_1 = __importDefault(require("./routes/player-auth"));
const matches_1 = __importDefault(require("./routes/matches"));
const players_1 = __importDefault(require("./routes/players"));
const teams_1 = __importDefault(require("./routes/teams"));
const admin_1 = __importDefault(require("./routes/admin"));
const awards_1 = __importDefault(require("./routes/awards"));
const standings_1 = __importDefault(require("./routes/standings"));
const seasons_1 = __importDefault(require("./routes/seasons"));
const tournaments_1 = __importDefault(require("./routes/tournaments"));
const memberships_1 = __importDefault(require("./routes/memberships"));
const leaderboards_1 = __importDefault(require("./routes/leaderboards"));
const app = (0, express_1.default)();
app.set('trust proxy', 1);
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 5000;
// Middleware
app.use((0, cors_1.default)({
    origin: cors_2.corsOriginHandler,
    credentials: true,
}));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json({ limit: '5mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Health check
app.get('/api', (_req, res) => {
    res.json({ ok: true, message: 'Cricket Live API is running' });
});
// Route modules
app.use('/api/auth', auth_2.default);
app.use('/api/player-auth', player_auth_1.default);
app.use('/api/matches', matches_1.default);
app.use('/api/players', players_1.default);
app.use('/api/teams', teams_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/awards', awards_1.default);
app.use('/api/standings', standings_1.default);
app.use('/api/seasons', seasons_1.default);
app.use('/api/tournaments', tournaments_1.default);
app.use('/api/memberships', memberships_1.default);
app.use('/api/leaderboards', leaderboards_1.default);
// Fallback 404
app.use('/api/*', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint not found' });
});
// Initialize Socket.IO
(0, socket_1.initSocketServer)(server);
async function start() {
    try {
        await (0, db_1.connectDB)();
        await (0, auth_1.ensureDefaultAdmin)();
        await (0, bootstrap_1.ensurePlayerSystemBootstrap)();
    }
    catch (err) {
        console.warn('> Warning: MongoDB connection failed on start. Queries will retry on demand.');
    }
    server.listen(PORT, () => {
        console.log(`> Cricket Live Backend Server running on http://localhost:${PORT}`);
        console.log(`> WebSocket server ready on ws://localhost:${PORT}`);
    });
}
start();
// Graceful shutdown
const shutdown = async () => {
    const { db } = await Promise.resolve().then(() => __importStar(require('./lib/db')));
    await db.$disconnect();
    server.close(() => {
        console.log('Server shut down gracefully');
        process.exit(0);
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
