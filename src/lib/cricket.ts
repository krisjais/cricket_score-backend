/**
 * Cricket scoring engine — pure functions, no DB access.
 * ALL scorecard data is derived from event-sourced Ball rows so that
 * stats are always accurate and undo is trivially consistent.
 *
 * Rules implemented (standard cricket scoring):
 * - Legal deliveries: normal runs, byes, leg-byes. Wides & no-balls are illegal (re-bowled).
 * - Wide: 1 penalty run + any additional runs run; never counted as ball faced.
 * - No-ball: 1 penalty run + runs off bat; counts as ball faced, not as legal ball.
 * - Byes/leg-byes: legal ball, runs do NOT go to the batter (still a ball faced).
 * - Bowler concedes: runs off bat + wides + no-ball penalties (NOT byes/leg-byes).
 * - Strike rotates on odd runs (incl. run extras); ends swap at over completion.
 * - Bowler credited with wicket: bowled, caught, caught & bowled, lbw, stumped, hit wicket.
 *   Run outs are not credited to the bowler.
 * - Maiden over: a full over (6 legal balls) in which the bowler conceded 0 runs.
 * - Innings ends when overs complete OR batting side is all out (players - 1 wickets).
 */

export type ExtraType = 'WIDE' | 'NO_BALL' | 'BYE' | 'LEG_BYE'
export type WicketType =
  | 'BOWLED'
  | 'CAUGHT'
  | 'CAUGHT_AND_BOWLED'
  | 'LBW'
  | 'RUN_OUT'
  | 'STUMPED'
  | 'HIT_WICKET'
  | 'RETIRED_HURT'
  | 'RETIRED_OUT'
  | 'ABSENT'
  | 'OBSTRUCTING_FIELD'
export type MatchFormat = 'T10' | 'T20' | 'ODI' | 'CUSTOM'

export const FORMAT_OVERS: Record<string, number> = { T10: 10, T20: 20, ODI: 50 }

export const PLAYER_ROLES = ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'] as const

export const WICKET_TYPES: WicketType[] = [
  'BOWLED',
  'CAUGHT',
  'CAUGHT_AND_BOWLED',
  'LBW',
  'RUN_OUT',
  'STUMPED',
  'HIT_WICKET',
  'RETIRED_HURT',
  'RETIRED_OUT',
  'ABSENT',
  'OBSTRUCTING_FIELD',
]

// Wicket types credited to the bowler (run-outs, hit wickets & retirements excluded per tournament rules)
export const BOWLER_CREDITED = new Set([
  'BOWLED',
  'CAUGHT',
  'CAUGHT_AND_BOWLED',
  'LBW',
  'STUMPED',
])

const WIDE_ALLOWED_WICKETS = new Set<WicketType>(['STUMPED', 'RUN_OUT', 'HIT_WICKET'])

export interface BallData {
  id: string
  sequence: number
  overNumber: number
  strikerId: string
  nonStrikerId: string
  bowlerId: string
  runsOffBat: number
  extraType: ExtraType | null
  extraRuns: number
  isLegal: boolean
  isWicket: boolean
  wicketType: string | null
  dismissedId: string | null
  assistId: string | null
  createdAt: string
}

export interface PlayerLite {
  id: string
  playerCode?: string | null
  name: string
  jerseyNumber: number | null
  role: string
}

export interface BallEventInput {
  runsOffBat: number
  extraType: ExtraType | null
  extraRuns: number
  wicketType?: WicketType | null
  dismissedId?: string | null
  assistId?: string | null
}

/** Validate a delivery before persisting. Returns an error message or null. */
export function validateBallInput(input: BallEventInput): string | null {
  const bat = input.runsOffBat ?? 0
  const extra = input.extraRuns ?? 0
  if (!Number.isInteger(bat) || bat < 0 || bat > 6)
    return 'Runs off bat must be an integer between 0 and 6'
  const type = input.extraType
  if (type === null) {
    if (extra !== 0) return 'Extras must be 0 for a normal delivery'
  } else if (type === 'WIDE') {
    if (bat !== 0) return 'Runs off bat are not possible on a wide'
    if (!Number.isInteger(extra) || extra < 1 || extra > 7)
      return 'Wide extras (incl. 1 penalty) must be between 1 and 7'
  } else if (type === 'NO_BALL') {
    if (!Number.isInteger(extra) || extra !== 1)
      return 'No-ball extra must be exactly 1 penalty run (runs off bat recorded separately)'
  } else if (type === 'BYE' || type === 'LEG_BYE') {
    if (bat !== 0) return 'Batter cannot score off-bat runs on a bye/leg-bye'
    if (!Number.isInteger(extra) || extra < 1 || extra > 4)
      return 'Byes/leg-byes must be between 1 and 4'
  } else {
    return 'Invalid extra type'
  }
  if (input.wicketType) {
    if (!WICKET_TYPES.includes(input.wicketType)) return 'Invalid wicket type'
    if (type === 'WIDE' && !WIDE_ALLOWED_WICKETS.has(input.wicketType))
      return 'Only Stump Out, Run Out, or Hit Wicket is possible on a wide ball'
    if (type === 'NO_BALL' && input.wicketType !== 'RUN_OUT')
      return 'Only a run out is possible on a no ball'
    if (bat > 0 && input.wicketType !== 'HIT_WICKET' && input.wicketType !== 'RUN_OUT')
      return 'Runs off bat are only possible on Hit Wicket or Run Out'
  }
  return null
}

export function teamRunsOf(b: Pick<BallData, 'runsOffBat' | 'extraRuns'>): number {
  return b.runsOffBat + b.extraRuns
}

/** Runs physically run by the batsmen on this delivery (for strike rotation). */
export function runsRunByBatsmen(b: BallData): number {
  if (b.extraType === 'WIDE') return b.extraRuns - 1
  if (b.extraType === 'NO_BALL') return b.runsOffBat + b.extraRuns - 1
  if (b.extraType === 'BYE' || b.extraType === 'LEG_BYE') return b.extraRuns
  return b.runsOffBat
}

/** Does the delivery rotate the strike (odd runs run)? */
export function rotatesStrike(b: BallData): boolean {
  return runsRunByBatsmen(b) % 2 === 1
}

/** Overs display: legal balls -> "12.3" */
export function oversStr(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`
}

export function isLegalBall(b: Pick<BallData, 'extraType'>): boolean {
  return b.extraType !== 'WIDE' && b.extraType !== 'NO_BALL'
}

// ---------------------------------------------------------------------------
// Scorecard computation
// ---------------------------------------------------------------------------

export interface BatterCard {
  id: string
  playerCode?: string | null
  name: string
  jerseyNumber: number | null
  role: string
  runs: number
  balls: number
  fours: number
  sixes: number
  strikeRate: number
  out: boolean
  dismissalText: string | null
  batted: boolean
  isOnStrike: boolean
  atCrease: boolean
}

export interface BowlerCard {
  id: string
  playerCode?: string | null
  name: string
  legalBalls: number
  overs: string
  runsConceded: number
  wickets: number
  maidens: number
  dots: number
  wides: number
  noBalls: number
  economy: number
}

export interface TimelineBall {
  label: string
  kind: 'W' | '4' | '6' | 'run' | 'dot' | 'extra'
  runs: number
}

export interface OverSummary {
  over: number // 1-based display number
  bowlerId: string
  bowlerName: string
  runs: number
  wickets: number
  balls: TimelineBall[]
}

export interface CommentaryItem {
  sequence: number
  overDisplay: string
  text: string
  kind: TimelineBall['kind']
  runs: number
}

export interface FowEntry {
  wicket: number
  runs: number
  over: string
  batsmanName: string
}

export interface LiveInningsState {
  strikerId: string | null
  nonStrikerId: string | null
  bowlerId: string | null
  needsNewBatsman: 'STRIKER' | 'NON_STRIKER' | null
  overComplete: boolean // current over finished -> new bowler required
  lastOverBowlerId: string | null
}

export interface InningsStats {
  number: number
  inningsId: string
  battingTeamId: string
  bowlingTeamId: string
  status: string
  runs: number
  wickets: number
  legalBalls: number
  totalDeliveries: number
  oversDisplay: string
  extras: { wides: number; noBalls: number; byes: number; legByes: number; total: number }
  runRate: number
  batting: BatterCard[]
  bowling: BowlerCard[]
  fow: FowEntry[]
  overs: OverSummary[]
  commentary: CommentaryItem[]
  live: LiveInningsState | null
  complete: boolean
}

interface MutableBatter {
  id: string
  playerCode?: string | null
  name: string
  jerseyNumber: number | null
  role: string
  runs: number
  balls: number
  fours: number
  sixes: number
  dismissalText: string | null
  batted: boolean
}

interface MutableBowler {
  id: string
  playerCode?: string | null
  name: string
  legalBalls: number
  runsConceded: number
  wickets: number
  dots: number
  wides: number
  noBalls: number
}

function ballLabel(b: BallData): TimelineBall {
  if (b.isWicket) {
    if (b.extraType === 'WIDE') return { label: 'wdW', kind: 'W', runs: teamRunsOf(b) }
    if (b.runsOffBat > 0) return { label: `${b.runsOffBat}W`, kind: 'W', runs: teamRunsOf(b) }
    return { label: 'W', kind: 'W', runs: teamRunsOf(b) }
  }
  if (b.extraType === 'WIDE') return { label: b.extraRuns > 1 ? `${b.extraRuns}wd` : 'wd', kind: 'extra', runs: b.extraRuns }
  if (b.extraType === 'NO_BALL') return { label: b.runsOffBat > 0 ? `nb${b.runsOffBat}` : 'nb', kind: 'extra', runs: teamRunsOf(b) }
  if (b.extraType === 'BYE') return { label: `${b.extraRuns}b`, kind: 'extra', runs: b.extraRuns }
  if (b.extraType === 'LEG_BYE') return { label: `${b.extraRuns}lb`, kind: 'extra', runs: b.extraRuns }
  if (b.runsOffBat === 0) return { label: '•', kind: 'dot', runs: 0 }
  if (b.runsOffBat === 4) return { label: '4', kind: '4', runs: 4 }
  if (b.runsOffBat === 6) return { label: '6', kind: '6', runs: 6 }
  return { label: String(b.runsOffBat), kind: 'run', runs: b.runsOffBat }
}

function fullDismissalText(
  ball: BallData,
  nameOf: (id: string) => string
): { text: string; dismissedId: string } {
  const dismissedId = ball.dismissedId || ball.strikerId
  const bowler = nameOf(ball.bowlerId)
  switch (ball.wicketType) {
    case 'BOWLED':
      return { text: `b ${bowler}`, dismissedId }
    case 'CAUGHT':
      return { text: `c ${ball.assistId ? nameOf(ball.assistId) : 'fielder'} b ${bowler}`, dismissedId }
    case 'CAUGHT_AND_BOWLED':
      return { text: `c & b ${bowler}`, dismissedId }
    case 'LBW':
      return { text: `lbw b ${bowler}`, dismissedId }
    case 'STUMPED':
      return { text: `st ${ball.assistId ? nameOf(ball.assistId) : 'wk'} b ${bowler}`, dismissedId }
    case 'HIT_WICKET':
      return { text: `hit wicket (${bowler})`, dismissedId }
    case 'RUN_OUT':
      return { text: `run out${ball.assistId ? ` (${nameOf(ball.assistId)})` : ''}`, dismissedId }
    case 'RETIRED_HURT':
      return { text: 'retired hurt', dismissedId }
    case 'RETIRED_OUT':
      return { text: 'retired out', dismissedId }
    case 'ABSENT':
      return { text: 'absent', dismissedId }
    case 'OBSTRUCTING_FIELD':
      return { text: 'obstructing the field', dismissedId }
    default:
      return { text: 'out', dismissedId }
  }
}

function commentaryText(ball: BallData, nameOf: (id: string) => string): string {
  const bowler = nameOf(ball.bowlerId)
  const striker = nameOf(ball.strikerId)
  const prefix = `${bowler} to ${striker}, `
  if (ball.isWicket) {
    const d = fullDismissalText(ball, nameOf)
    const parts: string[] = []
    if (ball.extraType === 'WIDE') {
      parts.push(ball.extraRuns > 1 ? `wide (${ball.extraRuns} runs)` : 'wide')
    } else if (ball.extraType === 'NO_BALL') {
      parts.push('no ball')
    }
    if (ball.runsOffBat === 6) parts.push('SIX')
    else if (ball.runsOffBat === 4) parts.push('FOUR')
    else if (ball.runsOffBat > 0) parts.push(`${ball.runsOffBat} run${ball.runsOffBat > 1 ? 's' : ''}`)
    const detail = parts.length ? `${parts.join(', ')}, ` : ''
    return `${prefix}${detail}OUT! ${nameOf(d.dismissedId)} ${d.text}`
  }
  if (ball.extraType === 'WIDE') return `${prefix}wide${ball.extraRuns > 1 ? `, ${ball.extraRuns} runs` : ''}`
  if (ball.extraType === 'NO_BALL') return `${prefix}no ball${ball.runsOffBat > 0 ? `, ${ball.runsOffBat} run${ball.runsOffBat > 1 ? 's' : ''}` : ''}`
  if (ball.extraType === 'BYE') return `${prefix}${ball.extraRuns} bye${ball.extraRuns > 1 ? 's' : ''}`
  if (ball.extraType === 'LEG_BYE') return `${prefix}leg bye${ball.extraRuns > 1 ? `s ${ball.extraRuns}` : ` ${ball.extraRuns}`}`
  const r = ball.runsOffBat
  if (r === 0) return `${prefix}no run, dot ball`
  if (r === 4) return `${prefix}FOUR!`
  if (r === 6) return `${prefix}SIX!`
  return `${prefix}${r} run${r > 1 ? 's' : ''}`
}

/** Index of the ball among the legal deliveries of its own over (1-based). */
function legalIndexInOver(balls: BallData[], ball: BallData): number {
  let n = 0
  for (const b of balls) {
    if (b.overNumber !== ball.overNumber) continue
    if (isLegalBall(b)) n++
    if (b.sequence === ball.sequence) break
  }
  return n
}

/**
 * Compute the complete scorecard of one innings from its ball events.
 */
export function computeInnings(
  meta: {
    inningsId: string
    number: number
    battingTeamId: string
    bowlingTeamId: string
    status: string
    currentStrikerId: string | null
    currentNonStrikerId: string | null
    currentBowlerId: string | null
  },
  balls: BallData[],
  battingPlayers: PlayerLite[],
  bowlingPlayers: PlayerLite[],
  totalOvers: number
): InningsStats {
  const allPlayers = [...battingPlayers, ...bowlingPlayers]
  const nameOf = (id: string) => allPlayers.find((p) => p.id === id)?.name ?? 'Unknown'
  const batters = new Map<string, MutableBatter>()
  const bowlers = new Map<string, MutableBowler>()
  const order: string[] = [] // batting order of first appearance
  const dismissedIds = new Set<string>()

  const getBatter = (id: string): MutableBatter => {
    let b = batters.get(id)
    if (!b) {
      const p = battingPlayers.find((x) => x.id === id)
      b = { id, playerCode: p?.playerCode ?? null, name: p?.name ?? 'Unknown', jerseyNumber: p?.jerseyNumber ?? null, role: p?.role ?? 'ALL_ROUNDER', runs: 0, balls: 0, fours: 0, sixes: 0, dismissalText: null, batted: false }
      batters.set(id, b)
    }
    return b
  }
  const getBowler = (id: string): MutableBowler => {
    let b = bowlers.get(id)
    if (!b) {
      const p = bowlingPlayers.find((x) => x.id === id)
      b = { id, playerCode: p?.playerCode ?? null, name: p?.name ?? 'Unknown', legalBalls: 0, runsConceded: 0, wickets: 0, dots: 0, wides: 0, noBalls: 0 }
      bowlers.set(id, b)
    }
    return b
  }

  let runs = 0
  let wickets = 0
  let legalBalls = 0
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 }
  const fow: FowEntry[] = []
  const oversMap = new Map<number, OverSummary>()
  const commentary: CommentaryItem[] = []

  for (const ball of balls) {
    for (const id of [ball.strikerId, ball.nonStrikerId]) {
      if (!order.includes(id)) {
        order.push(id)
        getBatter(id).batted = true
      }
    }
    const striker = getBatter(ball.strikerId)
    const bowler = getBowler(ball.bowlerId)
    const teamRuns = teamRunsOf(ball)

    runs += teamRuns
    if (ball.isWicket) wickets++
    if (isLegalBall(ball)) {
      legalBalls++
      striker.balls++
      if (teamRuns === 0) bowler.dots++
    }
    if (ball.extraType === 'WIDE') { bowler.wides++; extras.wides++ }
    if (ball.extraType === 'NO_BALL') { bowler.noBalls++; extras.noBalls++ }

    striker.runs += ball.runsOffBat
    if (ball.runsOffBat === 4) striker.fours++
    if (ball.runsOffBat === 6) striker.sixes++

    // bowler concession: bat runs + wides + no-ball extras (never byes/leg-byes)
    if (ball.extraType === 'WIDE' || ball.extraType === 'NO_BALL') {
      bowler.runsConceded += teamRuns
    } else {
      bowler.runsConceded += ball.runsOffBat
    }
    if (isLegalBall(ball)) bowler.legalBalls++

    if (ball.extraType === 'BYE') extras.byes += ball.extraRuns
    if (ball.extraType === 'LEG_BYE') extras.legByes += ball.extraRuns
    extras.total += ball.extraRuns

    if (ball.isWicket) {
      const d = fullDismissalText(ball, nameOf)
      if (ball.wicketType !== 'RETIRED_HURT') dismissedIds.add(d.dismissedId)
      if (BOWLER_CREDITED.has(ball.wicketType || '')) bowler.wickets++
      getBatter(d.dismissedId).dismissalText = d.text
      fow.push({ wicket: wickets, runs, over: oversStr(legalBalls), batsmanName: nameOf(d.dismissedId) })
    }

    // per-over timeline
    let over = oversMap.get(ball.overNumber)
    if (!over) {
      over = { over: ball.overNumber + 1, bowlerId: ball.bowlerId, bowlerName: nameOf(ball.bowlerId), runs: 0, wickets: 0, balls: [] }
      oversMap.set(ball.overNumber, over)
    }
    const lb = ballLabel(ball)
    over.balls.push(lb)
    over.runs += teamRuns
    if (ball.isWicket) over.wickets++

    const overDisplay = `${ball.overNumber + 1}.${legalIndexInOver(balls, ball)}`
    commentary.push({ sequence: ball.sequence, overDisplay, text: commentaryText(ball, nameOf), kind: lb.kind, runs: teamRuns })
  }

  // ---- per-bowler maiden overs (full over, 0 conceded) ----
  const perOver = new Map<string, { legal: number; conceded: number }>()
  const overBowler = new Map<number, string>()
  for (const ball of balls) {
    perOver.set(`${ball.overNumber}:${ball.bowlerId}`, {
      legal: (perOver.get(`${ball.overNumber}:${ball.bowlerId}`)?.legal ?? 0) + (isLegalBall(ball) ? 1 : 0),
      conceded: (perOver.get(`${ball.overNumber}:${ball.bowlerId}`)?.conceded ?? 0) +
        (ball.extraType === 'WIDE' || ball.extraType === 'NO_BALL' ? teamRunsOf(ball) : ball.runsOffBat),
    })
    overBowler.set(ball.overNumber, ball.bowlerId)
  }
  const maidenCount = new Map<string, number>()
  for (const [overNo, bowlerId] of overBowler) {
    const v = perOver.get(`${overNo}:${bowlerId}`)
    if (v && v.legal === 6 && v.conceded === 0) maidenCount.set(bowlerId, (maidenCount.get(bowlerId) ?? 0) + 1)
  }

  // ---- derive current live state (state AFTER the last recorded ball) ----
  let live: LiveInningsState | null = null
  if (meta.status === 'IN_PROGRESS') {
    if (balls.length > 0) {
      const last = balls[balls.length - 1]
      let striker: string | null = last.strikerId
      let nonStriker: string | null = last.nonStrikerId
      let needsNewBatsman: 'STRIKER' | 'NON_STRIKER' | null = null

      if (rotatesStrike(last)) [striker, nonStriker] = [nonStriker, striker]
      const legalInThisOver = balls.filter((b) => b.overNumber === last.overNumber && isLegalBall(b)).length
      const overComplete = legalInThisOver >= 6
      if (overComplete) [striker, nonStriker] = [nonStriker, striker]

      if (last.isWicket) {
        const d = fullDismissalText(last, nameOf)
        if (d.dismissedId === striker) { needsNewBatsman = 'STRIKER'; striker = null }
        else if (d.dismissedId === nonStriker) { needsNewBatsman = 'NON_STRIKER'; nonStriker = null }
      }

      live = {
        strikerId: striker,
        nonStrikerId: nonStriker,
        bowlerId: last.bowlerId,
        needsNewBatsman,
        overComplete,
        lastOverBowlerId: overComplete ? last.bowlerId : null,
      }
    } else {
      live = {
        strikerId: meta.currentStrikerId,
        nonStrikerId: meta.currentNonStrikerId,
        bowlerId: meta.currentBowlerId,
        needsNewBatsman: null,
        overComplete: false,
        lastOverBowlerId: null,
      }
    }

    // merge explicit selections (new batsman / new bowler) persisted on the innings row
    if (live) {
      const mergedStriker = meta.currentStrikerId ?? live.strikerId
      const mergedNonStriker = meta.currentNonStrikerId ?? live.nonStrikerId
      const mergedBowler = meta.currentBowlerId ?? live.bowlerId
      let needsNewBatsman = live.needsNewBatsman
      if (needsNewBatsman === 'STRIKER' && mergedStriker) needsNewBatsman = null
      if (needsNewBatsman === 'NON_STRIKER' && mergedNonStriker) needsNewBatsman = null
      live = {
        ...live,
        strikerId: mergedStriker,
        nonStrikerId: mergedNonStriker,
        bowlerId: mergedBowler,
        needsNewBatsman,
        overComplete: live.overComplete && meta.currentBowlerId === null,
      }
    }
  }

  // ---- batting cards: appearance order first, then yet-to-bat in squad order ----
  const battingCards: BatterCard[] = []
  for (const id of order) {
    const b = batters.get(id)!
    const atCrease = live ? live.strikerId === id || live.nonStrikerId === id : false
    battingCards.push({
      id: b.id, playerCode: b.playerCode ?? null, name: b.name, jerseyNumber: b.jerseyNumber, role: b.role,
      runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes,
      strikeRate: b.balls > 0 ? round2((b.runs * 100) / b.balls) : 0,
      out: dismissedIds.has(id),
      dismissalText: b.dismissalText ?? (b.batted ? 'not out' : null),
      batted: b.batted,
      isOnStrike: live?.strikerId === id,
      atCrease,
    })
  }
  for (const p of battingPlayers) {
    if (!order.includes(p.id)) {
      battingCards.push({
        id: p.id, playerCode: p.playerCode ?? null, name: p.name, jerseyNumber: p.jerseyNumber, role: p.role,
        runs: 0, balls: 0, fours: 0, sixes: 0, strikeRate: 0,
        out: false, dismissalText: null, batted: false, isOnStrike: false, atCrease: false,
      })
    }
  }

  // ---- bowling cards ----
  const bowlingCards: BowlerCard[] = [...bowlers.values()].map((b) => ({
    id: b.id,
    playerCode: b.playerCode ?? null,
    name: b.name,
    legalBalls: b.legalBalls,
    overs: oversStr(b.legalBalls),
    runsConceded: b.runsConceded,
    wickets: b.wickets,
    maidens: maidenCount.get(b.id) ?? 0,
    dots: b.dots,
    wides: b.wides,
    noBalls: b.noBalls,
    economy: b.legalBalls > 0 ? round2((b.runsConceded * 6) / b.legalBalls) : 0,
  }))
  bowlingCards.sort((a, b) => b.legalBalls - a.legalBalls || a.runsConceded - b.runsConceded)

  const overs = [...oversMap.values()]

  return {
    inningsId: meta.inningsId,
    number: meta.number,
    battingTeamId: meta.battingTeamId,
    bowlingTeamId: meta.bowlingTeamId,
    status: meta.status,
    runs,
    wickets,
    legalBalls,
    totalDeliveries: balls.length,
    oversDisplay: oversStr(legalBalls),
    extras,
    runRate: legalBalls > 0 ? round2((runs * 6) / legalBalls) : 0,
    batting: battingCards,
    bowling: bowlingCards,
    fow,
    overs,
    commentary: commentary.reverse(),
    live,
    complete:
      meta.status === 'COMPLETED' ||
      (totalOvers > 0 && legalBalls >= totalOvers * 6) ||
      isAllOut(wickets, battingPlayers.length),
  }
}

export function isAllOut(wickets: number, squadSize: number): boolean {
  return squadSize > 0 && wickets >= squadSize - 1
}

export function maxWicketsFor(squadSize: number): number {
  return Math.max(squadSize - 1, 1)
}

/** Max overs a single bowler may bowl (standard restriction: totalOvers / 5). */
export function maxOversPerBowler(totalOvers: number): number {
  return Math.max(1, Math.ceil(totalOvers / 5))
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Match result helpers
// ---------------------------------------------------------------------------

export function buildResultText(
  innings1: InningsStats,
  innings2: InningsStats,
  squadSize2: number,
  teamNameOf: (id: string) => string
): { text: string; winnerId: string | null } {
  const t1 = teamNameOf(innings1.battingTeamId)
  const t2 = teamNameOf(innings2.battingTeamId)
  if (innings2.runs >= innings1.runs + 1) {
    const wktsLeft = Math.max(maxWicketsFor(squadSize2) - innings2.wickets, 0)
    return {
      text:
        wktsLeft > 0
          ? `${t2} won by ${wktsLeft} wicket${wktsLeft === 1 ? '' : 's'}`
          : `${t2} won (final wicket)`,
      winnerId: innings2.battingTeamId,
    }
  }
  if (innings2.runs === innings1.runs) {
    return { text: 'Match tied', winnerId: null }
  }
  const margin = innings1.runs - innings2.runs
  return { text: `${t1} won by ${margin} run${margin === 1 ? '' : 's'}`, winnerId: innings1.battingTeamId }
}
