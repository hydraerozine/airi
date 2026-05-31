/// <reference types="vite/client" />
/// <reference types="../../vite-env.d.ts" />

interface ImportMetaEnv {
  readonly VITE_APP_TARGET_HUGGINGFACE_SPACE: string
  /**
   * OpenRouter API key baked into the build for the first-run STAR seed
   *  (see src/seed/star-presenter.ts). Set in the deploy env, never committed.
   */
  readonly VITE_OPENROUTER_API_KEY: string
  // more env variables...
}
