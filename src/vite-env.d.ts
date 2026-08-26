/// <reference types='vite-plugin-pwa/client' />
/// <reference types='vite-plugin-pwa/react' />

/** Injected by Vite `define` from package.json version. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITE_SYNC_SECRET?: string
}
