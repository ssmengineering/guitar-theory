/**
 * Progressions and Nashville numbers.
 *   npm run demo:chart
 */

import { chordName } from './notes/chord.js'
import { key, keyName } from './notes/key.js'
import { parseNote } from './notes/pitch.js'
import {
  analyze,
  findCadences,
  parseChart,
  parseNashvilleChart,
  renderChart,
  transposeTo,
} from './notes/progression.js'
import { FENDER } from './guitar/instrument.js'
import { MY_HAND } from './hands/profiles.js'
import { pathMotion, smoothestPath } from './hands/progression.js'
import { describeFingering } from './hands/fingering.js'
import { describeTransition } from './guitar/voiceleading.js'

const rule = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

const C = key(parseNote('C'))

/* ------------------------------------------------------------------------ */

rule('A chart, analysed')

const tune = parseChart(C, '| Cmaj7 | A7 | Dm7 | G7 | Cmaj7 | Bb | Fm | Cmaj7 |')
console.log(`  key of ${keyName(tune.key)}\n`)

for (const item of analyze(tune)) {
  console.log(
    `  ${String(item.bar + 1).padStart(2)}  ${chordName(item.symbol).padEnd(8)} ` +
      `${item.nashville.padEnd(7)} ${item.roman.padEnd(7)} ${item.role.padEnd(19)}`,
  )
  console.log(`      ${item.explanation}`)
}

/* ------------------------------------------------------------------------ */

rule('Cadences it contains')

const analysis = analyze(parseChart(C, '| Dm7 | G7 | Cmaj7 | F | C | G7 | Am7 |'))
for (const cadence of findCadences(analysis)) {
  const chords = cadence.at.map((i) => chordName(analysis[i]!.symbol)).join(' - ')
  console.log(`  ${cadence.kind.padEnd(10)} ${chords.padEnd(22)} ${cadence.explanation}`)
}

/* ------------------------------------------------------------------------ */

rule('The same tune in four keys')

const standard = parseChart(C, '| Cmaj7 | Am7 | Dm7 | G7 |')
console.log(`  numbers   ${renderChart(standard, 'nashville')}`)
for (const name of ['C', 'Eb', 'F#', 'A']) {
  const moved = transposeTo(standard, key(parseNote(name)))
  console.log(`  ${(name + ' major').padEnd(9)} ${renderChart(moved, 'letters')}`)
}

/* ------------------------------------------------------------------------ */

rule('Writing in numbers, reading in letters')

const numbers = '| 1maj7 | 6m7 | 2m7 5(7) | 1maj7 |'
console.log(`  ${numbers}`)
for (const name of ['G', 'Bb']) {
  const built = parseNashvilleChart(key(parseNote(name)), numbers)
  console.log(`  key of ${name.padEnd(3)} ${renderChart(built, 'letters')}`)
}

/* ------------------------------------------------------------------------ */

rule('The chart, as something to play')

const changes = parseChart(C, '| Dm7 | G7 | Cmaj7 |')
const numbered = analyze(changes)
const path = smoothestPath(
  FENDER,
  numbered.map((x) => x.symbol),
  MY_HAND,
  { fretRange: [0, 9], branching: 16 },
)

path.forEach((step, index) => {
  const item = numbered[index]!
  const grid: string[] = []
  for (let s = 6; s >= 1; s--) {
    const held = step.option.voicing.notes.find((n) => n.string === s)
    grid.push((held ? String(held.fret) : 'x').padStart(2))
  }
  console.log(
    `\n  ${chordName(item.symbol).padEnd(7)} ${item.nashville.padEnd(6)} ${grid.join('')}   ` +
      `${describeFingering(step.option.fingering)}`,
  )
  if (step.transition) {
    for (const line of describeTransition(step.transition)) {
      console.log(`          ${line}`)
    }
  }
})
console.log(`\n  ${pathMotion(path)} frets of movement across the whole thing.`)

console.log()
