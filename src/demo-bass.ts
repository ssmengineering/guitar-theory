/**
 * Bass lines.
 *   npm run demo:bass
 */

import { FENDER } from './guitar/instrument.js'
import { alternatingBass, walkingBass, type BassBar } from './guitar/bass.js'
import { chord, chordName } from './notes/chord.js'
import { parseNote } from './notes/pitch.js'
import { scaleForChord } from './notes/scale.js'
import { MY_HAND } from './hands/profiles.js'
import { arrangeThumbAndFingers } from './hands/bassline.js'

const rule = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

const C = chord(parseNote('C'), 'maj')
const F = chord(parseNote('F'), 'maj')
const G7 = chord(parseNote('G'), '7')
const Dm7 = chord(parseNote('D'), 'm7')
const Cmaj7 = chord(parseNote('C'), 'maj7')

function show(bars: BassBar[], explain = true): void {
  for (const bar of bars) {
    console.log(
      `\n  ${chordName(bar.chord).padEnd(7)} (${scaleForChord(bar.chord).name})`,
    )
    for (const note of bar.notes) {
      const where = `${note.note.string}/${String(note.note.fret).padStart(2)}`
      console.log(
        `    ${note.beat}  ${where}  ${note.label.padEnd(5)}` +
          (explain ? ` ${note.why}` : ''),
      )
    }
  }
}

/* ------------------------------------------------------------------------ */

rule('Walking bass through ii-V-I')
show(walkingBass(FENDER, [Dm7, G7, Cmaj7, Cmaj7], { fretRange: [0, 9] }))

/* ------------------------------------------------------------------------ */

rule('The alternating thumb, with walk-ups')
show(alternatingBass(FENDER, [C, C, F, G7], { fretRange: [0, 5] }))

/* ------------------------------------------------------------------------ */

rule('The same pattern alternating to the 3rd instead of the 5th')
show(
  alternatingBass(FENDER, [C, F], { fretRange: [0, 5], alternateWith: 3 }),
  false,
)

/* ------------------------------------------------------------------------ */

rule('Thumb and fingers chosen together')

const arranged = arrangeThumbAndFingers(FENDER, [C, F, G7, C], MY_HAND, {
  fretRange: [0, 5],
})

for (const bar of arranged) {
  const grid: string[] = []
  for (let s = 6; s >= 1; s--) {
    const held = bar.voicing?.notes.find((n) => n.string === s)
    grid.push((held ? String(held.fret) : '.').padStart(2))
  }
  console.log(
    `
  ${chordName(bar.chord).padEnd(7)} fingers ${grid.join('')}   ` +
      `${bar.playable ? 'works' : 'DOES NOT WORK'}`,
  )
  for (const note of bar.notes) {
    const mark = note.reach.reachable ? ' ' : '!'
    console.log(
      `   ${mark} ${note.beat}  ${note.note.string}/${String(note.note.fret).padStart(2)}  ` +
        `${note.label.padEnd(5)} ${note.reach.method.padEnd(15)} ${note.reach.why}`,
    )
  }
}

console.log()
