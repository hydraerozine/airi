import type { Position, Snapshot } from './snapshot'

/**
 * Spoken phrasing for the Polytrade presenter.
 *
 * These builders are a faithful port of the commentary in Polytrade's
 * `src/spot/static/live.html` (fireLine / closeLine / summaryLine), kept
 * identical so swapping the browser-Speech presenter for AIRI does not change
 * what gets said — only how it is voiced. The text produced here is fed to
 * AIRI as `input:text`, after which the stage-web persona delivers it.
 */

/** Crypto symbol -> readable name, e.g. `WBTC` -> `bitcoin`. */
const SYM_NAME: Record<string, string> = {
  WBTC: 'bitcoin',
  WETH: 'ethereum',
  SOL: 'solana',
  JUP: 'jupiter',
  WIF: 'wiff',
  BONK: 'bonk',
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

/** Opening line spoken once the bridge connects and primes. */
export function greetingLine(presenterName: string): string {
  return `${presenterName} online. Polytrade live — six pairs, seven horizons, fully calibrated. Standing by for the next signal.`
}

/**
 * Narration for a newly-opened position.
 *
 * @param position The newly-detected open position.
 * @param netBps Net expected edge in basis points (from the matching signal's
 *   `fire_net_lcb_bps`), or null when no matching signal is present.
 */
export function fireLine(position: Position, netBps: number | null): string {
  const name = SYM_NAME[base(position.pair)] ?? base(position.pair)
  const side = position.side === 'LONG' ? 'long' : 'short'
  const hz = HZ_WORD[position.horizon] ?? position.horizon
  const netPart = netBps != null ? `, ${sgn(netBps, 0)} basis points of expected edge` : ''
  return `${cap1(name)} just fired ${side} on the ${hz}. ${pct(position.p)} percent conviction${netPart}.`
}

/** Narration for a freshly-resolved position (won/lost with a bps result). */
export function closeLine(position: Position): string {
  const name = SYM_NAME[base(position.pair)] ?? base(position.pair)
  const side = position.side === 'LONG' ? 'long' : 'short'
  const hz = HZ_WORD[position.horizon] ?? position.horizon
  const v = Math.abs(Math.round(position.pnl_bps ?? 0))
  if (position.won)
    return `${cap1(name)} ${side} on the ${hz} closed green, up ${v} basis points.`
  return `${cap1(name)} ${side} on the ${hz} closed red, down ${v} basis points.`
}

/** Periodic "book check" summarizing open/closed counts, win rate, and average edge. */
export function summaryLine(snapshot: Snapshot): string {
  const overall = snapshot.paper_book?.overall ?? {}
  const weighted = snapshot.paper_book?.pnl_weighted ?? {}
  const wr = Math.round((overall.win_rate ?? 0) * 100)
  return `Book check. ${overall.n_open ?? 0} positions live, ${overall.n_closed ?? 0} resolved, `
    + `win rate ${wr} percent, ${sgn(weighted.equal_weighted_bps ?? 0, 1)} basis points average.`
}
