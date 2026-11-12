"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../lib/auth");
const player_auth_1 = require("../lib/player-auth");
const db_1 = require("../lib/db");
const api_utils_1 = require("../lib/api-utils");
const router = (0, express_1.Router)();
async function issueAdminLoginSession(req, res, admin) {
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
    return { username: admin.username };
}
router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
        return (0, api_utils_1.sendFail)(res, 'Username and password are required');
    }
    const admin = await (0, auth_1.verifyAdminCredentials)(String(username).trim(), String(password));
    if (!admin) {
        return (0, api_utils_1.sendFail)(res, 'Invalid username or password', 401);
    }
    const adminPayload = await issueAdminLoginSession(req, res, admin);
    return (0, api_utils_1.sendOk)(res, adminPayload);
});
router.post('/unified-login', async (req, res) => {
    try {
        const body = req.body ?? {};
        const rawIdentifier = typeof body.identifier === 'string'
            ? body.identifier
            : typeof body.username === 'string'
                ? body.username
                : body.email || body.mobile || '';
        const identifier = String(rawIdentifier).trim();
        const password = typeof body.password === 'string' ? body.password : '';
        if (!identifier || !password) {
            return (0, api_utils_1.sendFail)(res, 'Email/mobile/username and password are required', 400);
        }
        await (0, db_1.connectDB)();
        const admin = await (0, auth_1.verifyAdminCredentials)(identifier, password);
        if (admin) {
            const adminPayload = await issueAdminLoginSession(req, res, admin);
            return (0, api_utils_1.sendOk)(res, {
                role: 'ADMIN',
                ...adminPayload,
            });
        }
        const playerResult = await (0, player_auth_1.authenticatePlayerCredentials)(identifier, password);
        if (!playerResult.ok) {
            return (0, api_utils_1.sendFail)(res, playerResult.error, playerResult.status);
        }
        const { user, player } = playerResult;
        user.lastLoginAt = new Date();
        await user.save();
        const { accessToken } = await (0, player_auth_1.issuePlayerAuthCookies)(res, user, player, req);
        return (0, api_utils_1.sendOk)(res, {
            role: 'PLAYER',
            user: (0, player_auth_1.sanitizePlayerUser)(user),
            player: player.toObject(),
            accessToken,
        });
    }
    catch (err) {
        return (0, api_utils_1.sendFail)(res, err?.message || 'Login failed', 500);
    }
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
