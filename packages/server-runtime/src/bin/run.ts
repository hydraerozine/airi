#!/usr/bin/env tsx

import process, { env, exit } from 'node:process'

import { createServer } from '../server'

const server = createServer({
  port: env.PORT ? Number.parseInt(env.PORT) : 6121,
  // Bind all interfaces by default so the runtime is reachable when
  // containerized (e.g. Railway public networking). Override with HOST for
  // local-only binding (e.g. HOST=127.0.0.1).
  hostname: env.HOST ?? '0.0.0.0',
})

let stopping = false

async function shutdown() {
  if (stopping)
    return
  stopping = true
  await server.stop()
  exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.start()
