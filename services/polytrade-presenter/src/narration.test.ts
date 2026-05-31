import type { Position } from './snapshot'

import { describe, expect, it } from 'vitest'

import { estimateSpeechMs, marketReadLine, multiCloseLine, multiFireLine } from './narration'

/** Build an open position for fire tests. */
function fire(pair: string): Position {
  return { pair, side: 'LONG', horizon: '1h', p: 0.6 }
}

/** Build a resolved position for close tests. */
function closed(pair: string, won: boolean): Position {
  return { pair, side: 'LONG', horizon: '1h', won, pnl_bps: won ? 12 : -8 }
}

describe('estimateSpeechMs', () => {
  it('floors very short lines so TTS startup + playback fits', () => {
    // @example a two-word line is well under the floor
    expect(estimateSpeechMs('Book check.')).toBe(2000)
  })

  it('scales with word count', () => {
    // @example ~30 words at 150 wpm ≈ 12s, comfortably above the floor
    const long = Array.from({ length: 30 }).fill('word').join(' ')
    expect(estimateSpeechMs(long)).toBeGreaterThan(10000)
  })

  it('is monotonic in length', () => {
    const short = estimateSpeechMs('one two three four five')
    const longer = estimateSpeechMs('one two three four five six seven eight nine ten eleven twelve')
    expect(longer).toBeGreaterThanOrEqual(short)
  })
})

describe('multiFireLine', () => {
  it('names each distinct pair in a burst', () => {
    // @example three different pairs -> all three named
    const line = multiFireLine([fire('SOL/USDC'), fire('TON/USDC'), fire('HYPE/USDC')])
    expect(line).toContain('Solana')
    expect(line).toContain('Toncoin')
    expect(line).toContain('Hyperliquid')
    expect(line).toContain('firing')
  })

  it('de-duplicates repeated pairs (same symbol, many horizons)', () => {
    // @example SOL fires on three horizons -> "Solana" said once, not thrice
    const line = multiFireLine([fire('SOL/USDC'), fire('SOL/USDC'), fire('SOL/USDC')])
    expect(line.match(/Solana/g)?.length).toBe(1)
  })
})

describe('multiCloseLine', () => {
  it('summarizes the green/red split', () => {
    // @example two wins + one loss -> "two green, one red"
    const line = multiCloseLine([closed('BTC/USDC', true), closed('ETH/USDC', true), closed('SOL/USDC', false)])
    expect(line).toContain('two green')
    expect(line).toContain('one red')
  })

  it('omits a side that has no closes', () => {
    // @example all winners -> no "red" clause
    const line = multiCloseLine([closed('BTC/USDC', true), closed('ETH/USDC', true)])
    expect(line).toContain('two green')
    expect(line).not.toContain('red')
  })
})

describe('marketReadLine', () => {
  it('reads a long-tilted board as long and cites the primed pair', () => {
    const snapshot = {
      last_cycle: {
        signals: [
          // SOL long-biased and primed (positive edge), others held under the bar
          { pair: 'SOL/USDC', horizon: '1h', side: 'LONG', fire_net_lcb_bps: 4, long_p: 0.7, short_p: 0.3, hold_reason: '-' },
          { pair: 'BTC/USDC', horizon: '5m', side: 'HOLD', fire_net_lcb_bps: -9, long_p: 0.62, short_p: 0.38, hold_reason: 'cresc_p_lcb_below_threshold' },
          { pair: 'ETH/USDC', horizon: '1h', side: 'HOLD', fire_net_lcb_bps: -13, long_p: 0.6, short_p: 0.4, hold_reason: 'cresc_p_lcb_below_threshold' },
        ],
      },
    }
    const line = marketReadLine(snapshot)
    expect(line).toContain('long')
    expect(line).toContain('Solana')
    // the dominant gate gets voiced as plain language, never the raw code
    expect(line).toContain('conviction just under the bar')
    expect(line).not.toContain('cresc_')
  })

  it('handles an empty board without inventing a read', () => {
    expect(marketReadLine({ last_cycle: { signals: [] } })).toContain('board')
  })
})
