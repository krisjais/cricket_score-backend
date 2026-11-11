import mongoose from 'mongoose'
import {
  Admin,
  Team,
  Player,
  Match,
  Innings,
  Ball,
  User,
  OtpVerification,
  RefreshToken,
  Counter,
  Season,
  Tournament,
  TeamMembership,
  PlayerMatchStat,
  PlayerCareerStat,
  Award,
  PlayerProfileClaim,
  StatisticsAuditLog,
} from '../models'

export {
  Admin,
  Team,
  Player,
  Match,
  Innings,
  Ball,
  User,
  OtpVerification,
  RefreshToken,
  Counter,
  Season,
  Tournament,
  TeamMembership,
  PlayerMatchStat,
  PlayerCareerStat,
  Award,
  PlayerProfileClaim,
  StatisticsAuditLog,
}

/**
 * Execute work inside a MongoDB multi-document transaction when supported (replica sets / Atlas),
 * falling back cleanly to direct execution if running against a standalone local mongod instance.
 */
export async function withMongoTransaction<T>(
  work: (session: mongoose.ClientSession | null) => Promise<T>
): Promise<T> {
  await connectDB()
  const session = await mongoose.startSession()
  try {
    let result!: T
    await session.withTransaction(async () => {
      result = await work(session)
    })
    return result
  } catch (err: any) {
    const msg = String(err?.message || '')
    const code = err?.code
    const unsupportedTx =
      code === 20 ||
      msg.includes('Transaction numbers are only allowed on a replica set') ||
      msg.includes('does not support transactions')
    if (unsupportedTx) {
      return work(null)
    }
    throw err
  } finally {
    await session.endSession()
  }
}

function getMongoUri(): string {
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cricket_live'
}

/**
 * Connect to MongoDB.
 */
export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState >= 1) {
    return mongoose
  }

  try {
    const conn = await mongoose.connect(getMongoUri())
    console.log(`> MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`)
    return conn
  } catch (error) {
    console.error('> MongoDB Connection Error:', error)
    throw error
  }
}

/**
 * Converts where clause into MongoDB query.
 */
function whereToMongo(where: any): any {
  if (!where || typeof where !== 'object') return {}
  const mongo: any = {}
  for (const [k, v] of Object.entries(where)) {
    if (k === 'id') {
      if (v && typeof v === 'object' && 'in' in v) {
        mongo._id = { $in: (v as any).in }
      } else {
        mongo._id = v
      }
    } else if (k === 'OR' && Array.isArray(v)) {
      mongo.$or = v.map((clause) => whereToMongo(clause))
    } else if (k === 'AND' && Array.isArray(v)) {
      mongo.$and = v.map((clause) => whereToMongo(clause))
    } else if (k === 'matchId_number' && v && typeof v === 'object') {
      mongo.matchId = (v as any).matchId
      mongo.number = (v as any).number
    } else if (v && typeof v === 'object' && 'in' in v) {
      mongo[k] = { $in: (v as any).in }
    } else {
      mongo[k] = v
    }
  }
  return mongo
}

/**
 * Converts orderBy clause into MongoDB sort object.
 */
function orderByToMongo(orderBy: any): any {
  if (!orderBy) return {}
  if (Array.isArray(orderBy)) {
    const sort: any = {}
    for (const item of orderBy) {
      for (const [k, v] of Object.entries(item)) {
        sort[k === 'id' ? '_id' : k] = v === 'desc' ? -1 : 1
      }
    }
    return sort
  }
  const sort: any = {}
  for (const [k, v] of Object.entries(orderBy)) {
    sort[k === 'id' ? '_id' : k] = v === 'desc' ? -1 : 1
  }
  return sort
}

function toObj(doc: any): any {
  if (!doc) return null
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  if (obj._id) {
    obj.id = String(obj._id)
  }
  delete obj.__v
  return obj
}

/**
 * MongoDB Data Layer providing compatibility and convenience methods
 */
export const db = {
  $disconnect: async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }
  },

  admin: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Admin.countDocuments(whereToMongo(args?.where))
    },
    findUnique: async (args: { where: any }) => {
      await connectDB()
      const doc = await Admin.findOne(whereToMongo(args.where))
      return toObj(doc)
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Admin.create(args.data)
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Admin.deleteMany(whereToMongo(args?.where))
      return { count: res.deletedCount }
    },
  },

  team: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Team.countDocuments(whereToMongo(args?.where))
    },
    findMany: async (args?: { where?: any; orderBy?: any; include?: any; select?: any }) => {
      await connectDB()
      const query = Team.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy))
      const docs = await query.exec()
      const teams = docs.map(toObj)

      if (args?.include?.players) {
        const teamIds = teams.map((t) => t.id)
        const playerQuery = Player.find({ teamId: { $in: teamIds } })
        if (args.include.players.orderBy) {
          playerQuery.sort(orderByToMongo(args.include.players.orderBy))
        }
        const players = (await playerQuery.exec()).map(toObj)
        const playerMap = new Map<string, any[]>()
        for (const p of players) {
          const list = playerMap.get(p.teamId) || []
          list.push(p)
          playerMap.set(p.teamId, list)
        }
        for (const t of teams) {
          t.players = playerMap.get(t.id) || []
        }
      }

      return teams
    },
    findUnique: async (args: { where: any; include?: any }) => {
      await connectDB()
      const doc = await Team.findOne(whereToMongo(args.where))
      const team = toObj(doc)
      if (!team) return null

      if (args.include?.players) {
        const playerQuery = Player.find({ teamId: team.id })
        if (args.include.players.orderBy) {
          playerQuery.sort(orderByToMongo(args.include.players.orderBy))
        }
        team.players = (await playerQuery.exec()).map(toObj)
      }

      return team
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Team.create(args.data)
      return toObj(doc)
    },
    update: async (args: { where: any; data: any }) => {
      await connectDB()
      const doc = await Team.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true })
      return toObj(doc)
    },
    delete: async (args: { where: any }) => {
      await connectDB()
      const doc = await Team.findOneAndDelete(whereToMongo(args.where))
      if (doc) {
        await Player.deleteMany({ teamId: doc._id })
      }
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Team.deleteMany(whereToMongo(args?.where))
      await Player.deleteMany({})
      return { count: res.deletedCount }
    },
  },

  player: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Player.countDocuments(whereToMongo(args?.where))
    },
    findMany: async (args?: { where?: any; orderBy?: any; include?: any }) => {
      await connectDB()
      const query = Player.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy))
      const docs = await query.exec()
      const players = docs.map(toObj)

      if (args?.include?.team) {
        const teamIds = [...new Set(players.map((p) => p.teamId).filter(Boolean))]
        const teams = (await Team.find({ _id: { $in: teamIds } }).exec()).map(toObj)
        const teamMap = new Map(teams.map((t) => [t.id, t]))
        for (const p of players) {
          p.team = teamMap.get(p.teamId) || null
        }
      }

      return players
    },
    findUnique: async (args: { where: any }) => {
      await connectDB()
      const doc = await Player.findOne(whereToMongo(args.where))
      return toObj(doc)
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Player.create(args.data)
      return toObj(doc)
    },
    createMany: async (args: { data: any[] }) => {
      await connectDB()
      const docs = await Player.insertMany(args.data)
      return { count: docs.length }
    },
    update: async (args: { where: any; data: any }) => {
      await connectDB()
      const doc = await Player.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true })
      return toObj(doc)
    },
    delete: async (args: { where: any }) => {
      await connectDB()
      const doc = await Player.findOneAndDelete(whereToMongo(args.where))
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Player.deleteMany(whereToMongo(args?.where))
      return { count: res.deletedCount }
    },
  },

  match: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Match.countDocuments(whereToMongo(args?.where))
    },
    findMany: async (args?: { where?: any; orderBy?: any; include?: any; select?: any }) => {
      await connectDB()
      const query = Match.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy))
      const docs = await query.exec()
      const matches = docs.map(toObj)

      if (args?.include?.innings) {
        const matchIds = matches.map((m) => m.id)
        const innings = (await Innings.find({ matchId: { $in: matchIds } }).sort({ number: 1 }).exec()).map(toObj)

        if (args.include.innings.include?.balls) {
          const inningsIds = innings.map((i) => i.id)
          const balls = (await Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj)
          const ballMap = new Map<string, any[]>()
          for (const b of balls) {
            const list = ballMap.get(b.inningsId) || []
            list.push(b)
            ballMap.set(b.inningsId, list)
          }
          for (const inn of innings) {
            inn.balls = ballMap.get(inn.id) || []
          }
        }

        const innMap = new Map<string, any[]>()
        for (const inn of innings) {
          const list = innMap.get(inn.matchId) || []
          list.push(inn)
          innMap.set(inn.matchId, list)
        }
        for (const m of matches) {
          m.innings = innMap.get(m.id) || []
        }
      }

      return matches
    },
    findUnique: async (args: { where: any; include?: any }) => {
      await connectDB()
      const doc = await Match.findOne(whereToMongo(args.where))
      const match = toObj(doc)
      if (!match) return null

      if (args.include?.innings) {
        const innings = (await Innings.find({ matchId: match.id }).sort({ number: 1 }).exec()).map(toObj)
        if (args.include.innings.include?.balls) {
          const inningsIds = innings.map((i) => i.id)
          const balls = (await Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj)
          const ballMap = new Map<string, any[]>()
          for (const b of balls) {
            const list = ballMap.get(b.inningsId) || []
            list.push(b)
            ballMap.set(b.inningsId, list)
          }
          for (const inn of innings) {
            inn.balls = ballMap.get(inn.id) || []
          }
        }
        match.innings = innings
      }

      return match
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Match.create(args.data)
      return toObj(doc)
    },
    update: async (args: { where: any; data: any; include?: any }) => {
      await connectDB()
      const doc = await Match.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true })
      const match = toObj(doc)
      if (!match) return null

      if (args.include?.innings) {
        const innings = (await Innings.find({ matchId: match.id }).sort({ number: 1 }).exec()).map(toObj)
        if (args.include.innings.include?.balls) {
          const inningsIds = innings.map((i) => i.id)
          const balls = (await Ball.find({ inningsId: { $in: inningsIds } }).sort({ sequence: 1 }).exec()).map(toObj)
          const ballMap = new Map<string, any[]>()
          for (const b of balls) {
            const list = ballMap.get(b.inningsId) || []
            list.push(b)
            ballMap.set(b.inningsId, list)
          }
          for (const inn of innings) {
            inn.balls = ballMap.get(inn.id) || []
          }
        }
        match.innings = innings
      }

      return match
    },
    delete: async (args: { where: any }) => {
      await connectDB()
      const doc = await Match.findOneAndDelete(whereToMongo(args.where))
      if (doc) {
        const innings = await Innings.find({ matchId: doc._id })
        const innIds = innings.map((i) => i._id)
        await Innings.deleteMany({ matchId: doc._id })
        await Ball.deleteMany({ inningsId: { $in: innIds } })
      }
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Match.deleteMany(whereToMongo(args?.where))
      await Innings.deleteMany({})
      await Ball.deleteMany({})
      return { count: res.deletedCount }
    },
  },

  innings: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Innings.countDocuments(whereToMongo(args?.where))
    },
    findMany: async (args?: { where?: any; orderBy?: any; include?: any }) => {
      await connectDB()
      const query = Innings.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy))
      const docs = await query.exec()
      const innings = docs.map(toObj)

      if (args?.include?.match) {
        const matchIds = [...new Set(innings.map((i) => i.matchId))]
        const matches = (await Match.find({ _id: { $in: matchIds } }).exec()).map(toObj)
        const matchMap = new Map(matches.map((m) => [m.id, m]))
        for (const inn of innings) {
          inn.match = matchMap.get(inn.matchId) || null
        }
      }

      if (args?.include?.balls) {
        const innIds = innings.map((i) => i.id)
        const balls = (await Ball.find({ inningsId: { $in: innIds } }).sort({ sequence: 1 }).exec()).map(toObj)
        const ballMap = new Map<string, any[]>()
        for (const b of balls) {
          const list = ballMap.get(b.inningsId) || []
          list.push(b)
          ballMap.set(b.inningsId, list)
        }
        for (const inn of innings) {
          inn.balls = ballMap.get(inn.id) || []
        }
      }

      return innings
    },
    findUnique: async (args: { where: any; include?: any }) => {
      await connectDB()
      const doc = await Innings.findOne(whereToMongo(args.where))
      const inn = toObj(doc)
      if (!inn) return null

      if (args.include?.balls) {
        inn.balls = (await Ball.find({ inningsId: inn.id }).sort({ sequence: 1 }).exec()).map(toObj)
      }

      return inn
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Innings.create(args.data)
      return toObj(doc)
    },
    update: async (args: { where: any; data: any }) => {
      await connectDB()
      const doc = await Innings.findOneAndUpdate(whereToMongo(args.where), { $set: args.data }, { new: true })
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Innings.deleteMany(whereToMongo(args?.where))
      return { count: res.deletedCount }
    },
  },

  ball: {
    count: async (args?: { where?: any }) => {
      await connectDB()
      return Ball.countDocuments(whereToMongo(args?.where))
    },
    findMany: async (args?: { where?: any; orderBy?: any }) => {
      await connectDB()
      const query = Ball.find(whereToMongo(args?.where)).sort(orderByToMongo(args?.orderBy))
      const docs = await query.exec()
      return docs.map(toObj)
    },
    create: async (args: { data: any }) => {
      await connectDB()
      const doc = await Ball.create(args.data)
      return toObj(doc)
    },
    delete: async (args: { where: any }) => {
      await connectDB()
      const doc = await Ball.findOneAndDelete(whereToMongo(args.where))
      return toObj(doc)
    },
    deleteMany: async (args?: { where?: any }) => {
      await connectDB()
      const res = await Ball.deleteMany(whereToMongo(args?.where))
      return { count: res.deletedCount }
    },
  },
}
