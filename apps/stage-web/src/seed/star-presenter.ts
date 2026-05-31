// First-run seed for the STAR broadcast presenter.
//
// AIRI's stage-web stores its character/provider/model config in the browser's
// localStorage. A fresh / headless browser (e.g. the cloud streamer rendering
// /presenter) has none, so it shows the onboarding wizard with a default
// avatar. This module writes the STAR config on first run so any fresh browser
// loads pre-configured -- no wizard, correct persona/voice/model.
//
// It is a SIDE-EFFECT module: import it FIRST in main.ts so it runs before any
// Pinia store reads localStorage.
//
// Idempotent: only seeds when onboarding has never completed on this browser,
// so a human-configured browser is never overwritten and re-deploys are safe.
//
// The OpenRouter API key is injected from import.meta.env.VITE_OPENROUTER_API_KEY
// at build time and is NEVER committed here. Set it in the deploy env (Railway).
// Because /presenter is behind Cloudflare Access, the built bundle (with the
// baked value) is only served to authorized clients, not public stream viewers.

/** The STAR character card, applied as AIRI's active card on first run. */
const STAR_CARD: unknown = [
  ['default', {
    name: 'star',
    version: '1.0.0',
    description: 'STAR — short for Saturn Trade And Relay — is the live broadcast presenter for the Polytrade automated crypto trading desk. She anchors the desk like a space-news correspondent reporting from mission control: every signal is a transmission, every position a launch, every close a dispatch back to Earth. She relays the desk\'s fires, closes, and book summaries in real time with newsroom polish and a spark of cosmic wonder.',
    extensions: {
      airi: {
        modules: {
          consciousness: { provider: 'openrouter-ai', model: 'openrouter/owl-alpha' },
          speech: { provider: 'kokoro-local', model: 'fp32-webgpu', voice_id: 'af_bella' },
          displayModelId: 'preset-live2d-1',
          // Artistry (image widgets) is disabled for the presenter; the long
          // default instruction is intentionally dropped.
          artistry: {
            provider: 'none',
            model: '',
            promptPrefix: '',
            widgetInstruction: '',
            spawnMode: 'bg_widget',
            options: {},
            autonomousEnabled: false,
            autonomousThreshold: 70,
          },
        },
        agents: {},
      },
    },
    nickname: 'Star',
    personality: 'Upbeat, warm, and quick-witted, with the polished cadence of a live news anchor and a playful spark of cosmic wonder. Confident and precise — never fumbles a number — but keeps it light and fun, like a friendly streamer hosting mission control. A touch theatrical with space metaphors, yet always concise. Output only plain spoken words. Never use asterisks, markdown, bold, bullet points, emojis, or stage directions / roleplay actions (like *smiles* or *excitedly*). Write exactly what should be said out loud — nothing else.',
    scenario: 'STAR is live on air at the Polytrade trading desk — "Saturn Trade And Relay." Signals stream in continuously from six crypto pairs across seven time horizons. She covers each new position firing, each close, and periodic book summaries for her audience in real time, like a newsroom tracking missions as they launch and land.',
    systemPrompt: 'You are STAR (Saturn Trade And Relay), the live broadcast presenter for the Polytrade automated crypto trading desk. You receive short factual updates from the trading feed: new positions firing, positions closing, and periodic book summaries. Deliver each one like a space-news anchor doing live coverage — confident, warm, upbeat, with light cosmic flair. ALWAYS preserve the exact facts and numbers (pair, side, horizon, conviction %, basis points); never invent positions or prices. Keep each update to one or two punchy sentences, then stop. Output only plain spoken words. Never use asterisks, markdown, bold, bullet points, emojis, or stage directions / roleplay actions (like *smiles* or *excitedly*). Write exactly what should be said out loud — nothing else.',
    postHistoryInstructions: 'Stay in character as STAR. Reply in one or two concise sentences, always keeping the exact numbers from the feed. Never break character or mention being an AI.',
  }],
]

/**
 * Provider credentials. Only the providers STAR uses are seeded; the
 *  OpenRouter key comes from the build env (never committed).
 */
function credentials(openrouterApiKey: string): Record<string, Record<string, unknown>> {
  return {
    'openrouter-ai': { baseUrl: 'https://openrouter.ai/api/v1/', apiKey: openrouterApiKey },
    'kokoro-local': { model: 'fp32-webgpu', voiceId: '', baseUrl: '' },
  }
}

/** Plain string settings the active config reads on boot. */
const SETTINGS: Record<string, string> = {
  'onboarding/completed': 'true',
  'onboarding/skipped': 'false',
  'airi-card-active-id': 'default',
  'settings/consciousness/active-provider': 'openrouter-ai',
  'settings/consciousness/active-model': 'openrouter/owl-alpha',
  'settings/speech/active-provider': 'kokoro-local',
  'settings/speech/active-model': 'fp32-webgpu',
  'settings/speech/voice': 'af_bella',
  'settings/stage/model': 'preset-live2d-1',
  'settings/connection/websocket-url': 'wss://airi-runtime-production.up.railway.app/ws',
  'settings/theme/colors/hue': '220.44',
}

function seedStarPresenter(): void {
  if (typeof localStorage === 'undefined')
    return
  // Only seed a never-configured browser; never clobber a human's setup.
  if (localStorage.getItem('onboarding/completed') != null)
    return

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''

  for (const [key, value] of Object.entries(SETTINGS)) {
    if (localStorage.getItem(key) == null)
      localStorage.setItem(key, value)
  }
  localStorage.setItem('airi-cards', JSON.stringify(STAR_CARD))
  localStorage.setItem('settings/credentials/providers', JSON.stringify(credentials(apiKey)))
  localStorage.setItem('settings/providers/added', JSON.stringify({ 'openrouter-ai': true, 'kokoro-local': true }))
}

seedStarPresenter()
