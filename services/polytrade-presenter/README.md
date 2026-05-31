# @proj-airi/polytrade-presenter

Bridges [Polytrade](https://github.com/hydraerozine/polytrade)'s live trade feed
into AIRI so the avatar reacts to and narrates trading activity with a real
LLM brain and high-quality TTS — replacing Polytrade's built-in browser-Speech
presenter ("Aria").

## What it does

Polytrade ships a self-contained VTuber page (`src/spot/static/live.html`) that
polls `/snapshot` every 3s, detects new fires/closes, and reads templated lines
through the browser Web Speech API. This module keeps that exact detection and
phrasing but, instead of speaking locally, forwards each line to AIRI as an
`input:text` event. AIRI's **stage-web** presenter then runs the LLM brain and
TTS and voices the line through the avatar (VRM or Live2D).

```
Polytrade (Python)                          AIRI
  observer.snapshot()                         server  (apps/server, ws://…:6121/ws)
        │                                        ▲   │
        │  GET /snapshot (poll 3s)               │   │ routes input:text
        ▼                                        │   ▼
  polytrade-presenter  ──input:text──────────────┘  stage-web (browser / OBS)
  (this module)                                       └─ LLM brain → TTS → avatar speaks
```

- **Detection & phrasing**: faithful port of `live.html` (`fireLine` / `closeLine`
  / `summaryLine`, prime-then-narrate diffing) — see `src/narration.ts` and
  `src/snapshot.ts`.
- **Session memory** (`src/session.ts`): tracks win/loss streaks, session
  records, and per-pair form across events so narration can add live colour —
  "three greens running", "biggest win of the session", a hot pair — instead of
  looping the same lines. Phrasing is also randomized and scales with the size
  of each move.
- **Show rhythm**: recurring "mission briefing" recaps (hourly by default) and
  in-character "lore" lines during genuine dead air, so a 24/7 stream stays
  alive between fires.
- **Transport**: `@proj-airi/server-sdk` `Client`, exactly like the Discord,
  Twitter, and Minecraft services.
- **No inference here**: the brain and voice live in stage-web; this module is
  purely the trade-event source.

## When to use it

- You want Polytrade's presenter to have an actual AI personality and a natural
  voice (vs. templated browser Speech), and you're willing to run the AIRI
  stack.

## When **not** to use it

- You only want a better *voice* with no LLM and no extra infra — then keep
  `live.html` and swap its TTS instead; you don't need AIRI for that.
- You can't run a Node server + stage-web (e.g. a strictly static deployment).

## Prerequisites (the infra you provision)

1. **AIRI server** — `apps/server` (Hono; needs Postgres + Redis + an auth secret).
2. **stage-web presenter** — `apps/stage-web`, opened in a browser or an OBS
   browser source. Configure an **LLM provider** and a **TTS voice** in its
   settings, plus a **persona** (below). This tab is the on-screen avatar.
3. **This module** — connects the two by feeding Polytrade events in.

> The LLM and TTS API keys are configured in **stage-web** (the brain/voice run
> in that browser), not in this module. This module never needs provider keys.

## Configuration

All via env (see `.env.example`). Only `POLYTRADE_SNAPSHOT_URL` is required.

| Variable | Default | Meaning |
| --- | --- | --- |
| `POLYTRADE_SNAPSHOT_URL` | — (required) | Polytrade `/snapshot` feed URL |
| `AIRI_SERVER_URL` | `ws://localhost:6121/ws` | AIRI server WebSocket |
| `AIRI_SERVER_TOKEN` | — | Token, only if the server enforces auth |
| `POLL_INTERVAL_MS` | `3000` | Snapshot poll cadence |
| `SUMMARY_INTERVAL_MS` | `48000` | Unprompted "book check" cadence |
| `SUMMARY_QUIET_MS` | `20000` | Skip summary if a line was sent within this window |
| `OPINION_INTERVAL_MS` | `150000` | Cadence of the "market read" STAR opines on |
| `OPINION_QUIET_MS` | `25000` | Skip the market read if a line was sent within this window |
| `BRIEFING_INTERVAL_MS` | `3600000` | "Mission briefing" recap cadence (from session memory) |
| `LORE_INTERVAL_MS` | `60000` | How often dead-air is checked for a lore line |
| `LORE_QUIET_MS` | `120000` | Only drop lore after this much silence |
| `SESSION_ID` | `polytrade-live` | Conversation/memory lane id |
| `MESSAGE_PREFIX` | — | Optional source prefix on the brain's input |
| `PRESENTER_NAME` | `Aria` | Name used in the greeting |
| `GREET_ON_CONNECT` | `true` | Greet once after the first snapshot primes |

## Run it

```bash
# 1) AIRI server (needs Postgres + Redis + .env — see apps/server)
pnpm -F @proj-airi/server dev

# 2) stage-web presenter — open http://localhost:5173, then in Settings:
#    - pick an LLM provider + model
#    - pick a TTS provider + voice
#    - set the persona/system prompt (below)
pnpm -F @proj-airi/stage-web dev

# 3) this bridge
cd services/polytrade-presenter
cp .env.example .env   # then edit POLYTRADE_SNAPSHOT_URL (and AIRI_SERVER_URL)
pnpm install           # from the repo root if deps aren't linked yet
pnpm start
```

You should see the bridge log `-> Aria online. …` and, when a position fires,
`-> Bitcoin just fired long on the twenty minute. …`, followed by
`avatar said: …` once the brain responds and stage-web voices it.

## Recommended persona (set in stage-web)

> You are Aria, the live presenter for the Polytrade automated trading desk.
> You receive terse factual updates from the trading feed (fires, closes, and
> periodic book summaries). Deliver them as a confident, concise crypto-desk
> commentator. **Always preserve the exact numbers and facts** (pair, side,
> horizon, conviction %, basis points). Add at most a short beat of color; never
> invent positions or prices. One or two sentences per update.

## Watch the presenter from Polytrade

Polytrade exposes a `/presenter` view that embeds the AIRI stage. Set
`AIRI_STAGE_URL` on the Polytrade deployment to your stage-web URL, then use the
dashboard's **🎙️ Presenter** button. The built-in **📺 Live** view remains as a
zero-infra fallback.

## Deploy on Railway

This service ships a `Dockerfile` and `railway.json` so it can run as a **worker**
(no exposed port) alongside Polytrade and the AIRI server in one Railway project.

Create a service from the airi repo and set:

- **Root Directory**: the repo root, so the pnpm workspace is the Docker build
  context (the Dockerfile does `COPY . .` and builds the `server-sdk` dependency
  chain).
- **Config-as-code path**: `services/polytrade-presenter/railway.json` — points
  the build at `services/polytrade-presenter/Dockerfile` and sets a
  restart-on-failure policy.
- **Variables**:

  | Variable | Example |
  | --- | --- |
  | `POLYTRADE_SNAPSHOT_URL` | `https://<polytrade>.up.railway.app/snapshot` |
  | `AIRI_SERVER_URL` | `wss://<airi-server>.up.railway.app/ws` |
  | `AIRI_SERVER_TOKEN` | (only if the server enforces auth) |

Companion services in the same project:

- **airi-server** — Dockerfile `apps/server/Dockerfile` (port 3000); needs a
  pgvector-capable Postgres + Redis, plus `BETTER_AUTH_SECRET`,
  `LLM_ROUTER_MASTER_KEY`, `API_SERVER_URL`, `CLIENT_URL`.
- **airi-stage** (stage-web) — Dockerfile `apps/stage-web/Dockerfile` (nginx,
  port 80); set the build arg `VITE_AIRI_WS_URL=wss://<airi-server>/ws` so the
  avatar UI points at the server. Its public URL is what you set as
  `AIRI_STAGE_URL` on Polytrade.

The avatar's LLM brain + TTS run in whatever browser loads stage-web, so keep one
configured stage-web instance open (e.g. an OBS browser source) for an always-on
presenter.

## Notes

- Ambient book state (equity, win rate) is **not** yet pushed as a separate
  `context:update`; only the spoken lines are sent. A future enhancement can
  attach book state as context so the brain stays informed between turns — see
  `WebSocketEventInputText.contextUpdates` and the `context:update` event in
  `packages/plugin-protocol/src/types/events.ts`.
