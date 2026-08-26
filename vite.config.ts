/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    // Registration is owned exclusively by <UpdatePrompt /> via
    // useRegisterSW(). A parallel registration (injectRegister) makes
    // workbox-window flag the real worker as "external" and fire the
    // update prompt on every single load.
    injectRegister: null,
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'Cacotas',
      short_name: 'Cacotas',
      description: 'Inventario y previsión de pañales',
      lang: 'es',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#5b8a72',
      icons: [
        {
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        {
          src: '/icons/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallback: 'index.html',
      runtimeCaching: [],
      // Push + notificationclick handlers (phase 5)
      importScripts: ['/push-handler.js'],
    },
  })],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
