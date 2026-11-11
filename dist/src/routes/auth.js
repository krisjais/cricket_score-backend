"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../lib/auth");
const player_auth_1 = require("../lib/player-auth");
const db_1 = require("../lib/db");
const api_utils_1 = require("../lib/api-utils");
const router = (0, express_1.Router)();
router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
        return (0, api_utils_1.sendFail)(res, 'Username and password are required');
    }
    const admin = await (0, auth_1.verifyAdminCredentials)(String(username).trim(), String(password));
    if (!admin) {
        return (0, api_utils_1.sendFail)(res, 'Invalid username or password', 401);
    }
    // Enforce single active role per browser: revoke & clear any player session when signing in as Admin
    const rawRefresh = req.cookies?.[player_auth_1.PLAYER_REFRESH_COOKIE];
    if (rawRefresh) {
        await (0, db_1.connectDB)();
        await db_1.RefreshToken.updateOne({ tokenHash: (0, player_auth_1.sha256)(rawRefresh) }, { $set: { revokedAt: new Date() } }).catch(() => undefined);
    }
    (0, player_auth_1.clearPlayerAuthCookies)(res);
    const token = await (0, auth_1.createSessionToken)(admin.id, admin.username);
    res.cookie(auth_1.ADMIN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: auth_1.SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
    return (0, api_utils_1.sendOk)(res, { username: admin.username });
});
router.post('/logout', (_req, res) => {
    (0, auth_1.clearAdminSessionCookie)(res);
    return (0, api_utils_1.sendOk)(res, { loggedOut: true });
});
router.get('/me', async (req, res) => {
    const session = await (0, auth_1.getSession)(req);
    if (!session && req.cookies?.[auth_1.ADMIN_COOKIE]) {
        (0, auth_1.clearAdminSessionCookie)(res);
    }
    return (0, api_utils_1.sendOk)(res, { isAdmin: !!session, username: session?.username ?? null });
});
exports.default = router;
