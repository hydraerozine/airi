import type { PresenterConfig } from './config'
import type { Snapshot } from './snapshot'

import { useLogg } from '@guiiai/logg'
import { Client } from '@proj-airi/server-sdk'

import { briefingLine, closeLine, estimateSpeechMs, fireLine, greetingLine, loreLine, marketReadLine, multiCloseLine, multiFireLine, summaryLine } from './narration'
import { SessionMemory } from './session'
import { createChangeDetector, fetchSnapshot } from './snapshot'

/**
 * Connects to the AIRI server as a module and drives the avatar from Polytrade's
 * live feed.
 *
 * The bridge owns connection lifecycle, the poll/summary timers, and the
 * change-detector state, so it is modeled as a class. Each detected change is
 * forwarded as an `input:text` event; AIRI's stage-web then runs the LLM brain
 * and TTS, voicing the line through the avatar. The bridge intentionally does no
 * inference or speech itself — it is the trade-event source, mirroring the
 * `services/discord-bot` and `services/twitter-services` adapters.
 */
export class AiriPresenterBridge {
  private readonly log = useLogg('PolytradePresenter:Bridge').useGlobalConfig()
  private readonly client: Client
  private readonly config: PresenterConfig
  private readonly detector = createChangeDetector()
  private readonly session = new SessionMemory()

  private running = false
  private lastSpokeAt = 0
  private lastSnapshot?: Snapshot
  private pollTimer?: ReturnType<typeof setTimeout>
  private summaryTimer?: ReturnType<typeof setInterval>
  private opinionTimer?: ReturnType<typeof setInterval>
  private briefingTimer?: ReturnType<typeof setInterval>
  private loreTimer?: ReturnType<typeof setInterval>

  // Outgoing speech is paced through this FIFO: AIRI interrupts current speech
  // whenever a new `input:text` arrives and exposes no "done speaking" signal,
  // so the bridge sends one line, waits an estimate of how long it takes to
  // say, then sends the next. Without this, a multi-event poll (common in
  // canary mode) makes STAR talk over herself and only the last line survives.
  private readonly speechQueue: string[] = []
  private drainTimer?: ReturnType<typeof setTimeout>
  private draining = false

  constructor(config: PresenterConfig) {
    this.config = config
    this.client = new Client({
      name: 'polytrade-presenter',
      url: config.airiServerUrl,
      token: config.airiServerToken,
      possibleEvents: [
        'module:authenticate',
        'module:authenticated',
        'module:announce',
        'input:text',
        'output:gen-ai:chat:message',
      ],
      onReady: () => this.log.log('module ready — connected to AIRI server'),
      onError: error => this.log.errorWithError('AIRI client error', error),
    })

    // Observability: log what the avatar ends up saying back through the brain.
    this.client.onEvent('output:gen-ai:chat:message', (event) => {
      const content = event.data.message?.content
      const text = typeof content === 'string' ? content : JSON.stringify(content)
      this.log.log(`avatar said: ${text}`)
    })
  }

  /** Connect, prime against the first snapshot, then start the poll + summary loops. */
  async start(): Promise<void> {
    this.running = true
    await this.client.connect()

    // Prime immediately so we greet against real book state instead of an empty one.
    await this.tick()
    this.scheduleNextPoll()

    this.summaryTimer = setInterval(() => {
      if (!this.running || !this.lastSnapshot)
        return
      // Hold the summary if we narrated something recently (proxy for live.html's
      // "only summarize while idle" gate, which the bridge cannot observe directly).
      if (Date.now() - this.lastSpokeAt < this.config.summaryQuietMs)
        return
      this.speak(summaryLine(this.lastSnapshot))
    }, this.config.summaryMs)

    // Occasionally hand STAR a factual market read and let her opine on it.
    this.opinionTimer = setInterval(() => {
      if (!this.running || !this.lastSnapshot)
        return
      if (Date.now() - this.lastSpokeAt < this.config.opinionQuietMs)
        return
      this.speak(marketReadLine(this.lastSnapshot))
    }, this.config.opinionMs)

    // Recurring "mission briefing" recap from session memory, for show rhythm.
    this.briefingTimer = setInterval(() => {
      if (!this.running)
        return
      const line = briefingLine(this.session.stats())
      if (line)
        this.speak(line)
    }, this.config.briefingMs)

    // Fill genuine dead air with in-character lore (only after a real silence).
    this.loreTimer = setInterval(() => {
      if (!this.running)
        return
      if (Date.now() - this.lastSpokeAt < this.config.loreQuietMs)
        return
      this.speak(loreLine())
    }, this.config.loreMs)
  }

  /** Stop timers and close the AIRI connection. */
  stop(): void {
    this.running = false
    if (this.pollTimer)
      clearTimeout(this.pollTimer)
    if (this.summaryTimer)
      clearInterval(this.summaryTimer)
    if (this.opinionTimer)
      clearInterval(this.opinionTimer)
    if (this.briefingTimer)
      clearInterval(this.briefingTimer)
    if (this.loreTimer)
      clearInterval(this.loreTimer)
    if (this.drainTimer)
      clearTimeout(this.drainTimer)
    this.speechQueue.length = 0
    this.client.close()
  }

  /** Poll once: fetch the snapshot, greet on prime, and narrate fires/closes. */
  private async tick(): Promise<void> {
    try {
      const snapshot = await fetchSnapshot(this.config.snapshotUrl)
      this.lastSnapshot = snapshot

      const wasPrimed = this.detector.primed
      const events = this.detector.detect(snapshot)

      if (!wasPrimed && this.detector.primed && this.config.greetOnConnect)
        this.speak(greetingLine(this.config.presenterName))

      const fires = events.filter(e => e.kind === 'fire')
      const closes = events.filter(e => e.kind === 'close')

      // Always fold every event into session memory so streaks/records stay
      // accurate even when the spoken lines are coalesced.
      for (let i = 0; i < fires.length; i++)
        this.session.recordFire()
      const closeContexts = closes.map(e => this.session.recordClose(e.position))

      // One line per individual event reads best; but a burst (common in canary
      // mode) would talk over itself, so past a small threshold we collapse each
      // kind into a single summary line instead of queueing a long backlog.
      if (fires.length > this.config.maxNarratedPerTick) {
        this.speak(multiFireLine(fires.map(e => e.position)))
      }
      else {
        for (const e of fires)
          this.speak(fireLine(e.position, e.netBps))
      }

      if (closes.length > this.config.maxNarratedPerTick)
        this.speak(multiCloseLine(closes.map(e => e.position)))
      else
        closes.forEach((e, i) => this.speak(closeLine(e.position, closeContexts[i])))
    }
    catch (error) {
      this.log.errorWithError('snapshot poll failed', error)
    }
  }

  /** Recursively schedule polls so a slow fetch never overlaps the next one. */
  private scheduleNextPoll(): void {
    if (!this.running)
      return
    this.pollTimer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNextPoll())
    }, this.config.pollMs)
  }

  /**
   * Queue a line for delivery. Lines are drained one at a time, paced so each
   * finishes speaking before the next is sent (see {@link drainSpeech}); a
   * direct send would interrupt whatever STAR is currently saying.
   *
   * Stale-burst guard: if the backlog already exceeds maxQueuedLines (a canary
   * stampede faster than she can talk), the oldest pending lines are dropped so
   * narration stays close to live instead of falling minutes behind.
   */
  private speak(text: string): void {
    if (!text)
      return
    this.speechQueue.push(text)
    while (this.speechQueue.length > this.config.maxQueuedLines)
      this.speechQueue.shift()
    if (!this.draining)
      this.drainSpeech()
  }

  /**
   * Drain the speech queue one line at a time, scheduling the next send only
   * after the current line's estimated spoken duration has elapsed. Idempotent
   * via the `draining` guard so overlapping callers cannot double-pump it.
   */
  private drainSpeech(): void {
    if (!this.running) {
      this.draining = false
      return
    }
    const text = this.speechQueue.shift()
    if (text == null) {
      this.draining = false
      return
    }
    this.draining = true
    this.send(text)
    const waitMs = estimateSpeechMs(text) + this.config.speechGapMs
    this.drainTimer = setTimeout(() => this.drainSpeech(), waitMs)
  }

  /** Send one line to AIRI as `input:text`; the brain decides delivery and voices it. */
  private send(text: string): void {
    const overrides: { sessionId: string, messagePrefix?: string } = { sessionId: this.config.sessionId }
    if (this.config.messagePrefix)
      overrides.messagePrefix = this.config.messagePrefix

    const sent = this.client.send({ type: 'input:text', data: { text, overrides } })
    if (sent) {
      this.lastSpokeAt = Date.now()
      this.log.log(`-> ${text}`)
    }
    else {
      this.log.warn(`dropped (socket not open): ${text}`)
    }
  }
}
