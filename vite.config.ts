import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['robots.txt', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Guitar Theory',
        short_name: 'Theory',
        description:
          'Chord voicings, fretboard theory and improvisation, fitted to your own hands.',
        theme_color: '#17161a',
        background_color: '#17161a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app is 88 KB and computes everything locally, so there is
        // no reason not to cache all of it and work offline permanently.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Lets the service worker be exercised with `npm run dev` rather than
        // only appearing in a production build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: { globals: true, include: ['tests/**/*.test.ts'] },
})
