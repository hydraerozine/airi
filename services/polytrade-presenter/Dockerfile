# Polytrade -> AIRI presenter bridge.
#
# Long-running worker: polls Polytrade's /snapshot and forwards narration to the
# AIRI server as `input:text` events. No exposed port. The build context is the
# repository root (pnpm workspace), mirroring apps/server/Dockerfile and
# apps/stage-web/Dockerfile — set this service's Dockerfile path to
# `services/polytrade-presenter/Dockerfile` and leave the root directory at the
# repo root so the whole workspace is available to the build.
FROM node:24-alpine

WORKDIR /app

RUN corepack enable

# Copy the whole workspace; node_modules and dist are excluded via .dockerignore.
COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

# @proj-airi/server-sdk and its workspace deps publish built ESM (tsdown), and
# dist is not copied, so build the dependency chain before running via tsx.
# The trailing "..." selects the package plus all of its workspace dependencies,
# which pnpm builds in topological order (the presenter itself has no build).
RUN pnpm --filter "@proj-airi/polytrade-presenter..." run build

CMD ["pnpm", "-F", "@proj-airi/polytrade-presenter", "start"]
