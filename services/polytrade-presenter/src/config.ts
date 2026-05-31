import process from 'node:process'

/**
 * Runtime configuration for the Polytrade -> AIRI presenter bridge.
 *
 * Every field is resolved from environment variables in {@link loadConfig};
 * see that function for the variable names and defaults. Field-level meaning
 * is documented on each property below.
 */
export interface PresenterConfig {
  /**
   * AIRI server WebSocket endpoint the bridge connects to as a module.
   * @default 'ws://localhost:6121/ws'
   */
  airiServerUrl: string
  /**
   * Auth token, only required when the AIRI server enforces authentication.
   * Left undefined for unauthenticated (local/dev) servers.
   */
  airiServerToken?: string
  /** Absolute URL of Polytrade's `/snapshot` JSON feed. Required. */
  snapshotUrl: string
  /**
   * How often to poll the snapshot feed, in milliseconds. Matches `live.html`'s
   * `CONFIG.pollMs` so detection cadence is identical to the built-in presenter.
   * @default 3000
   */
  pollMs: number
  /**
   * How often to emit an unprompted book summary, in milliseconds. Matches
   * `live.html`'s `CONFIG.summaryMs`.
   * @default 48000
   */
  summaryMs: number
  /**
   * Skip the periodic summary if the bridge spoke within this many milliseconds.
   * Stands in for `live.html`'s "only summarize when idle" gate, which the bridge
   * cannot observe directly (the brain's speaking state lives in stage-web).
   * @default 20000
   */
  summaryQuietMs: number
  /**
   * How often STAR offers an unprompted opinion on the live data, in
   * milliseconds. The bridge sends a short factual market read and lets the
   * persona react, so she "sometimes comments on what she's seeing".
   * @default 150000
   */
  opinionMs: number
  /**
   * Skip the periodic opinion if the bridge spoke within this many milliseconds.
   * @default 25000
   */
  opinionQuietMs: number
  /**
   * How often STAR delivers a richer "mission briefing" recap built from session
   * memory (totals, records, hot pair, streak), giving the 24/7 stream a beat.
   * @default 3600000
   */
  briefingMs: number
  /**
   * How often the bridge checks whether the desk has gone quiet enough to drop
   * an in-character "lore" line so dead air becomes personality.
   * @default 60000
   */
  loreMs: number
  /**
   * Only emit a lore line once the bridge has been silent at least this long,
   * so flavor fills genuine gaps instead of crowding live commentary.
   * @default 120000
   */
  loreQuietMs: number
  /**
   * Stable session id so AIRI keeps one coherent conversation/memory lane for the
   * feed instead of treating every event as a new chat.
   * @default 'polytrade-live'
   */
  sessionId: string
  /**
   * Optional prefix prepended to the message the brain receives (for source
   * attribution). Empty by default to keep spoken delivery clean — prefer baking
   * framing into the stage-web persona instead.
   */
  messagePrefix?: string
  /**
   * Display name used in the greeting line.
   * @default 'Aria'
   */
  presenterName: string
  /**
   * Emit a greeting once the bridge connects and primes against the first snapshot.
   * @default true
   */
  greetOnConnect: boolean
  /**
   * Spoken lines are paced one at a time (AIRI interrupts current speech on a
   * new input). This is the extra gap added after each line's estimated spoken
   * duration before the next is sent, in milliseconds — a small breath that
   * also absorbs estimation error.
   * @default 800
   */
  speechGapMs: number
  /**
   * Per-poll, narrate at most this many fires (and separately, closes)
   * individually; a larger burst collapses into one coalesced summary line so
   * STAR does not talk over herself. Matters most in canary mode.
   * @default 2
   */
  maxNarratedPerTick: number
  /**
   * Hard cap on the paced speech backlog. If events arrive faster than they can
   * be spoken, the oldest queued lines are dropped past this so narration stays
   * close to live instead of falling minutes behind.
   * @default 6
   */
  maxQueuedLines: number
}

/** Parse an integer env var, falling back when unset/blank/non-numeric. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '')
    return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Parse a boolean env var; treats 1/true/yes/on (case-insensitive) as true. */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null)
    return fallback
  return /^(?:1|true|yes|on)$/i.test(raw.trim())
}

/**
 * Build a {@link PresenterConfig} from `process.env`.
 *
 * Use when:
 * - Booting the bridge entrypoint ({@link import('./main')}).
 *
 * Expects:
 * - `POLYTRADE_SNAPSHOT_URL` to be set; all other variables have defaults.
 *
 * Returns:
 * - A fully-resolved config.
 *
 * @throws Error when `POLYTRADE_SNAPSHOT_URL` is missing or blank.
 */
export function loadConfig(): PresenterConfig {
  const snapshotUrl = (process.env.POLYTRADE_SNAPSHOT_URL ?? '').trim()
  if (!snapshotUrl)
    throw new Error('POLYTRADE_SNAPSHOT_URL is required (e.g. https://your-polytrade.up.railway.app/snapshot)')

  return {
    airiServerUrl: (process.env.AIRI_SERVER_URL ?? 'ws://localhost:6121/ws').trim(),
    airiServerToken: process.env.AIRI_SERVER_TOKEN?.trim() || undefined,
    snapshotUrl,
    pollMs: intEnv('POLL_INTERVAL_MS', 3000),
    summaryMs: intEnv('SUMMARY_INTERVAL_MS', 48000),
    summaryQuietMs: intEnv('SUMMARY_QUIET_MS', 20000),
    opinionMs: intEnv('OPINION_INTERVAL_MS', 150000),
    opinionQuietMs: intEnv('OPINION_QUIET_MS', 25000),
    briefingMs: intEnv('BRIEFING_INTERVAL_MS', 3600000),
    loreMs: intEnv('LORE_INTERVAL_MS', 60000),
    loreQuietMs: intEnv('LORE_QUIET_MS', 120000),
    sessionId: (process.env.SESSION_ID ?? 'polytrade-live').trim(),
    messagePrefix: process.env.MESSAGE_PREFIX?.trim() || undefined,
    presenterName: (process.env.PRESENTER_NAME ?? 'Aria').trim(),
    greetOnConnect: boolEnv('GREET_ON_CONNECT', true),
    speechGapMs: intEnv('SPEECH_GAP_MS', 800),
    maxNarratedPerTick: intEnv('MAX_NARRATED_PER_TICK', 2),
    maxQueuedLines: intEnv('MAX_QUEUED_LINES', 6),
  }
}
