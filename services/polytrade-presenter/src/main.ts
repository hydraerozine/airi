import process from 'node:process'

import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'

import { AiriPresenterBridge } from './airi-bridge'
import { loadConfig } from './config'

/**
 * Entry point for the Polytrade -> AIRI presenter bridge.
 *
 * Polls Polytrade's `/snapshot` feed, detects new fires and resolved closes, and
 * forwards narration to AIRI as `input:text` so the stage-web avatar reacts and
 * speaks. Run alongside a running AIRI server and a stage-web presenter that has
 * an LLM provider and a TTS voice configured.
 *
 * Call stack:
 *
 * main
 *   -> {@link loadConfig}
 *   -> new {@link AiriPresenterBridge}
 *     -> Client.connect            (@proj-airi/server-sdk)
 *     -> bridge.tick
 *       -> fetchSnapshot           (./snapshot)
 *       -> detector.detect         (./snapshot)
 *       -> bridge.speak -> Client.send('input:text')
 */
async function main(): Promise<void> {
  setGlobalFormat(Format.Pretty)
  setGlobalLogLevel(LogLevel.Log)
  const log = useLogg('PolytradePresenter').useGlobalConfig()

  const config = loadConfig()
  log.log(`starting bridge: feed=${config.snapshotUrl} airi=${config.airiServerUrl} poll=${config.pollMs}ms`)

  const bridge = new AiriPresenterBridge(config)
  await bridge.start()

  const shutdown = (): void => {
    log.log('shutting down')
    bridge.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  useLogg('PolytradePresenter').useGlobalConfig().errorWithError('fatal error', error)
  process.exit(1)
})
