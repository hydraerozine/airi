import type { Position } from './snapshot'

import { describe, expect, it } from 'vitest'

import { SessionMemory } from './session'

/**
 * Build a closed position for tests.
 *
 * The feed's `pnl_bps` is SIGNED: wins are positive, losses negative (the
 * dashboard renders `Math.abs(pnl_bps)` next to a `won` flag, and realized PnL
 * accumulates `pnl_bps/10000 * size`). Pass losses as negative bps here so the
 * record-loss math matches production.
 *
 * @example close('BTC/USDC', true, 30)   // a +30 bps BTC win
 * @example close('BTC/USDC', false, -18) // an 18 bps BTC loss
 */
function close(pair: string, won: boolean, pnlBps: number): Position {
  return { pair, side: 'LONG', horizon: '20m', won, pnl_bps: pnlBps }
}

describe('sessionMemory streaks', () => {
  it('extends a run of wins and resets on a loss', () => {
    const s = new SessionMemory()

    // @example three greens running -> streak climbs +1,+2,+3
    expect(s.recordClose(close('BTC/USDC', true, 10)).streak).toBe(1)
    expect(s.recordClose(close('BTC/USDC', true, 12)).streak).toBe(2)
    expect(s.recordClose(close('BTC/USDC', true, 8)).streak).toBe(3)

    // A loss flips the run to a fresh -1, it does not just decrement.
    expect(s.recordClose(close('BTC/USDC', false, 5)).streak).toBe(-1)
    expect(s.recordClose(close('BTC/USDC', false, 7)).streak).toBe(-2)

    // A win flips it back to +1.
    expect(s.recordClose(close('BTC/USDC', true, 3)).streak).toBe(1)
  })
})

describe('sessionMemory records', () => {
  it('flags a new best win only when it exceeds the prior best', () => {
    const s = new SessionMemory()

    // @example first win is always a record (best starts at 0)
    expect(s.recordClose(close('ETH/USDC', true, 20)).recordWin).toBe(true)
    // @example a smaller win is not a record
    expect(s.recordClose(close('ETH/USDC', true, 15)).recordWin).toBe(false)
    // @example a bigger win is a record
    expect(s.recordClose(close('ETH/USDC', true, 35)).recordWin).toBe(true)
  })

  it('flags a new worst loss only when it is deeper than the prior worst', () => {
    const s = new SessionMemory()

    // Losses are negative bps; "worst" is the most negative seen so far.
    expect(s.recordClose(close('SOL/USDC', false, -10)).recordLoss).toBe(true)
    expect(s.recordClose(close('SOL/USDC', false, -6)).recordLoss).toBe(false)
    expect(s.recordClose(close('SOL/USDC', false, -22)).recordLoss).toBe(true)
  })
})

describe('sessionMemory stats', () => {
  it('reports win rate, fires, and closes', () => {
    const s = new SessionMemory()
    s.recordFire()
    s.recordFire()
    s.recordClose(close('BTC/USDC', true, 10))
    s.recordClose(close('BTC/USDC', false, -5))

    const stats = s.stats()
    expect(stats.fires).toBe(2)
    expect(stats.closes).toBe(2)
    expect(stats.wins).toBe(1)
    expect(stats.winRate).toBe(0.5)
  })

  it('names the hot pair and only names a cold pair once two pairs have closed', () => {
    const s = new SessionMemory()

    // @example one pair only: hot is set, cold collapses to null (no contrast)
    s.recordClose(close('BTC/USDC', true, 40))
    expect(s.stats().hotPair).toBe('BTC')
    expect(s.stats().coldPair).toBeNull()

    // @example a second, worse pair: now hot/cold are distinct
    s.recordClose(close('DOGE/USDC', false, -30))
    const stats = s.stats()
    expect(stats.hotPair).toBe('BTC')
    expect(stats.coldPair).toBe('DOGE')
  })

  it('starts empty with a zero win rate', () => {
    const stats = new SessionMemory().stats()
    expect(stats.closes).toBe(0)
    expect(stats.winRate).toBe(0)
    expect(stats.hotPair).toBeNull()
  })
})
