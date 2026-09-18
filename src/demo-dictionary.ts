/**
 * The generated chord dictionary.
 *   npm run demo:dict
 */

import { FENDER } from './guitar/instrument.js'
import { byTopDegree, generateVoicings, stringSetKey } from './guitar/generate.js'
import { voicing } from './guitar/voicing.js'
import { chord, chordName } from './notes/chord.js'
import { degreeLabel } from './notes/interval.js'
import { parseNote } from './notes/pitch.js'
import { MY_HAND, STANDARD_HAND } from './hands/profiles.js'
import { chordDictionary, explain, findAlternatives } from './hands/dictionary.js'
import { describeFingering } from './hands/fingering.js'
import type { PlayableVoicing } from './hands/dictionary.js'

const rule = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

const Cmaj7 = chord(parseNote('C'), 'maj7')

/** "x 3 5 4 5 x" across strings 6..1 */
const grid = (entry: PlayableVoicing): string => {
  const byString = new Map(entry.voicing.notes.map((n) => [n.string, n.fret]))
  const cells: string[] = []
  for (let s = 6; s >= 1; s--) {
    const fret = byString.get(s as 1 | 2 | 3 | 4 | 5 | 6)
    cells.push((fret === undefined ? 'x' : String(fret)).padStart(2))
  }
  return cells.join('')
}

const row = (entry: PlayableVoicing): string =>
  `  ${entry.cost.toFixed(2).padStart(5)}  ${grid(entry)}   ` +
  `${entry.roles.map((r) => r.label).join(' ').padEnd(14)} ` +
  `top:${degreeLabel(entry.topInterval).padEnd(3)} ` +
  `${describeFingering(entry.fingering)}`

/* ------------------------------------------------------------------------ */

rule(`${chordName(Cmaj7)} - how many voicings exist at all`)

const everything = generateVoicings(FENDER, Cmaj7, { fretRange: [0, 12], maxResults: 2000 })
console.log(`  ${everything.length} voicings across frets 0-12, before any hand.`)
const tops = byTopDegree(everything)
console.log(
  `  By melody note: ` +
    [...tops.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v.length}`)
      .join('  '),
)

/* ------------------------------------------------------------------------ */

rule(`${chordName(Cmaj7)} - the ten easiest, for each hand`)

for (const hand of [STANDARD_HAND, MY_HAND]) {
  console.log(`\n  ${hand.name}`)
  for (const entry of chordDictionary(FENDER, Cmaj7, hand, {
    fretRange: [0, 9],
    moveableOnly: true,
    limit: 6,
  })) {
    console.log(row(entry))
  }
}

/* ------------------------------------------------------------------------ */

rule('Ted Greene style: Cmaj7 on strings 5-4-3-2, third in the melody')

for (const entry of chordDictionary(FENDER, Cmaj7, MY_HAND, {
  stringSets: [[2, 3, 4, 5]],
  topDegree: 3,
  fretRange: [0, 12],
  moveableOnly: true,
  limit: 6,
})) {
  console.log(row(entry))
}

/* ------------------------------------------------------------------------ */

rule('"I cannot play this one." x-3-5-4-5-x')

const awkward = voicing(FENDER, [
  [5, 3],
  [4, 5],
  [3, 4],
  [2, 5],
])
console.log(`  target string set ${stringSetKey(awkward.stringSet)}, ` +
  `span ${awkward.fretSpan} frets\n`)

for (const option of findAlternatives(FENDER, Cmaj7, awkward, MY_HAND, {
  keepTopNote: true,
  fretRange: [0, 12],
  moveableOnly: true,
  limit: 4,
})) {
  console.log(row(option))
  for (const reason of explain(option, awkward)) {
    console.log(`          - ${reason}`)
  }
  console.log()
}
