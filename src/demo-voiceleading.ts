/**
 * Voice leading.
 *   npm run demo:voice
 */

import { FENDER } from './guitar/instrument.js'
import { stringSetKey } from './guitar/generate.js'
import {
  describeTransition,
  guideToneLine,
  substitutesFor,
} from './guitar/voiceleading.js'
import { chord, chordName } from './notes/chord.js'
import { degreeLabel } from './notes/interval.js'
import { parseNote } from './notes/pitch.js'
import { MY_HAND } from './hands/profiles.js'
import { describeFingering } from './hands/fingering.js'
import { pathMotion, smoothestPath } from './hands/progression.js'
import type { PlayableVoicing } from './hands/dictionary.js'

const rule = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

const Dm7 = chord(parseNote('D'), 'm7')
const G7 = chord(parseNote('G'), '7')
const Cmaj7 = chord(parseNote('C'), 'maj7')

const grid = (entry: PlayableVoicing): string => {
  const byString = new Map(entry.voicing.notes.map((n) => [n.string, n.fret]))
  const cells: string[] = []
  for (let s = 6; s >= 1; s--) {
    const fret = byString.get(s as 1 | 2 | 3 | 4 | 5 | 6)
    cells.push((fret === undefined ? 'x' : String(fret)).padStart(2))
  }
  return cells.join('')
}

/* ------------------------------------------------------------------------ */

rule('ii-V-I in C, comped for this hand')

const path = smoothestPath(FENDER, [Dm7, G7, Cmaj7], MY_HAND, {
  fretRange: [0, 9],
  branching: 16,
})

for (const step of path) {
  console.log(
    `\n  ${chordName(step.chord).padEnd(7)} ${grid(step.option)}   ` +
      `${step.option.roles.map((r) => r.label).join(' ').padEnd(12)} ` +
      `${describeFingering(step.option.fingering)}`,
  )
  if (step.transition) {
    for (const line of describeTransition(step.transition)) {
      console.log(`            ${line}`)
    }
    console.log(
      `            = ${step.transition.totalMotion} frets of movement, ` +
        `${step.transition.commonTones} held`,
    )
  }
}
console.log(`\n  Total movement across the progression: ${pathMotion(path)} frets`)

/* ------------------------------------------------------------------------ */

rule('The same changes, ignoring voice leading')

const greedy = smoothestPath(FENDER, [Dm7, G7, Cmaj7], MY_HAND, {
  fretRange: [0, 9],
  motionWeight: 0,
  branching: 1,
})
for (const step of greedy) {
  console.log(`  ${chordName(step.chord).padEnd(7)} ${grid(step.option)}`)
}
console.log(`\n  Total movement: ${pathMotion(greedy)} frets`)

/* ------------------------------------------------------------------------ */

rule('Guide tones through the same changes')

guideToneLine(FENDER, [Dm7, G7, Cmaj7]).forEach((step, index) => {
  const move =
    index === 0
      ? 'start'
      : step.motion === 0
        ? 'held'
        : `${step.motion > 0 ? '+' : ''}${step.motion} semitone${
            Math.abs(step.motion) === 1 ? '' : 's'
          }`
  console.log(
    `  ${chordName(step.chord).padEnd(7)} ` +
      `string ${step.note.string} fret ${String(step.note.fret).padStart(2)}   ` +
      `${step.label.padEnd(3)} ${move}`,
  )
})
console.log('\n  Play only these three notes and the changes are already unmistakable.')

/* ------------------------------------------------------------------------ */

rule('What could stand in for G7')

for (const sub of substitutesFor(G7, { minShared: 2, maxResults: 8 })) {
  const shared = sub.shared
    .map((s) => `${degreeLabel(s.inFirst)}->${degreeLabel(s.inSecond)}`)
    .join(' ')
  console.log(
    `  ${chordName(sub.chord).padEnd(9)} shares ${String(sub.shared.length)}  ` +
      `[${shared.padEnd(18)}] ${sub.sharesGuideTones ? 'keeps the tritone' : ''}`,
  )
}

console.log()
