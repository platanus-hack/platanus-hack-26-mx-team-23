/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL (e.g. the Vercel deployment). Defaults to localhost in dev. */
  readonly VITE_BACKEND_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
