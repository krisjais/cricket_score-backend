"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOk = sendOk;
exports.sendFail = sendFail;
exports.unauthorized = unauthorized;
function sendOk(res, data, status = 200) {
    return res.status(status).json({ ok: true, data });
}
function sendFail(res, error, status = 400) {
    return res.status(status).json({ ok: false, error });
}
function unauthorized(res, message = 'Admin authentication required') {
    return sendFail(res, message, 401);
}
