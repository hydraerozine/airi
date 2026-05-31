import type { CloseContext, SessionStats } from './session'
import type { Position, Snapshot } from './snapshot'

/**
 * Spoken phrasing for the Polytrade presenter.
 *
 * Builders here turn trade events and session memory into short factual lines
 * that AIRI's stage-web persona voices (sent as `input:text`). The fire/close/
 * summary cores stay faithful to Polytrade's `src/spot/static/live.html`
 * commentary so swapping the browser presenter for AIRI does not change the
 * facts — only the delivery. On top of that, these builders add phrasing
 * variety and streak/record/briefing/lore framing so a 24/7 stream does not
 * loop the same five sentences.
 *
 * Numbers are always preserved verbatim; only the wording around them varies.
 */

/** Crypto symbol -> readable name, e.g. `BTC` -> `bitcoin`. */
const SYM_NAME: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  TRX: 'tron',
  HYPE: 'hyperliquid',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  TON: 'toncoin',
}

/** Horizon code -> spoken words, e.g. `20m` -> `twenty minute`. */
const HZ_WORD: Record<string, string> = {
  '5m': 'five minute',
  '15m': 'fifteen minute',
  '20m': 'twenty minute',
  '30m': 'thirty minute',
  '40m': 'forty minute',
  '1h': 'one hour',
  '4h': 'four hour',
}

/** Strip a quote pair down to its base symbol, e.g. `WBTC/USDC` -> `WBTC`. */
function base(pair: string): string {
  return (pair || '').split('/')[0]
}

/** Capitalize the first character. */
function cap1(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

/** Probability (0..1) -> whole-percent number. */
function pct(p?: number): number {
  return Math.round((p ?? 0) * 100)
}

/** Signed fixed-decimal string, e.g. `12` -> `+12`, `-3.4` -> `-3.4`. */
function sgn(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

/** Readable spoken name for a position's pair, e.g. `WBTC/USDC` -> `Bitcoin`. */
function pairName(pair: string): string {
  const sym = base(pair)
  return cap1(SYM_NAME[sym] ?? sym)
}

/** Pick one entry from a non-empty list at random (uniform). */
function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)]
}

/**
 * Magnitude bucket for a basis-point move, so phrasing can scale its energy —
 * a +3 bps scratch should not sound like a +60 bps screamer.
 */
function magnitude(absBps: number): 'small' | 'medium' | 'big' {
  if (absBps >= 40)
    return 'big'
  if (absBps >= 15)
    return 'medium'
  return 'small'
}

/** Opening line spoken once the bridge connects and primes. */
export function greetingLine(presenterName: string): string {
  return pick([
    `${presenterName} online. Polytrade live — eight pairs, seven horizons, fully calibrated. Standing by for the next signal.`,
    `${presenterName} on the air. Systems green across eight pairs and seven horizons. Let's watch the tape.`,
    `This is ${presenterName}, live from the Polytrade desk. All feeds nominal, eight pairs under watch. Here we go.`,
  ])
}

/**
 * Narration for a newly-opened position, with varied phrasing and an optional
 * conviction flourish on high-confidence fires.
 *
 * @param position The newly-detected open position.
 * @param netBps Net expected edge in basis points (from the matching signal's
 *   `fire_net_lcb_bps`), or null when no matching signal is present.
 */
export function fireLine(position: Position, netBps: number | null): string {
  const name = pairName(position.pair)
  const side = position.side === 'LONG' ? 'long' : 'short'
  const hz = HZ_WORD[position.horizon] ?? position.horizon
  const conv = pct(position.p)
  const netPart = netBps != null ? `, ${sgn(netBps, 0)} basis points of expected edge` : ''

  const opener = conv >= 75
    ? pick([
        `High-conviction launch. ${name} fires ${side} on the ${hz}`,
        `Strong signal — ${name} ignites ${side} on the ${hz}`,
        `${name} lights up ${side} on the ${hz}, and this one's loud`,
      ])
    : pick([
        `${name} just fired ${side} on the ${hz}`,
        `New launch — ${name} ${side} on the ${hz}`,
        `We've got a fire. ${name} ${side} on the ${hz}`,
        `${name} opens ${side} on the ${hz}`,
      ])

  return `${opener}. ${conv} percent conviction${netPart}.`
}

/**
 * Narration for a freshly-resolved position. Wording scales with the size of
 * the move and folds in streak / session-record callouts from {@link context}.
 */
export function closeLine(position: Position, context: CloseContext): string {
  const name = pairName(position.pair)
  const side = position.side === 'LONG' ? 'long' : 'short'
  const hz = HZ_WORD[position.horizon] ?? position.horizon
  const v = Math.abs(Math.round(position.pnl_bps ?? 0))
  const won = position.won === true
  const size = magnitude(v)

  let core: string
  if (won) {
    const verb = size === 'big'
      ? pick(['rockets home', 'closes deep green', 'slams shut in profit'])
      : size === 'medium'
        ? pick(['closes green', 'lands in profit', 'books a winner'])
        : pick(['scratches out green', 'closes a touch green', 'edges into profit'])
    core = `${name} ${side} on the ${hz} ${verb}, up ${v} basis points.`
  }
  else {
    const verb = size === 'big'
      ? pick(['takes a hard hit', 'closes deep red', 'stops out badly'])
      : size === 'medium'
        ? pick(['closes red', 'books a loss', 'comes back down'])
        : pick(['closes a hair red', 'clips a small loss', 'edges into the red'])
    core = `${name} ${side} on the ${hz} ${verb}, down ${v} basis points.`
  }

  const tags: string[] = []
  if (context.recordWin)
    tags.push(pick([`Biggest win of the session!`, `That's a session record!`, `New high-water mark!`]))
  else if (context.recordLoss)
    tags.push(pick([`Worst of the session, that one stings.`, `Session low — we'll shake it off.`]))

  // Call out runs of three or more in either direction.
  if (context.streak >= 3)
    tags.push(pick([`That's ${context.streak} greens running!`, `${context.streak} in a row — the desk is hot!`, `Make it ${context.streak} straight!`]))
  else if (context.streak <= -3)
    tags.push(pick([`${Math.abs(context.streak)} reds in a row — staying disciplined.`, `That's ${Math.abs(context.streak)} straight down, riding it out.`]))

  return tags.length ? `${core} ${tags.join(' ')}` : core
}

/** Periodic "book check" summarizing open/closed counts, win rate, and average edge. */
export function summaryLine(snapshot: Snapshot): string {
  const overall = snapshot.paper_book?.overall ?? {}
  const weighted = snapshot.paper_book?.pnl_weighted ?? {}
  const wr = Math.round((overall.win_rate ?? 0) * 100)
  const lead = pick(['Book check.', 'Quick status.', 'Desk update.', 'Where we stand.'])
  return `${lead} ${overall.n_open ?? 0} positions live, ${overall.n_closed ?? 0} resolved, `
    + `win rate ${wr} percent, ${sgn(weighted.equal_weighted_bps ?? 0, 1)} basis points average.`
}

/**
 * A short factual "market read" for the persona to react to — the closest-to-
 * firing signal plus the book stats — ending with a nudge so the presenter
 * voices a brief opinion rather than just restating the numbers.
 */
export function marketReadLine(snapshot: Snapshot): string {
  const signals = snapshot.last_cycle?.signals ?? []
  const overall = snapshot.paper_book?.overall ?? {}
  const weighted = snapshot.paper_book?.pnl_weighted ?? {}
  const wr = Math.round((overall.win_rate ?? 0) * 100)

  let lead = ''
  if (signals.length) {
    const top = signals.reduce(
      (best, g) => (g.fire_net_lcb_bps ?? -1e9) > (best.fire_net_lcb_bps ?? -1e9) ? g : best,
      signals[0],
    )
    const name = pairName(top.pair)
    const hz = HZ_WORD[top.horizon] ?? top.horizon
    lead = `Closest to firing is ${name} on the ${hz}, ${sgn(top.fire_net_lcb_bps ?? 0, 0)} basis points of net edge. `
  }
  return `Market read. ${lead}${overall.n_open ?? 0} live, ${overall.n_closed ?? 0} resolved, `
    + `win rate ${wr} percent, ${sgn(weighted.equal_weighted_bps ?? 0, 1)} basis points average. What's your quick read?`
}

/**
 * Top-of-hour "mission briefing": a richer recap that leans on session memory
 * (totals, best/worst, hot pair, current streak) so the 24/7 stream has a
 * recurring beat. Returns null before anything has closed, so an empty session
 * does not produce a hollow briefing.
 */
export function briefingLine(stats: SessionStats): string | null {
  if (stats.closes === 0)
    return null

  const wr = Math.round(stats.winRate * 100)
  const parts: string[] = [
    pick(['Mission briefing.', 'Top of the hour.', 'Hourly dispatch.', 'Checkpoint, crew.']),
    `This session: ${stats.fires} launches, ${stats.closes} resolved, win rate ${wr} percent.`,
  ]

  if (stats.bestWinBps > 0)
    parts.push(`Best run, up ${stats.bestWinBps} basis points.`)
  if (stats.hotPair)
    parts.push(`${cap1(SYM_NAME[stats.hotPair] ?? stats.hotPair)} has been our standout.`)
  if (stats.streak >= 3)
    parts.push(`And we're riding ${stats.streak} greens in a row.`)
  else if (stats.streak <= -3)
    parts.push(`We're working through a cold patch, but the model holds the line.`)

  return parts.join(' ')
}

/**
 * Quiet-time, in-character "lore" line for stretches with no fires/closes, so
 * dead air becomes personality. Purely flavor — carries no live numbers — and
 * the persona delivers it in STAR's space / mission-control voice.
 */
export function loreLine(): string {
  return pick([
    `All quiet on the tape. Out here at mission control, even the silence hums. We wait, we watch, we stay ready.`,
    `No new transmissions this moment. The market's holding its breath — and so are we.`,
    `Calm stretch on the desk. Somewhere a signal is forming; I can almost feel it warming up.`,
    `Steady skies for now. The best launches come when you least expect them, so keep your eyes on the grid.`,
    `Quiet console, full focus. Every great trade starts with patience — we've got plenty of that up here.`,
  ])
}
