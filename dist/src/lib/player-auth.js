"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_REFRESH_DAYS = exports.PLAYER_ACCESS_TTL = exports.PLAYER_REFRESH_COOKIE = exports.PLAYER_ACCESS_COOKIE = void 0;
exports.normalizeEmail = normalizeEmail;
exports.normalizeMobile = normalizeMobile;
exports.isValidEmail = isValidEmail;
exports.isValidMobile = isValidMobile;
exports.maskTarget = maskTarget;
exports.sha256 = sha256;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.validatePasswordStrength = validatePasswordStrength;
exports.createOtpChallenge = createOtpChallenge;
exports.verifyOtpChallenge = verifyOtpChallenge;
exports.createOtpProofToken = createOtpProofToken;
exports.verifyOtpProofToken = verifyOtpProofToken;
exports.createPlayerAccessToken = createPlayerAccessToken;
exports.issuePlayerAuthCookies = issuePlayerAuthCookies;
exports.clearPlayerAuthCookies = clearPlayerAuthCookies;
exports.getPlayerSession = getPlayerSession;
exports.requirePlayer = requirePlayer;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = require("crypto");
const jose_1 = require("jose");
const db_1 = require("./db");
const auth_1 = require("./auth");
exports.PLAYER_ACCESS_COOKIE = 'cricket_player_access';
exports.PLAYER_REFRESH_COOKIE = 'cricket_player_refresh';
exports.PLAYER_ACCESS_TTL = '2h';
exports.PLAYER_REFRESH_DAYS = 30;
function normalizeEmail(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    const trimmed = raw.trim().toLowerCase();
    return trimmed || null;
}
function normalizeMobile(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    const stripped = raw.trim().replace(/[\s\-()]/g, '');
    if (!stripped)
        return null;
    return stripped.startsWith('+') ? `+${stripped.slice(1).replace(/\D/g, '')}` : stripped.replace(/\D/g, '');
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidMobile(mobile) {
    const digits = mobile.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
}
function maskTarget(channel, target) {
    if (channel === 'EMAIL') {
        const [local, domain] = target.split('@');
        if (!domain)
            return '***';
        return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }
    return `${'*'.repeat(Math.max(0, target.length - 4))}${target.slice(-4)}`;
}
function sha256(val) {
    return (0, crypto_1.createHash)('sha256').update(val).digest('hex');
}
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 10);
}
async function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
function validatePasswordStrength(password) {
    if (typeof password !== 'string' || password.length < 8) {
        return 'Password must be at least 8 characters long';
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'Password must include at least one letter and one number';
    }
    return null;
}
async function sendOtpEmailViaResend(opts) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey)
        throw new Error('RESEND_API_KEY is not configured');
    const from = (process.env.EMAIL_FROM || 'Cricket Portal <onboarding@resend.dev>').trim();
    const purposeLabel = opts.purpose === 'RESET_PASSWORD'
        ? 'Password Reset Verification'
        : opts.purpose === 'CLAIM_PROFILE'
            ? 'Player Profile Claim Verification'
            : opts.purpose === 'VERIFY_EMAIL'
                ? 'Email Verification'
                : 'Player Registration Verification';
    const subject = `${opts.code} is your ${purposeLabel} Code — Cricket Portal`;
    const promptText = opts.purpose === 'RESET_PASSWORD'
        ? 'Enter the 6-digit verification code below to reset your Cricket Portal password:'
        : 'Enter the 6-digit verification code below to verify your email address:';
    const text = [
        `Your Cricket Portal verification code is: ${opts.code}`,
        '',
        `Purpose: ${purposeLabel}`,
        'This code expires in 10 minutes. Do not share this code with anyone.',
    ].join('\n');
    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #E5E7EB; border-radius: 16px; overflow: hidden; background: #ffffff;">
      <div style="background: #121826; padding: 20px 24px; color: #ffffff;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #FBBF24;">Cricket Portal</div>
        <h1 style="margin: 6px 0 0; font-size: 18px; font-weight: 800; color: #ffffff;">${purposeLabel}</h1>
      </div>
      <div style="padding: 24px; color: #111827;">
        <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: #374151;">
          ${promptText}
        </p>
        <div style="margin: 18px 0; padding: 14px 20px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; font-weight: 800; letter-spacing: 0.3em; color: #7A1426;">
          ${opts.code}
        </div>
        <p style="margin: 0; font-size: 12px; color: #6B7280;">
          This code is valid for <strong>10 minutes</strong>. If you did not request this code, you can safely ignore this email.
        </p>
      </div>
    </div>
  `.trim();
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [opts.to],
            subject,
            text,
            html,
        }),
    });
    const payload = (await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(payload?.message || `Resend email request failed with HTTP ${res.status}`);
    }
    return { id: payload?.id ?? null };
}
async function createOtpChallenge(opts) {
    if (opts.purpose === 'RESET_PASSWORD' && opts.channel !== 'EMAIL') {
        throw new Error('Password reset OTP can only be sent to your email inbox.');
    }
    const code = String((0, crypto_1.randomInt)(100000, 1000000));
    const now = new Date();
    // Cooldown guard: prevent rapid flooding inside 15s unless different target
    const recent = await db_1.OtpVerification.findOne({
        channel: opts.channel,
        target: opts.target,
        purpose: opts.purpose,
        consumedAt: null,
        createdAt: { $gte: new Date(now.getTime() - 15 * 1000) },
    }).lean();
    if (recent) {
        throw new Error('Please wait a few seconds before requesting another verification code.');
    }
    const isSyntheticTestEmail = opts.channel === 'EMAIL' && /@(test\.local|localhost)$/i.test(opts.target.trim());
    if (opts.purpose === 'RESET_PASSWORD' && !isSyntheticTestEmail && !process.env.RESEND_API_KEY?.trim()) {
        throw new Error('Email delivery service is not configured for password reset.');
    }
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const otpDoc = await db_1.OtpVerification.create({
        channel: opts.channel,
        target: opts.target,
        purpose: opts.purpose,
        codeHash: sha256(`${opts.channel}:${opts.target}:${opts.purpose}:${code}`),
        expiresAt,
        attempts: 0,
        consumedAt: null,
        userId: opts.userId ?? null,
        createdAt: now,
    });
    let deliveryProvider = 'console';
    if (opts.channel === 'EMAIL' && process.env.RESEND_API_KEY?.trim() && !isSyntheticTestEmail) {
        try {
            const delivered = await sendOtpEmailViaResend({
                to: opts.target,
                code,
                purpose: opts.purpose,
            });
            deliveryProvider = 'resend';
            console.log(`[OTP:${opts.purpose}] Resend email sent -> ${maskTarget('EMAIL', opts.target)} (id=${delivered.id ?? 'ok'})`);
        }
        catch (err) {
            await db_1.OtpVerification.deleteOne({ _id: otpDoc._id });
            const msg = err?.message || 'Failed to deliver OTP via Resend';
            console.error(`[OTP:${opts.purpose}] Resend delivery failed for ${maskTarget('EMAIL', opts.target)}:`, msg);
            throw new Error(`Email delivery failed: ${msg}`);
        }
    }
    else if (process.env.OTP_WEBHOOK_URL) {
        try {
            await fetch(process.env.OTP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    channel: opts.channel,
                    target: opts.target,
                    purpose: opts.purpose,
                    code,
                }),
            });
            deliveryProvider = 'webhook';
        }
        catch (err) {
            console.warn('> OTP webhook delivery failed:', err?.message);
        }
    }
    else if (opts.purpose !== 'RESET_PASSWORD' || isSyntheticTestEmail) {
        console.log(`[OTP:${opts.purpose}] ${opts.channel} -> ${opts.target} | code=${code}`);
    }
    // Password reset OTPs for real addresses are strictly inbox-only and never returned in the API payload.
    const exposeDevOtp = opts.purpose === 'RESET_PASSWORD'
        ? isSyntheticTestEmail && process.env.NODE_ENV !== 'production'
        : process.env.ALLOW_DEV_OTP_PREVIEW === 'true' ||
            (deliveryProvider === 'console' && process.env.NODE_ENV !== 'production');
    return {
        sent: true,
        channel: opts.channel,
        maskedTarget: maskTarget(opts.channel, opts.target),
        expiresInSeconds: 600,
        deliveryProvider,
        ...(exposeDevOtp ? { devOtp: code } : {}),
    };
}
async function verifyOtpChallenge(opts) {
    const latest = await db_1.OtpVerification.findOne({
        channel: opts.channel,
        target: opts.target,
        purpose: opts.purpose,
        consumedAt: null,
    }).sort({ createdAt: -1 });
    if (!latest) {
        return { ok: false, error: 'No active verification code found. Please request a new OTP.' };
    }
    if (latest.expiresAt.getTime() < Date.now()) {
        return { ok: false, error: 'Verification code has expired. Please request a new OTP.' };
    }
    if (latest.attempts >= 5) {
        return { ok: false, error: 'Too many invalid OTP attempts. Please request a new OTP.' };
    }
    const expectedHash = sha256(`${opts.channel}:${opts.target}:${opts.purpose}:${opts.code.trim()}`);
    if (latest.codeHash !== expectedHash) {
        latest.attempts += 1;
        await latest.save();
        return { ok: false, error: 'Invalid verification code.' };
    }
    latest.consumedAt = new Date();
    await latest.save();
    return { ok: true };
}
async function createOtpProofToken(opts) {
    return new jose_1.SignJWT({
        kind: 'otp_proof',
        channel: opts.channel,
        target: opts.target,
        purpose: opts.purpose,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign((0, auth_1.secretKey)());
}
async function verifyOtpProofToken(token, expectedPurpose) {
    try {
        const { payload } = await (0, jose_1.jwtVerify)(token, (0, auth_1.secretKey)());
        if (payload.kind !== 'otp_proof')
            return null;
        if (expectedPurpose && payload.purpose !== expectedPurpose)
            return null;
        if ((payload.channel === 'EMAIL' || payload.channel === 'MOBILE') &&
            typeof payload.target === 'string' &&
            typeof payload.purpose === 'string') {
            return {
                channel: payload.channel,
                target: payload.target,
                purpose: payload.purpose,
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
async function createPlayerAccessToken(session) {
    return new jose_1.SignJWT({
        kind: 'player_access',
        sub: session.userId,
        playerId: session.playerId,
        playerCode: session.playerCode,
        role: session.role,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(exports.PLAYER_ACCESS_TTL)
        .sign((0, auth_1.secretKey)());
}
async function issuePlayerAuthCookies(res, user, player, req) {
    const accessToken = await createPlayerAccessToken({
        userId: user._id,
        playerId: player._id,
        playerCode: player.playerCode,
        role: user.role,
    });
    const rawRefresh = (0, crypto_1.randomBytes)(48).toString('hex');
    const refreshExpires = new Date(Date.now() + exports.PLAYER_REFRESH_DAYS * 24 * 60 * 60 * 1000);
    await db_1.RefreshToken.create({
        userId: user._id,
        tokenHash: sha256(rawRefresh),
        expiresAt: refreshExpires,
        revokedAt: null,
        userAgent: req?.headers['user-agent']?.slice(0, 240) ?? null,
    });
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOpts = {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
    };
    (0, auth_1.clearAdminSessionCookie)(res);
    res.cookie(exports.PLAYER_ACCESS_COOKIE, accessToken, {
        ...cookieOpts,
        maxAge: 2 * 60 * 60 * 1000,
    });
    res.cookie(exports.PLAYER_REFRESH_COOKIE, rawRefresh, {
        ...cookieOpts,
        maxAge: exports.PLAYER_REFRESH_DAYS * 24 * 60 * 60 * 1000,
    });
    return { accessToken };
}
function clearPlayerAuthCookies(res) {
    const isProd = process.env.NODE_ENV === 'production';
    const opts = { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' };
    res.clearCookie(exports.PLAYER_ACCESS_COOKIE, opts);
    res.clearCookie(exports.PLAYER_REFRESH_COOKIE, opts);
}
async function getPlayerSession(req) {
    const token = (0, auth_1.extractTokenFromRequest)(req, exports.PLAYER_ACCESS_COOKIE);
    if (!token)
        return null;
    try {
        const { payload } = await (0, jose_1.jwtVerify)(token, (0, auth_1.secretKey)());
        if (payload.kind !== 'player_access' || !payload.sub || typeof payload.playerId !== 'string') {
            return null;
        }
        return {
            userId: payload.sub,
            playerId: payload.playerId,
            playerCode: typeof payload.playerCode === 'string' ? payload.playerCode : null,
            role: payload.role === 'ADMIN' ? 'ADMIN' : 'PLAYER',
        };
    }
    catch {
        return null;
    }
}
async function requirePlayer(req) {
    const sess = await getPlayerSession(req);
    if (!sess)
        return null;
    const [user, player] = await Promise.all([
        db_1.User.findById(sess.userId).select({ _id: 1, isActive: 1, playerId: 1 }).lean(),
        db_1.Player.findById(sess.playerId).select({ _id: 1, status: 1, playerCode: 1 }).lean(),
    ]);
    if (!user || !user.isActive || !player || player.status === 'MERGED')
        return null;
    return {
        ...sess,
        playerCode: player.playerCode ?? sess.playerCode,
    };
}
