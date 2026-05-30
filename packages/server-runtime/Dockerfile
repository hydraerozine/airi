# AIRI server-runtime: the lightweight WebSocket module bus that stage clients
# and modules (e.g. the polytrade-presenter bridge) connect to via the
# @proj-airi/server-sdk protocol (module:announce / input:text / output:*).
# It is a pure event relay — no database, no auth. Build context is the repo
# root (pnpm workspace), mirroring the other Dockerfiles.
FROM node:24-alpine

WORKDIR /app

RUN corepack enable

# Copy the whole workspace; node_modules and dist are excluded via .dockerignore.
COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the relay and its workspace dependency chain (they publish built ESM).
RUN pnpm --filter "@proj-airi/server-runtime..." run build

# Runs the built relay. It reads PORT from env (Railway injects it) and binds
# 0.0.0.0 by default so the public domain can reach it. WebSocket path is /ws.
CMD ["node", "packages/server-runtime/dist/bin/run.mjs"]
