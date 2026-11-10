"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../lib/auth");
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
    res.clearCookie(auth_1.ADMIN_COOKIE, { path: '/' });
    return (0, api_utils_1.sendOk)(res, { loggedOut: true });
});
router.get('/me', async (req, res) => {
    const session = await (0, auth_1.getSession)(req);
    return (0, api_utils_1.sendOk)(res, { isAdmin: !!session, username: session?.username ?? null });
});
exports.default = router;
