import type { PresenterConfig } from './config'
import type { Snapshot } from './snapshot'

import { useLogg } from '@guiiai/logg'
import { Client } from '@proj-airi/server-sdk'

import { closeLine, fireLine, greetingLine, marketReadLine, summaryLine } from './narration'
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

  private running = false
  private lastSpokeAt = 0
  private lastSnapshot?: Snapshot
  private pollTimer?: ReturnType<typeof setTimeout>
  private summaryTimer?: ReturnType<typeof setInterval>
  private opinionTimer?: ReturnType<typeof setInterval>

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

      for (const event of events) {
        if (event.kind === 'fire')
          this.speak(fireLine(event.position, event.netBps))
        else
          this.speak(closeLine(event.position))
      }
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

  /** Send a line to AIRI as `input:text`; the brain decides delivery and voices it. */
  private speak(text: string): void {
    if (!text)
      return
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
