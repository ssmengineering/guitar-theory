/**
 * Rasterise the icon to the sizes each platform wants.
 *   node assets/build-icons.mjs
 *
 * Android reads the manifest icons; iOS wants its own apple-touch-icon at 180
 * with no transparency; browsers want small favicons. The maskable variant is
 * full-bleed because the OS crops it to whatever shape it likes.
 */
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const OUT = 'public/icons'
await mkdir(OUT, { recursive: true })

const rounded = 'assets/icon.svg'
const maskable = 'assets/icon-maskable.svg'

const jobs = [
  [rounded, 16, 'favicon-16.png'],
  [rounded, 32, 'favicon-32.png'],
  [rounded, 180, 'apple-touch-icon.png'],
  [rounded, 192, 'icon-192.png'],
  [rounded, 512, 'icon-512.png'],
  [maskable, 512, 'icon-512-maskable.png'],
]

for (const [source, size, name] of jobs) {
  await sharp(source, { density: 400 })
    .resize(size, size)
    // iOS refuses transparency on a home-screen icon, so flatten every one.
    .flatten({ background: '#17161a' })
    .png()
    .toFile(`${OUT}/${name}`)
  console.log(`  ${name.padEnd(26)} ${size}x${size}`)
}
console.log(`\n${jobs.length} icons written to ${OUT}/`)
