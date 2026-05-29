/**
 * Polytrade `/snapshot` feed: types, fetching, and change detection.
 *
 * The shapes below mirror what Polytrade's `src/spot/static/live.html` reads
 * from the feed; only the fields the presenter needs are typed. The change
 * detector reproduces `live.html`'s `detect()` exactly: the first snapshot
 * primes the seen-sets silently, then subsequent snapshots surface new fires
 * and resolved closes.
 */

export type Side = 'LONG' | 'SHORT'

/** A paper-trading position as exposed by the snapshot feed. */
export interface Position {
  /** Stable identifier used to de-duplicate fires/closes across polls. */
  id?: string | number
  /** Quote pair, e.g. `WBTC/USDC`. */
  pair: string
  side: Side
  /** Horizon code, e.g. `20m`, `1h`. */
  horizon: string
  /** Fire conviction in 0..1. */
  p?: number
  /** Realized result in basis points (closed positions). */
  pnl_bps?: number
  /** Win flag for closed positions; null/undefined while unresolved. */
  won?: boolean | null
}

/** A current-cycle signal, carrying the net expected edge used in fire narration. */
export interface Signal {
  pair: string
  horizon: string
  side: string
  /** Net lower-confidence-bound expected edge in basis points. */
  fire_net_lcb_bps?: number
}

/** The paper book section of the snapshot. */
export interface PaperBook {
  open?: Position[]
  recent_closed?: Position[]
  overall?: { n_open?: number, n_closed?: number, win_rate?: number }
  pnl_weighted?: { equal_weighted_bps?: number }
  bankroll?: { current_usd?: number, realized_pnl_usd?: number }
}

/** Top-level snapshot returned by Polytrade's `/snapshot` endpoint. */
export interface Snapshot {
  cycle_count?: number
  paper_book?: PaperBook
  last_cycle?: { signals?: Signal[] }
}

/** A presenter-relevant change derived from diffing two snapshots. */
export type PresenterEvent
  = | { kind: 'fire', position: Position, netBps: number | null }
    | { kind: 'close', position: Position }

/** Stateful diff of the snapshot feed; see {@link createChangeDetector}. */
export interface ChangeDetector {
  /**
   * Diff a fresh snapshot against prior state. The first call primes the
   * seen-sets and returns no events (mirrors `live.html`'s prime step); the
   * caller is responsible for any greeting on that transition.
   */
  detect: (snapshot: Snapshot) => PresenterEvent[]
  /** True once the first snapshot has primed the detector. */
  readonly primed: boolean
}

/** Fetch and JSON-decode the Polytrade snapshot, throwing on a non-OK response. */
export async function fetchSnapshot(url: string): Promise<Snapshot> {
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`snapshot fetch failed: ${res.status} ${res.statusText}`)
  return await res.json() as Snapshot
}

/** Normalize a position id to a string key (empty string when absent). */
function idKey(position: Position): string {
  return position.id == null ? '' : String(position.id)
}

/** Resolve the net expected edge for a position from the current cycle's signals. */
function netForPosition(snapshot: Snapshot, position: Position): number | null {
  const signals = snapshot.last_cycle?.signals ?? []
  const match = signals.find(s => s.pair === position.pair && s.horizon === position.horizon && s.side === position.side)
  return match?.fire_net_lcb_bps ?? null
}

/**
 * Create a {@link ChangeDetector} that surfaces new fires and resolved closes.
 *
 * Port of `live.html`'s `detect()`: the first snapshot primes `seenOpen`/
 * `seenClosed` and yields nothing; afterwards, open positions with unseen ids
 * become `fire` events and resolved (`won != null`) closes with unseen ids
 * become `close` events.
 */
export function createChangeDetector(): ChangeDetector {
  const seenOpen = new Set<string>()
  const seenClosed = new Set<string>()
  let primed = false

  function detect(snapshot: Snapshot): PresenterEvent[] {
    const pb = snapshot.paper_book ?? {}
    const open = pb.open ?? []
    const closed = pb.recent_closed ?? []

    if (!primed) {
      for (const p of open) seenOpen.add(idKey(p))
      for (const p of closed) seenClosed.add(idKey(p))
      primed = true
      return []
    }

    const events: PresenterEvent[] = []
    for (const p of open) {
      const key = idKey(p)
      if (!seenOpen.has(key)) {
        seenOpen.add(key)
        events.push({ kind: 'fire', position: p, netBps: netForPosition(snapshot, p) })
      }
    }
    for (const p of closed) {
      const key = idKey(p)
      if (key && !seenClosed.has(key) && p.won != null) {
        seenClosed.add(key)
        events.push({ kind: 'close', position: p })
      }
    }
    return events
  }

  return {
    detect,
    get primed() {
      return primed
    },
  }
}
