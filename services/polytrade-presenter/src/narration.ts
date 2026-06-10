import type { CloseContext, SessionStats } from './session'
import type { Position, Signal, Snapshot } from './snapshot'

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
  XRP: 'ripple',
  LINK: 'chainlink',
  AVAX: 'avalanche',
  LTC: 'litecoin',
  BCH: 'bitcoin cash',
  DOT: 'polkadot',
  UNI: 'uniswap',
  AAVE: 'aave',
  NEAR: 'near',
  APT: 'aptos',
  SUI: 'sui',
  ARB: 'arbitrum',
  OP: 'optimism',
  TSLA: 'tesla',
  NVDA: 'nvidia',
  AAPL: 'apple',
  MSFT: 'microsoft',
  META: 'meta',
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
 * Estimate how long a line takes to speak, in milliseconds.
 *
 * The bridge paces its outgoing lines by this so one finishes before the next
 * is sent (AIRI interrupts current speech when a new `input:text` arrives, and
 * the server exposes no "done speaking" signal to await). The estimate is
 * deliberately generous — the persona may rephrase slightly longer, and a brief
 * gap between lines is far better than cutting STAR off mid-sentence.
 *
 * @param text The line to be spoken.
 * @param wordsPerMinute Assumed delivery rate. @default 150
 *
 * @example estimateSpeechMs('Bitcoin just fired long.', 150) // ~2000 (floor)
 */
export function estimateSpeechMs(text: string, wordsPerMinute = 150): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const rate = wordsPerMinute > 0 ? wordsPerMinute : 150
  // Floor so very short lines still get room for TTS startup + playback.
  return Math.max(2000, Math.round((words / rate) * 60000))
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
    `${presenterName} online. Polytrade live — the full board calibrated across seven horizons. Standing by for the next signal.`,
    `${presenterName} on the air. Systems green across every pair on the desk. Let's watch the tape.`,
    `This is ${presenterName}, live from the Polytrade desk. All feeds nominal, the whole board under watch. Here we go.`,
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

/**
 * One coalesced line for a batch of fires that landed in the same poll, so a
 * burst (e.g. canary mode opening many positions at once) becomes a single
 * punchy call-out instead of a pile-up that talks over itself.
 *
 * @param positions The newly-fired positions from one tick (length >= 2).
 *
 * @example multiFireLine([sol1h, ton1h, hype4h]) // "Three launches at once — Solana, Toncoin, and Hyperliquid all firing."
 */
export function multiFireLine(positions: Position[]): string {
  const names = uniqueNames(positions)
  const count = numberWord(positions.length)
  const lead = pick([
    `${cap1(count)} launches at once`,
    `A cluster of fires`,
    `The board lights up — ${count} launches`,
  ])
  return `${lead} — ${joinNames(names)} all firing.`
}

/**
 * One coalesced line for a batch of closes that resolved in the same poll.
 *
 * @param positions The freshly-resolved positions from one tick (length >= 2).
 *
 * @example multiCloseLine([w, w, l]) // "Three closes land — two green, one red."
 */
export function multiCloseLine(positions: Position[]): string {
  const wins = positions.filter(p => p.won === true).length
  const losses = positions.length - wins
  const lead = pick([
    `${cap1(numberWord(positions.length))} closes land`,
    `A batch resolves`,
    `Several dispatches back to Earth`,
  ])

  const parts: string[] = []
  if (wins)
    parts.push(`${numberWord(wins)} green`)
  if (losses)
    parts.push(`${numberWord(losses)} red`)
  return `${lead} — ${parts.join(', ')}.`
}

/** De-duplicated readable pair names, preserving first-seen order. */
function uniqueNames(positions: Position[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const p of positions) {
    const n = pairName(p.pair)
    if (!seen.has(n)) {
      seen.add(n)
      names.push(n)
    }
  }
  return names
}

/** Join names as a spoken list: `a`, `a and b`, `a, b, and c`. */
function joinNames(names: string[]): string {
  if (names.length <= 1)
    return names[0] ?? ''
  if (names.length === 2)
    return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/** Small integer -> spoken word (falls back to digits past ten). */
function numberWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  return words[n] ?? String(n)
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
  if (!signals.length)
    return `Market read. The board's dark for a moment — feeds settling. Standing by for the next signal.`

  // Directional lean across the board, the closest-to-firing signal, and what's
  // gating the rest — the three things that make a read feel alive.
  const bias = directionalBias(signals)
  const top = signals.reduce(
    (best, g) => (g.fire_net_lcb_bps ?? -1e9) > (best.fire_net_lcb_bps ?? -1e9) ? g : best,
    signals[0],
  )
  const topName = pairName(top.pair)
  const topHz = HZ_WORD[top.horizon] ?? top.horizon
  const topNet = top.fire_net_lcb_bps ?? 0

  const biasPart = pick([
    `The desk is ${bias} right now.`,
    `Overall tone reads ${bias}.`,
    `My read across the board: ${bias}.`,
  ])

  const leadPart = topNet >= 0
    ? `${topName} on the ${topHz} is primed, ${sgn(topNet, 0)} basis points of edge — that's the one to watch.`
    : `Closest to firing is ${topName} on the ${topHz}, still ${sgn(topNet, 0)} basis points shy of clearing cost.`

  const gate = dominantGate(signals)
  const gatePart = gate
    ? pick([
        `Most of the grid is held — ${gate}.`,
        `The rest is on the bench: ${gate}.`,
      ])
    : ''

  return [`Market read.`, biasPart, leadPart, gatePart].filter(Boolean).join(' ')
}

/** Spoken directional lean of the board from long-vs-short conviction. */
function directionalBias(signals: Signal[]): string {
  let longW = 0
  let shortW = 0
  for (const g of signals) {
    longW += Math.max(0, (g.long_p ?? 0) - 0.5)
    shortW += Math.max(0, (g.short_p ?? 0) - 0.5)
  }
  const total = longW + shortW
  const share = total > 0 ? longW / total : 0.5
  if (share > 0.62)
    return 'leaning firmly long'
  if (share > 0.54)
    return 'tilting long'
  if (share < 0.38)
    return 'leaning firmly short'
  if (share < 0.46)
    return 'tilting short'
  return 'balanced, no strong edge either way'
}

/** hold_reason code -> spoken phrase for STAR's market read. */
const GATE_PHRASES: Record<string, string> = {
  cresc_p_lcb_below_threshold: 'conviction just under the bar',
  cresc_net_edge_below_threshold: 'the edge not yet covering cost',
  cresc_vol_unstable: 'volatility too unstable to trust',
  cresc_regime_cold: 'a few regimes still warming up',
  cresc_recent_chop: 'the tape too choppy',
}

/** Spoken description of the gate holding back the most signals, or '' if none. */
function dominantGate(signals: Signal[]): string {
  const counts = new Map<string, number>()
  for (const g of signals) {
    const r = g.hold_reason
    if (r && r !== '-')
      counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  let top = ''
  let n = 0
  for (const [reason, c] of counts) {
    if (c > n) {
      n = c
      top = reason
    }
  }
  return top ? GATE_PHRASES[top] ?? 'waiting on cleaner conditions' : ''
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
