"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.StatisticsAuditLog = exports.PlayerProfileClaim = exports.Award = exports.PlayerCareerStat = exports.PlayerMatchStat = exports.TeamMembership = exports.Tournament = exports.Season = exports.Counter = exports.RefreshToken = exports.OtpVerification = exports.User = exports.Ball = exports.Innings = exports.Match = exports.Player = exports.Team = exports.Admin = void 0;
exports.withMongoTransaction = withMongoTransaction;
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const models_1 = require("../models");
Object.defineProperty(exports, "Admin", { enumerable: true, get: function () { return models_1.Admin; } });
Object.defineProperty(exports, "Team", { enumerable: true, get: function () { return models_1.Team; } });
Object.defineProperty(exports, "Player", { enumerable: true, get: function () { return models_1.Player; } });
Object.defineProperty(exports, "Match", { enumerable: true, get: function () { return models_1.Match; } });
Object.defineProperty(exports, "Innings", { enumerable: true, get: function () { return models_1.Innings; } });
Object.defineProperty(exports, "Ball", { enumerable: true, get: function () { return models_1.Ball; } });
Object.defineProperty(exports, "User", { enumerable: true, get: function () { return models_1.User; } });
Object.defineProperty(exports, "OtpVerification", { enumerable: true, get: function () { return models_1.OtpVerification; } });
Object.defineProperty(exports, "RefreshToken", { enumerable: true, get: function () { return models_1.RefreshToken; } });
Object.defineProperty(exports, "Counter", { enumerable: true, get: function () { return models_1.Counter; } });
Object.defineProperty(exports, "Season", { enumerable: true, get: function () { return models_1.Season; } });
Object.defineProperty(exports, "Tournament", { enumerable: true, get: function () { return models_1.Tournament; } });
Object.defineProperty(exports, "TeamMembership", { enumerable: true, get: function () { return models_1.TeamMembership; } });
Object.defineProperty(exports, "PlayerMatchStat", { enumerable: true, get: function () { return models_1.PlayerMatchStat; } });
Object.defineProperty(exports, "PlayerCareerStat", { enumerable: true, get: function () { return models_1.PlayerCareerStat; } });
Object.defineProperty(exports, "Award", { enumerable: true, get: function () { return models_1.Award; } });
Object.defineProperty(exports, "PlayerProfileClaim", { enumerable: true, get: function () { return models_1.PlayerProfileClaim; } });
Object.defineProperty(exports, "StatisticsAuditLog", { enumerable: true, get: function () { return models_1.StatisticsAuditLog; } });
/**
 * Execute work inside a MongoDB multi-document transaction when supported (replica sets / Atlas),
 * falling back cleanly to direct execution if running against a standalone local mongod instance.
 */
async function withMongoTransaction(work) {
    await connectDB();
    const session = await mongoose_1.default.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    }
    catch (err) {
        const msg = String(err?.message || '');
        const code = err?.code;
        const unsupportedTx = code === 20 ||
            msg.includes('Transaction numbers are only allowed on a replica set') ||
            msg.includes('does not support transactions');
        if (unsupportedTx) {
            return work(null);
        }
        throw err;
    }
    finally {
        await session.endSession();
    }
}
function getMongoUri() {
    return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cricket_live';
}
let inFlightConnect = null;
function isTransientMongoError(error) {
    const err = error;
    if (!err)
        return false;
    if (err.syscall === 'querySrv' || err.code === 'ETIMEOUT' || err.code === 'EAI_AGAIN')
        return true;
    if (err.code === 'ESERVFAIL' || err.code === 'ECONNRESET')
        return true;
    return err.name === 'MongoServerSelectionError';
}
/**
 * Connect to MongoDB with in-flight deduplication and brief transient DNS/network retry.
 */
async function connectDB() {
    if (mongoose_1.default.connection.readyState >= 1) {
        return mongoose_1.default;
    }
    if (inFlightConnect) {
        return inFlightConnect;
    }
    const maxAttempts = 3;
    const uri = getMongoUri();
    inFlightConnect = (async () => {
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const conn = await mongoose_1.default.connect(uri, {
                    serverSelectionTimeoutMS: 10000,
                    connectTimeoutMS: 10000,
                });
                console.log(`> MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
                return conn;
            }
            catch (error) {
                lastError = error;
                if (attempt < maxAttempts && isTransientMongoError(error)) {
                    await new Promise((resolve) => setTimeout(resolve, attempt * 600));
                    continue;
                }
                break;
            }
        }
        const errObj = lastError;
        if (errObj?.syscall === 'querySrv' || errObj?.code === 'ETIMEOUT') {
            console.error('> MongoDB Connection Error: DNS SRV lookup timed out (querySrv ETIMEOUT). If your network/router blocks SRV DNS, switch system DNS to 1.1.1.1 / 8.8.8.8 or use the standard mongodb:// (non-SRV) URI from MongoDB Atlas.', lastError);
        }
        else {
            console.error('> MongoDB Connection Error:', lastError);
        }
        throw lastError;
    })();
    try {
        return await inFlightConnect;
    }
    finally {
        inFlightConnect = null;
    }
}
/**
 * Converts where clause into MongoDB query.
 */
function whereToMongo(where) {
    if (!where || typeof where !== 'object')
        return {};
    const mongo = {};
    for (const [k, v] of Object.entries(where)) {
        if (k === 'id') {
            if (v && typeof v === 'object' && 'in' in v) {
                mongo._id = { $in: v.in };
            }
            else {
                mongo._id = v;
            }
        }
        else if (k === 'OR' && Array.isArray(v)) {
            mongo.$or = v.map((clause) => whereToMongo(clause));
        }
        else if (k === 'AND' && Array.isArray(v)) {
            mongo.$and = v.map((clause) => whereToMongo(clause));
        }
        else if (k === 'matchId_number' && v && typeof v === 'object') {
            mongo.matchId = v.matchId;
            mongo.number = v.number;
        }
        else if (v && typeof v === 'object' && 'in' in v) {
            mongo[k] = { $in: v.in };
        }
        else {
            mongo[k] = v;
        }
    }
    return mongo;
}
/**
 * Converts orderBy clause into MongoDB sort object.
 */
function orderByToMongo(orderBy) {
    if (!orderBy)
        return {};
    if (Array.isArray(orderBy)) {
        const sort = {};
        for (const item of orderBy) {
            for (const [k, v] of Object.entries(item)) {
                sort[k === 'id' ? '_id' : k] = v === 'desc' ? -1 : 1;
            }
        }
        return sort;
    }
    const sort = {};
    for (const [k, v] of Object.entries(orderBy)) {
        sort[k === 'id' ? '_id' : k] = v === 'desc' ? -1 : 1;
    }
    return sort;
}
function toObj(doc) {
    if (!doc)
        return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    if (obj._id) {
        obj.id = String(obj._id);
    }
    delete obj.__v;
    return obj;
}
/**
 * MongoDB Data Layer providing compatibility and convenience methods
 */
exports.db = {
    $disconnect: async () => {
        if (mongoose_1.default.connection.readyState !== 0) {
            await mongoose_1.default.disconnect();
        }
    },
    admin: {
        count: async (args) => {
            await connectDB();
            return models_1.Admin.countDocuments(whereToMongo(args?.where));
        },
        findUnique: async (args) => {
            await connectDB();
            const doc = await models_1.Admin.findOne(whereToMongo(args.where));
            return toObj(doc);
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Admin.create(args.data);
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Admin.deleteMany(whereToMongo(args?.where));
            return { count: res.deletedCount };
        },
    },
    team: {
        count: async (args) => {
            await connectDB();
            return models_1.Team.countDocuments(whereToMongo(args?.where));
        },
        findMany: async (args) => {
            await connectDB();
            const query = models_1.Team.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy));
            const docs = await query.exec();
            const teams = docs.map(toObj);
            if (args?.include?.players) {
                const teamIds = teams.map((t) => t.id);
                const playerQuery = models_1.Player.find({ teamId: { $in: teamIds } });
                if (args.include.players.orderBy) {
                    playerQuery.sort(orderByToMongo(args.include.players.orderBy));
                }
                const players = (await playerQuery.exec()).map(toObj);
                const playerMap = new Map();
                for (const p of players) {
                    const list = playerMap.get(p.teamId) || [];
                    list.push(p);
                    playerMap.set(p.teamId, list);
                }
                for (const t of teams) {
                    t.players = playerMap.get(t.id) || [];
                }
            }
            return teams;
        },
        findUnique: async (args) => {
            await connectDB();
            const doc = await models_1.Team.findOne(whereToMongo(args.where));
            const team = toObj(doc);
            if (!team)
                return null;
            if (args.include?.players) {
                const playerQuery = models_1.Player.find({ teamId: team.id });
                if (args.include.players.orderBy) {
                    playerQuery.sort(orderByToMongo(args.include.players.orderBy));
                }
                team.players = (await playerQuery.exec()).map(toObj);
            }
            return team;
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Team.create(args.data);
            return toObj(doc);
        },
        update: async (args) => {
            await connectDB();
            const doc = await models_1.Team.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true });
            return toObj(doc);
        },
        delete: async (args) => {
            await connectDB();
            const doc = await models_1.Team.findOneAndDelete(whereToMongo(args.where));
            if (doc) {
                await models_1.Player.deleteMany({ teamId: doc._id });
            }
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Team.deleteMany(whereToMongo(args?.where));
            await models_1.Player.deleteMany({});
            return { count: res.deletedCount };
        },
    },
    player: {
        count: async (args) => {
            await connectDB();
            return models_1.Player.countDocuments(whereToMongo(args?.where));
        },
        findMany: async (args) => {
            await connectDB();
            const query = models_1.Player.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy));
            const docs = await query.exec();
            const players = docs.map(toObj);
            if (args?.include?.team) {
                const teamIds = [...new Set(players.map((p) => p.teamId).filter(Boolean))];
                const teams = (await models_1.Team.find({ _id: { $in: teamIds } }).exec()).map(toObj);
                const teamMap = new Map(teams.map((t) => [t.id, t]));
                for (const p of players) {
                    p.team = teamMap.get(p.teamId) || null;
                }
            }
            return players;
        },
        findUnique: async (args) => {
            await connectDB();
            const doc = await models_1.Player.findOne(whereToMongo(args.where));
            return toObj(doc);
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Player.create(args.data);
            return toObj(doc);
        },
        createMany: async (args) => {
            await connectDB();
            const docs = await models_1.Player.insertMany(args.data);
            return { count: docs.length };
        },
        update: async (args) => {
            await connectDB();
            const doc = await models_1.Player.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true });
            return toObj(doc);
        },
        delete: async (args) => {
            await connectDB();
            const doc = await models_1.Player.findOneAndDelete(whereToMongo(args.where));
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Player.deleteMany(whereToMongo(args?.where));
            return { count: res.deletedCount };
        },
    },
    match: {
        count: async (args) => {
            await connectDB();
            return models_1.Match.countDocuments(whereToMongo(args?.where));
        },
        findMany: async (args) => {
            await connectDB();
            const query = models_1.Match.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy));
            const docs = await query.exec();
            const matches = docs.map(toObj);
            if (args?.include?.innings) {
                const matchIds = matches.map((m) => m.id);
                const innings = (await models_1.Innings.find({ matchId: { $in: matchIds } }).sort({ number: 1 }).exec()).map(toObj);
                if (args.include.innings.include?.balls) {
                    const inningsIds = innings.map((i) => i.id);
                    const balls = (await models_1.Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj);
                    const ballMap = new Map();
                    for (const b of balls) {
                        const list = ballMap.get(b.inningsId) || [];
                        list.push(b);
                        ballMap.set(b.inningsId, list);
                    }
                    for (const inn of innings) {
                        inn.balls = ballMap.get(inn.id) || [];
                    }
                }
                const innMap = new Map();
                for (const inn of innings) {
                    const list = innMap.get(inn.matchId) || [];
                    list.push(inn);
                    innMap.set(inn.matchId, list);
                }
                for (const m of matches) {
                    m.innings = innMap.get(m.id) || [];
                }
            }
            return matches;
        },
        findUnique: async (args) => {
            await connectDB();
            const doc = await models_1.Match.findOne(whereToMongo(args.where));
            const match = toObj(doc);
            if (!match)
                return null;
            if (args.include?.innings) {
                const innings = (await models_1.Innings.find({ matchId: match.id }).sort({ number: 1 }).exec()).map(toObj);
                if (args.include.innings.include?.balls) {
                    const inningsIds = innings.map((i) => i.id);
                    const balls = (await models_1.Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj);
                    const ballMap = new Map();
                    for (const b of balls) {
                        const list = ballMap.get(b.inningsId) || [];
                        list.push(b);
                        ballMap.set(b.inningsId, list);
                    }
                    for (const inn of innings) {
                        inn.balls = ballMap.get(inn.id) || [];
                    }
                }
                match.innings = innings;
            }
            return match;
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Match.create(args.data);
            return toObj(doc);
        },
        update: async (args) => {
            await connectDB();
            const doc = await models_1.Match.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true });
            const match = toObj(doc);
            if (!match)
                return null;
            if (args.include?.innings) {
                const innings = (await models_1.Innings.find({ matchId: match.id }).sort({ number: 1 }).exec()).map(toObj);
                if (args.include.innings.include?.balls) {
                    const inningsIds = innings.map((i) => i.id);
                    const balls = (await models_1.Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj);
                    const ballMap = new Map();
                    for (const b of balls) {
                        const list = ballMap.get(b.inningsId) || [];
                        list.push(b);
                        ballMap.set(b.inningsId, list);
                    }
                    for (const inn of innings) {
                        inn.balls = ballMap.get(inn.id) || [];
                    }
                }
                match.innings = innings;
            }
            return match;
        },
        delete: async (args) => {
            await connectDB();
            const doc = await models_1.Match.findOneAndDelete(whereToMongo(args.where));
            if (doc) {
                const innings = await models_1.Innings.find({ matchId: doc._id });
                const innIds = innings.map((i) => i._id);
                await models_1.Innings.deleteMany({ matchId: doc._id });
                await models_1.Ball.deleteMany({ inningsId: { $in: innIds } });
            }
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Match.deleteMany(whereToMongo(args?.where));
            await models_1.Innings.deleteMany({});
            await models_1.Ball.deleteMany({});
            return { count: res.deletedCount };
        },
    },
    innings: {
        count: async (args) => {
            await connectDB();
            return models_1.Innings.countDocuments(whereToMongo(args?.where));
        },
        findMany: async (args) => {
            await connectDB();
            const query = models_1.Innings.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy));
            const docs = await query.exec();
            const innings = docs.map(toObj);
            if (args?.include?.match) {
                const matchIds = [...new Set(innings.map((i) => i.matchId))];
                const matches = (await models_1.Match.find({ _id: { $in: matchIds } }).exec()).map(toObj);
                const matchMap = new Map(matches.map((m) => [m.id, m]));
                for (const inn of innings) {
                    inn.match = matchMap.get(inn.matchId) || null;
                }
            }
            if (args?.include?.balls) {
                const innIds = innings.map((i) => i.id);
                const balls = (await models_1.Ball.find({ inningsId: { $in: innIds } }).sort({ sequence: 1 }).exec()).map(toObj);
                const ballMap = new Map();
                for (const b of balls) {
                    const list = ballMap.get(b.inningsId) || [];
                    list.push(b);
                    ballMap.set(b.inningsId, list);
                }
                for (const inn of innings) {
                    inn.balls = ballMap.get(inn.id) || [];
                }
            }
            return innings;
        },
        findUnique: async (args) => {
            await connectDB();
            const doc = await models_1.Innings.findOne(whereToMongo(args.where));
            const inn = toObj(doc);
            if (!inn)
                return null;
            if (args.include?.balls) {
                inn.balls = (await models_1.Ball.find({ inningsId: inn.id }).sort({ sequence: 1 }).exec()).map(toObj);
            }
            return inn;
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Innings.create(args.data);
            return toObj(doc);
        },
        update: async (args) => {
            await connectDB();
            const doc = await models_1.Innings.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true });
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Innings.deleteMany(whereToMongo(args?.where));
            return { count: res.deletedCount };
        },
    },
    ball: {
        count: async (args) => {
            await connectDB();
            return models_1.Ball.countDocuments(whereToMongo(args?.where));
        },
        findMany: async (args) => {
            await connectDB();
            const query = models_1.Ball.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy));
            const docs = await query.exec();
            return docs.map(toObj);
        },
        create: async (args) => {
            await connectDB();
            const doc = await models_1.Ball.create(args.data);
            return toObj(doc);
        },
        delete: async (args) => {
            await connectDB();
            const doc = await models_1.Ball.findOneAndDelete(whereToMongo(args.where));
            return toObj(doc);
        },
        deleteMany: async (args) => {
            await connectDB();
            const res = await models_1.Ball.deleteMany(whereToMongo(args?.where));
            return { count: res.deletedCount };
        },
    },
};
