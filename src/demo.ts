/**
 * A terminal walkthrough of what the engine knows.
 *   npm run demo
 */

import { FENDER, GIBSON, fretGap } from './guitar/instrument.js'
import { describeTuning, shapeShift, tuningProfile } from './guitar/tuning.js'
import {
  describeShape,
  fretboardMap,
  intervalInFrets,
  octaveShapes,
  shapesFor,
} from './guitar/shapes.js'
import { diagram, identifyVoicing, voicing } from './guitar/voicing.js'
import { describeCandidate, qualityByName } from './notes/chord.js'
import { M3, P5, m3, m7 } from './notes/interval.js'
import { MY_HAND, STANDARD_HAND } from './hands/profiles.js'
import { describeFingering, solveFingerings } from './hands/fingering.js'
import type { HandModel } from './hands/hand.js'
import type { Voicing } from './guitar/voicing.js'
import type { StringNumber } from './guitar/instrument.js'

const rule = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

/* 1. The tuning, and the fact that follows from it ------------------------ */

rule('Standard tuning, measured rather than assumed')
console.log(describeTuning(FENDER))
const profile = tuningProfile(FENDER)
console.log(
  `\n  Regular step is ${profile.regularStep} frets. ` +
    `${profile.anomalies.length} pair breaks the pattern.`,
)
console.log(
  `  A shape moved from strings 6-4 to strings 4-2 needs ` +
    `${shapeShift(FENDER, [6, 4], [4, 2])} extra fret.`,
)

/* 2. Intervals as moves --------------------------------------------------- */

rule('An interval is a move, not a number')

for (const interval of [m3, M3, P5, m7]) {
  console.log(`\n  ${intervalInFrets(interval)}`)
  for (const shape of shapesFor(FENDER, interval, { maxStringSpan: 2 })) {
    if (shape.lowString > 5) continue // keep the printout short
    const flag = shape.crossesAnomaly ? '   (crosses G-B)' : ''
    console.log(
      `    from string ${shape.lowString}:  ${describeShape(shape).padEnd(46)}${flag}`,
    )
  }
}

rule('The two octave shapes')
for (const shape of octaveShapes(FENDER)) {
  if (shape.stringSpan !== 2) continue
  console.log(
    `  strings ${shape.lowString}-${shape.highString}:  ` +
      `${describeShape(shape).padEnd(46)}` +
      `${shape.crossesAnomaly ? '(crosses G-B)' : ''}`,
  )
}

/* 3. The improv HUD, in text --------------------------------------------- */

rule('G7 across the first five frets, in degrees')

const cells = fretboardMap(FENDER, 7, qualityByName('7').intervals, [0, 5])
for (let string = 1; string <= 6; string++) {
  const row: string[] = []
  for (let fret = 0; fret <= 5; fret++) {
    const cell = cells.find((c) => c.string === string && c.fret === fret)
    row.push((cell ? cell.label : '.').padStart(3))
  }
  console.log(`  ${string} |${row.join('')}`)
}
console.log(`     ${['0', '1', '2', '3', '4', '5'].map((f) => f.padStart(3)).join('')}`)

/* 4. One grip, several names ---------------------------------------------- */

rule('Decoding a shape: x-x-10-9-8-8')

const mystery = voicing(FENDER, [
  [4, 10],
  [3, 9],
  [2, 8],
  [1, 8],
])
console.log(diagram(mystery), '\n')
for (const candidate of identifyVoicing(mystery, 5)) {
  console.log(
    `  ${describeCandidate(candidate).padEnd(42)} ` +
      `${candidate.completeness.padEnd(9)} ${candidate.plausibility.toFixed(3)}`,
  )
}

/* 5. Reach ---------------------------------------------------------------- */

rule('What the same four-fret span actually costs the hand')

for (const [low, high] of [[1, 5], [5, 9], [9, 13]] as [number, number][]) {
  console.log(
    `  frets ${String(low).padStart(2)}-${String(high).padStart(2)}   ` +
      `Fender ${fretGap(low, high, FENDER.scaleLength).toFixed(2)}"   ` +
      `Gibson ${fretGap(low, high, GIBSON.scaleLength).toFixed(2)}"`,
  )
}

/* 6. The same chord, two different hands ---------------------------------- */

const shape = (positions: [StringNumber, number][]) => voicing(FENDER, positions)
const FULL_G = shape([[6, 3], [5, 5], [4, 5], [3, 4], [2, 3], [1, 3]])
const FOUR_NOTE_G = shape([[6, 3], [5, 5], [4, 5], [3, 4]])

function report(label: string, v: Voicing, hand: HandModel): void {
  const options = solveFingerings(v, hand, FENDER, { maxResults: 2 })
  console.log(`\n  ${label} / ${hand.name}`)
  if (options.length === 0) return console.log('    no fingering found')
  for (const option of options) {
    const tags = option.strategies.length ? `  {${option.strategies.join(' ')}}` : ''
    console.log(
      `    ${option.cost.toFixed(2).padStart(5)}  ` +
        `${describeFingering(option).padEnd(34)}${tags}`,
    )
  }
}

rule('G at the 3rd fret, solved for two hands')
report('full 6-string', FULL_G, STANDARD_HAND)
report('full 6-string', FULL_G, MY_HAND)
report('four-note', FOUR_NOTE_G, MY_HAND)

console.log()
