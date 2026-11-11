import '../src/lib/env'

import { db, connectDB } from '../src/lib/db'

async function main() {
  await connectDB()
  const [admins, teams, players, matches, innings, balls] = await Promise.all([
    db.admin.count(),
    db.team.count(),
    db.player.count(),
    db.match.count(),
    db.innings.count(),
    db.ball.count(),
  ])
  console.log({ admins, teams, players, matches, innings, balls })
  const ms = await db.match.findMany({ select: { id: true, status: true, format: true, currentInnings: true } })
  console.log(JSON.stringify(ms))
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
