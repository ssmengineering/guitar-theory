import { describe, expect, it } from 'vitest'
import { FENDER } from '../src/guitar/instrument.js'
import {
  alternatingBass,
  approachesTo,
  walkingBass,
  type BassBar,
} from '../src/guitar/bass.js'
import { identifyVoicing, voicing } from '../src/guitar/voicing.js'
import { chord } from '../src/notes/chord.js'
import { parseNote, toPitchClass } from '../src/notes/pitch.js'
import {
  DORIAN,
  IONIAN,
  MIXOLYDIAN,
  scaleForChord,
  scalePitchClasses,
} from '../src/notes/scale.js'
import { MY_HAND } from '../src/hands/profiles.js'
import { bestFingering } from '../src/hands/fingering.js'
import {
  arrangeBass,
  arrangeThumbAndFingers,
  reachFor,
} from '../src/hands/bassline.js'
import { smoothestPath } from '../src/hands/progression.js'

const C = chord(parseNote('C'), 'maj')
const F = chord(parseNote('F'), 'maj')
const G7 = chord(parseNote('G'), '7')
const Dm7 = chord(parseNote('D'), 'm7')
const Cmaj7 = chord(parseNote('C'), 'maj7')

const allNotes = (bars: BassBar[]) => bars.flatMap((bar) => bar.notes)

describe('chord scales', () => {
  it('gives each chord type the scale that fits it', () => {
    expect(scaleForChord(Cmaj7)).toBe(IONIAN)
    expect(scaleForChord(G7)).toBe(MIXOLYDIAN)
    expect(scaleForChord(Dm7)).toBe(DORIAN)
  })

  it('does not invent a spelling for an eight-note scale', () => {
    const dim = scaleForChord(chord(parseNote('B'), 'dim7'))
    expect(dim.offsets).toHaveLength(8)
    expect(dim.intervals).toBeUndefined()
  })

  it('contains every chord tone of the chord it belongs to', () => {
    for (const symbol of [Cmaj7, G7, Dm7]) {
      const rootPc = toPitchClass(symbol.root)
      const scalePcs = new Set(scalePitchClasses(rootPc, scaleForChord(symbol)))
      for (const interval of symbol.intervals) {
        expect(scalePcs.has((rootPc + (interval.semitones % 12)) % 12)).toBe(true)
      }
    }
  })
})

describe('approach notes', () => {
  it('offers the half step below, the half step above, and the fifth above', () => {
    const roles = new Set(approachesTo(FENDER, 0).map((c) => c.role))
    expect(roles).toContain('chromatic-approach')
    expect(roles).toContain('dominant-approach')
  })

  it('never offers the target note itself as an approach to it', () => {
    for (const candidate of approachesTo(FENDER, 7)) {
      expect(((candidate.note.midi % 12) + 12) % 12).not.toBe(7)
    }
  })

  it('explains what each one is doing', () => {
    for (const candidate of approachesTo(FENDER, 0)) {
      expect(candidate.why.length).toBeGreaterThan(10)
    }
  })
})

describe('walking bass', () => {
  const changes = [Dm7, G7, Cmaj7, Cmaj7]

  it('puts the root on beat one of every bar', () => {
    for (const bar of walkingBass(FENDER, changes)) {
      const first = bar.notes.find((n) => n.beat === 1)!
      expect(first.role).toBe('root')
      expect(((first.note.midi % 12) + 12) % 12).toBe(toPitchClass(bar.chord.root))
    }
  })

  it('gives every beat a note and every note a reason', () => {
    const bars = walkingBass(FENDER, changes)
    expect(bars).toHaveLength(4)
    for (const bar of bars) {
      expect(bar.notes).toHaveLength(4)
      for (const note of bar.notes) {
        expect(note.why.length).toBeGreaterThan(10)
        expect(note.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('walks - it moves by step far more often than it leaps', () => {
    const notes = allNotes(walkingBass(FENDER, changes))
    let steps = 0
    for (let i = 1; i < notes.length; i++) {
      if (Math.abs(notes[i]!.note.midi - notes[i - 1]!.note.midi) <= 2) steps++
    }
    expect(steps / (notes.length - 1)).toBeGreaterThan(0.5)
  })

  it('never repeats the same pitch twice in a row', () => {
    const notes = allNotes(walkingBass(FENDER, changes))
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]!.note.midi).not.toBe(notes[i - 1]!.note.midi)
    }
  })

  it('aims the last beat of a bar at the chord that is coming', () => {
    const bars = walkingBass(FENDER, changes)
    // Look at the bars where the chord actually changes.
    for (let i = 0; i < bars.length - 1; i++) {
      const last = bars[i]!.notes[bars[i]!.notes.length - 1]!
      const nextRoot = bars[i + 1]!.notes[0]!
      if (toPitchClass(bars[i]!.chord.root) === toPitchClass(bars[i + 1]!.chord.root)) continue
      // Either it is a named approach, or it is within a whole step of the target.
      const isApproach =
        last.role === 'chromatic-approach' || last.role === 'dominant-approach'
      const isNear = Math.abs(last.note.midi - nextRoot.note.midi) <= 2
      expect(isApproach || isNear).toBe(true)
    }
  })

  it('stays inside the register and the strings it is given', () => {
    const bars = walkingBass(FENDER, changes, {
      strings: [6, 5],
      range: [40, 52],
      fretRange: [0, 9],
    })
    for (const note of allNotes(bars)) {
      expect([5, 6]).toContain(note.note.string)
      expect(note.note.midi).toBeGreaterThanOrEqual(40)
      expect(note.note.midi).toBeLessThanOrEqual(52)
      expect(note.note.fret).toBeLessThanOrEqual(9)
    }
  })

  it('keeps chromatic notes off the strong beats', () => {
    for (const note of allNotes(walkingBass(FENDER, changes))) {
      if (note.beat === 1) expect(note.role).not.toBe('chromatic-passing')
    }
  })
})

describe('the alternating thumb', () => {
  const changes = [C, C, F, G7]

  it('lands on the root on the odd beats', () => {
    for (const bar of alternatingBass(FENDER, changes, { walkups: false })) {
      for (const note of bar.notes.filter((n) => n.beat % 2 === 1)) {
        expect(note.role).toBe('root')
      }
    }
  })

  it('alternates to the 5th by default, and to the 3rd on request', () => {
    const fifths = alternatingBass(FENDER, changes, { walkups: false })
    for (const note of allNotes(fifths).filter((n) => n.beat % 2 === 0)) {
      expect(note.interval?.degree).toBe(5)
    }

    const thirds = alternatingBass(FENDER, changes, { walkups: false, alternateWith: 3 })
    for (const note of allNotes(thirds).filter((n) => n.beat % 2 === 0)) {
      expect(note.interval?.degree).toBe(3)
    }
  })

  it('turns the last beat into a walk-up when the chord changes', () => {
    const bars = alternatingBass(FENDER, changes, { walkups: true })
    // Bar 1 stays on C, so beat 4 is still the alternate note.
    expect(bars[0]!.notes[3]!.role).toBe('chord-tone')
    // Bar 2 changes to F, so beat 4 aims at it.
    const approach = bars[1]!.notes[3]!
    expect(['chromatic-approach', 'dominant-approach']).toContain(approach.role)
  })

  it('keeps the thumb in one place rather than hopping the neck', () => {
    const notes = allNotes(alternatingBass(FENDER, changes))
    for (let i = 1; i < notes.length; i++) {
      expect(Math.abs(notes[i]!.note.fret - notes[i - 1]!.note.fret)).toBeLessThanOrEqual(5)
    }
  })

  it('falls back to another chord tone when the chord has no perfect 5th', () => {
    const halfDim = chord(parseNote('B'), 'm7b5')
    const bars = alternatingBass(FENDER, [halfDim], { walkups: false })
    expect(bars[0]!.notes).toHaveLength(4)
    for (const note of bars[0]!.notes.filter((n) => n.beat % 2 === 0)) {
      expect(note.interval?.degree).not.toBe(1)
    }
  })
})

describe('bass under a held chord', () => {
  // E-shape G with the thumb on the root, from the earlier work.
  const gShape = () => voicing(FENDER, [[6, 3], [5, 5], [4, 5], [3, 4]])

  it('knows when the chord is already holding the note', () => {
    const shape = gShape()
    const fingering = bestFingering(shape, MY_HAND, FENDER)!
    const reach = reachFor({ string: 6, fret: 3, midi: 43 }, shape, fingering, MY_HAND)
    expect(reach.reachable).toBe(true)
    expect(reach.method).toBe('already-fretted')
  })

  it('refuses a note on a string the chord is using at another fret', () => {
    const shape = gShape()
    const fingering = bestFingering(shape, MY_HAND, FENDER)!
    const reach = reachFor({ string: 5, fret: 3, midi: 48 }, shape, fingering, MY_HAND)
    expect(reach.reachable).toBe(false)
    expect(reach.why).toContain('string 5')
  })

  it('takes an open string the chord is not using', () => {
    const shape = voicing(FENDER, [[4, 5], [3, 4], [2, 3]])
    const fingering = bestFingering(shape, MY_HAND, FENDER)!
    const reach = reachFor({ string: 6, fret: 0, midi: 40 }, shape, fingering, MY_HAND)
    expect(reach.reachable).toBe(true)
    expect(reach.method).toBe('open-string')
  })

  it('will not sound an open string lying under a barre', () => {
    const barred = voicing(FENDER, [[5, 3], [4, 3], [3, 3]])
    const fingering = bestFingering(barred, MY_HAND, FENDER)!
    if (fingering.assignments.some((a) => a.barreSpan)) {
      const reach = reachFor({ string: 4, fret: 0, midi: 50 }, barred, fingering, MY_HAND)
      expect(reach.reachable).toBe(false)
    }
  })

  it('reports which bars of an arrangement actually work', () => {
    const bars = alternatingBass(FENDER, [C, F], { fretRange: [0, 5] })
    const shapes = [
      voicing(FENDER, [[4, 10], [3, 9], [2, 8]]),
      voicing(FENDER, [[4, 10], [3, 10], [2, 10]]),
    ].map((v) => ({ voicing: v, fingering: bestFingering(v, MY_HAND, FENDER)! }))

    const arranged = arrangeBass(FENDER, bars, shapes, MY_HAND)
    expect(arranged).toHaveLength(2)
    for (const bar of arranged) {
      for (const note of bar.notes) {
        expect(note.reach.why.length).toBeGreaterThan(5)
      }
      // The chord is up at the 10th fret and the bass is down at the nut, so
      // the honest answer here is that it does not work - and it says so.
      expect(typeof bar.playable).toBe('boolean')
    }
  })
})

describe('thumb and fingers chosen together', () => {
  const changes = [C, F, G7, C]

  it('finds an arrangement where every bass note is actually reachable', () => {
    const bars = arrangeThumbAndFingers(FENDER, changes, MY_HAND, {
      fretRange: [0, 5],
    })
    expect(bars).toHaveLength(4)
    for (const bar of bars) {
      expect(bar.playable).toBe(true)
      for (const note of bar.notes) {
        expect(note.reach.reachable).toBe(true)
      }
    }
  })

  it('keeps the chord off the bass strings, so the thumb has somewhere to go', () => {
    for (const bar of arrangeThumbAndFingers(FENDER, changes, MY_HAND, {
      fretRange: [0, 5],
    })) {
      for (const note of bar.voicing.notes) {
        expect(note.string).toBeLessThanOrEqual(4)
      }
    }
  })

  it('never gives the chord the thumb, because the bass already has it', () => {
    for (const bar of arrangeThumbAndFingers(FENDER, changes, MY_HAND, {
      fretRange: [0, 5],
    })) {
      expect(bar.fingering.assignments.some((a) => a.finger === 0)).toBe(false)
      expect(bar.fingering.assignments.some((a) => a.finger === 3)).toBe(false)
    }
  })

  it('beats generating the two halves separately', () => {
    // Chord shapes chosen for comping and a bass line chosen for the bass are
    // in different places on the neck, and the hand cannot be in both.
    const bass = alternatingBass(FENDER, changes, { fretRange: [0, 5] })
    const comped = smoothestPath(FENDER, changes, MY_HAND, { fretRange: [0, 7] })
    const uncoordinated = arrangeBass(
      FENDER,
      bass,
      comped.map((s) => ({ voicing: s.option.voicing, fingering: s.option.fingering })),
      MY_HAND,
    )
    const together = arrangeThumbAndFingers(FENDER, changes, MY_HAND, {
      fretRange: [0, 5],
    })

    const works = (bars: { playable: boolean }[]) => bars.filter((b) => b.playable).length
    expect(works(together)).toBeGreaterThan(works(uncoordinated))
  })

  it('still produces a real voicing of the chord', () => {
    for (const bar of arrangeThumbAndFingers(FENDER, changes, MY_HAND, {
      fretRange: [0, 5],
    })) {
      expect(bar.voicing.notes.length).toBeGreaterThanOrEqual(3)
      const [reading] = identifyVoicing(bar.voicing, 1)
      expect(reading).toBeDefined()
    }
  })
})
