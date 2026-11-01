import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Dev only: serve the git-ignored `songs/` folder at `/dev-songs/` so a song
 * package can be opened on the Song screen without the folder picker. Nothing
 * here runs in a build, which is the point - the deployed site carries no
 * audio.
 */
function devSongs(): Plugin {
  const root = fileURLToPath(new URL('songs', import.meta.url))
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  }
  return {
    name: 'dev-songs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-songs', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
        if (url === '/index.json') {
          const list: { slug: string; title: string; artist?: string }[] = []
          if (fs.existsSync(root)) {
            for (const slug of fs.readdirSync(root)) {
              const file = path.join(root, slug, 'song.json')
              if (!fs.existsSync(file)) continue
              try {
                const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
                  title?: string
                  artist?: string
                }
                list.push({ slug, title: pkg.title ?? slug, artist: pkg.artist })
              } catch {
                list.push({ slug, title: `${slug} (song.json does not parse)` })
              }
            }
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(list))
          return
        }
        const file = path.resolve(root, url.replace(/^\/+/, ''))
        if (!file.startsWith(root + path.sep)) {
          next()
          return
        }
        if (req.method === 'PUT') {
          // Only song.json is writable, and only into an existing package.
          if (path.basename(file) !== 'song.json' || !fs.existsSync(path.dirname(file))) {
            res.statusCode = 404
            res.end()
            return
          }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf8')
              JSON.parse(text)
              fs.writeFileSync(file, text)
              res.statusCode = 204
            } catch {
              res.statusCode = 400
            }
            res.end()
          })
          return
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Content-Length', String(fs.statSync(file).size))
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    devSongs(),
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
        // The whole app is under half a megabyte and computes everything
        // locally, so there is no reason not to cache all of it and work
        // offline permanently. Songs are not here: they live in OPFS.
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
  // Signalsmith Stretch builds its AudioWorklet by stringifying a class into a
  // Blob. Any transform that rewrites class fields into helper calls (dependency
  // pre-bundling in dev, a pre-ES2022 build target) leaves the worklet calling
  // a helper that does not exist in its scope, so the library is served as
  // written and the build keeps native class fields.
  optimizeDeps: { exclude: ['signalsmith-stretch'] },
  build: { target: 'es2022' },
  server: {
    watch: {
      // The import tool's Python environment and model cache hold thousands of
      // files the app never imports, and the watcher once died on one of them
      // mid-copy. Songs are read through the dev route, not the module graph.
      ignored: ['**/tools/**/.venv/**', '**/tools/**/.models/**', '**/songs/**'],
    },
  },
  test: { globals: true, include: ['tests/**/*.test.ts'] },
})
