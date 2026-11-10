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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_DAYS = exports.ADMIN_COOKIE = void 0;
exports.createSessionToken = createSessionToken;
exports.getSession = getSession;
exports.requireAdmin = requireAdmin;
exports.adminMiddleware = adminMiddleware;
exports.verifyAdminCredentials = verifyAdminCredentials;
const jose_1 = require("jose");
const db_1 = require("./db");
exports.ADMIN_COOKIE = 'cricket_admin_session';
exports.SESSION_DAYS = 7;
function secretKey() {
    const secret = process.env.AUTH_SECRET || 'cricket-live-dev-secret-key-change-in-production';
    return new TextEncoder().encode(secret);
}
async function createSessionToken(adminId, username) {
    return new jose_1.SignJWT({ sub: adminId, username })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${exports.SESSION_DAYS}d`)
        .sign(secretKey());
}
async function getSession(req) {
    let token = req.cookies?.[exports.ADMIN_COOKIE];
    if (!token && req.headers.cookie) {
        const header = req.headers.cookie;
        for (const part of header.split(';')) {
            const idx = part.indexOf('=');
            if (idx === -1)
                continue;
            const k = part.slice(0, idx).trim();
            const v = part.slice(idx + 1).trim();
            if (k === exports.ADMIN_COOKIE) {
                token = decodeURIComponent(v);
                break;
            }
        }
    }
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7).trim();
    }
    if (!token)
        return null;
    try {
        const { payload } = await (0, jose_1.jwtVerify)(token, secretKey());
        if (!payload.sub || typeof payload.username !== 'string')
            return null;
        return { adminId: payload.sub, username: payload.username };
    }
    catch {
        return null;
    }
}
async function requireAdmin(req) {
    return getSession(req);
}
async function adminMiddleware(req, res, next) {
    const session = await getSession(req);
    if (!session) {
        res.status(401).json({ ok: false, error: 'Admin authentication required' });
        return;
    }
    ;
    req.admin = session;
    next();
}
async function verifyAdminCredentials(username, password) {
    const admin = await db_1.db.admin.findUnique({ where: { username } });
    if (!admin)
        return null;
    const ok = await Promise.resolve().then(() => __importStar(require('bcryptjs'))).then((b) => b.compare(password, admin.passwordHash));
    if (!ok)
        return null;
    return { id: admin.id, username: admin.username };
}
