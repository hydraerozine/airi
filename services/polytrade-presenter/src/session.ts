/**
 * Running session memory for the Polytrade presenter.
 *
 * The raw `/snapshot` feed is stateless: each poll just says what is open and
 * what recently closed. That makes for repetitive narration ("position closed
 * green" over and over) because the presenter has no sense of history. This
 * module accumulates the cross-event context that makes commentary feel alive —
 * win/loss streaks, session records, and per-pair form — so the narration layer
 * can say things like "that's three greens running" or "biggest win of the
 * session".
 *
 * It owns only derived session state; it does not fetch or diff snapshots (that
 * is {@link import('./snapshot').createChangeDetector}). State is per-process,
 * so it resets when the bridge restarts — phrasing therefore says "this
 * session" rather than "today".
 */

import type { Position } from './snapshot'

/** Per-close context handed to narration so it can frame streaks and records. */
export interface CloseContext {
  /** Signed run length: `+3` = three greens in a row, `-2` = two reds in a row. */
  streak: number
  /** True when this close is the largest win (in bps) seen this session. */
  recordWin: boolean
  /** True when this close is the largest loss (in bps) seen this session. */
  recordLoss: boolean
}

/** A pair's running form over the session. */
interface PairForm {
  wins: number
  losses: number
  netBps: number
}

/** Aggregate session stats used by briefings and quiet-time lore. */
export interface SessionStats {
  fires: number
  closes: number
  wins: number
  /** Win rate over closed positions this session, 0..1 (0 when none closed). */
  winRate: number
  bestWinBps: number
  worstLossBps: number
  /** Signed current streak (see {@link CloseContext.streak}). */
  streak: number
  /** Best-performing pair by net bps this session, or null when none closed. */
  hotPair: string | null
  /** Worst-performing pair by net bps this session, or null when only one pair has closed. */
  coldPair: string | null
}

/** Strip a quote pair down to its base symbol, e.g. `WBTC/USDC` -> `WBTC`. */
function base(pair: string): string {
  return (pair || '').split('/')[0]
}

/**
 * Tracks cross-event session memory for the presenter.
 *
 * Use when:
 * - You need narration context that a single snapshot cannot provide (streaks,
 *   records, per-pair form).
 *
 * The bridge calls {@link recordFire}/{@link recordClose} as events surface and
 * reads {@link stats} for briefings and lore.
 */
export class SessionMemory {
  private fires = 0
  private closes = 0
  private wins = 0
  private bestWinBps = 0
  private worstLossBps = 0
  private streak = 0
  private readonly pairForm = new Map<string, PairForm>()

  /** Record a newly-fired position. */
  recordFire(): void {
    this.fires += 1
  }

  /**
   * Record a resolved close and return its narration context.
   *
   * Computes the running streak (extends when the result matches the previous
   * close, otherwise flips to ±1) and whether the close set a session record,
   * then folds the result into per-pair form and the win counters.
   */
  recordClose(position: Position): CloseContext {
    const won = position.won === true
    const bps = Math.round(position.pnl_bps ?? 0)

    // Extend the streak when this result matches the run's sign, else reset to
    // a fresh ±1 in the new direction.
    if (won)
      this.streak = this.streak > 0 ? this.streak + 1 : 1
    else
      this.streak = this.streak < 0 ? this.streak - 1 : -1

    const recordWin = won && bps > this.bestWinBps
    const recordLoss = !won && bps < this.worstLossBps
    if (recordWin)
      this.bestWinBps = bps
    if (recordLoss)
      this.worstLossBps = bps

    this.closes += 1
    if (won)
      this.wins += 1

    const sym = base(position.pair)
    const form = this.pairForm.get(sym) ?? { wins: 0, losses: 0, netBps: 0 }
    form.netBps += bps
    if (won)
      form.wins += 1
    else
      form.losses += 1
    this.pairForm.set(sym, form)

    return { streak: this.streak, recordWin, recordLoss }
  }

  /** Snapshot the running session stats for briefings and lore. */
  stats(): SessionStats {
    let hotPair: string | null = null
    let coldPair: string | null = null
    let hi = -Infinity
    let lo = Infinity
    for (const [sym, form] of this.pairForm) {
      if (form.netBps > hi) {
        hi = form.netBps
        hotPair = sym
      }
      if (form.netBps < lo) {
        lo = form.netBps
        coldPair = sym
      }
    }

    return {
      fires: this.fires,
      closes: this.closes,
      wins: this.wins,
      winRate: this.closes ? this.wins / this.closes : 0,
      bestWinBps: this.bestWinBps,
      worstLossBps: this.worstLossBps,
      streak: this.streak,
      hotPair,
      // With one tracked pair hot and cold coincide; collapse to avoid implying
      // contrast where there is none.
      coldPair: this.pairForm.size > 1 ? coldPair : null,
    }
  }
}
