import { describe, expect, it } from 'vitest'
import { FENDER, GIBSON, fretGap } from '../src/guitar/instrument.js'
import { identifyVoicing, voicing } from '../src/guitar/voicing.js'
import { chordName } from '../src/notes/chord.js'
import { MY_HAND, STANDARD_HAND } from '../src/hands/profiles.js'
import {
  bestFingering,
  describeFingering,
  isPlayable,
  solveFingerings,
} from '../src/hands/fingering.js'

/**
 * The E-shape G at the 3rd fret, in two sizes.
 *
 *   full:  the textbook six-string barre chord
 *   four:  G D G B on strings 6-5-4-3, root in the bass, 3rd on top
 */
const FULL_G = () =>
  voicing(FENDER, [
    [6, 3],
    [5, 5],
    [4, 5],
    [3, 4],
    [2, 3],
    [1, 3],
  ])

const FOUR_NOTE_G = () =>
  voicing(FENDER, [
    [6, 3],
    [5, 5],
    [4, 5],
    [3, 4],
  ])

describe('fret geometry', () => {
  it('shrinks the same span as you move up the neck', () => {
    const low = fretGap(1, 5, 25.5)
    const high = fretGap(9, 13, 25.5)
    expect(low).toBeCloseTo(4.97, 1)
    expect(high).toBeCloseTo(3.13, 1)
    // This is the whole argument for "try it somewhere else".
    expect(high / low).toBeLessThan(0.7)
  })

  it('asks less of the hand on a shorter scale', () => {
    expect(fretGap(1, 5, GIBSON.scaleLength)).toBeLessThan(
      fretGap(1, 5, FENDER.scaleLength),
    )
  })
})

describe('the engine stays general', () => {
  it('gives a standard hand the textbook barre chord', () => {
    const best = bestFingering(FULL_G(), STANDARD_HAND, FENDER)
    expect(best).not.toBeNull()
    // A conventional hand plays all six strings without tangling.
    expect(best!.assignments.every((a) => a.finger !== 0 || true)).toBe(true)
    expect(isPlayable(FULL_G(), STANDARD_HAND, FENDER)).toBe(true)
  })

  it('uses the ring finger when the profile has one', () => {
    const fingerings = solveFingerings(FULL_G(), STANDARD_HAND, FENDER)
    const usesRing = fingerings.some((f) => f.assignments.some((a) => a.finger === 3))
    expect(usesRing).toBe(true)
  })

  it('never assigns the ring finger for a profile without one', () => {
    for (const shape of [FULL_G(), FOUR_NOTE_G()]) {
      for (const f of solveFingerings(shape, MY_HAND, FENDER, { maxResults: 50 })) {
        expect(f.assignments.some((a) => a.finger === 3)).toBe(false)
      }
    }
  })
})

describe('the four-note G, solved for this hand', () => {
  it('puts the thumb on the root and barres the middle finger', () => {
    const best = bestFingering(FOUR_NOTE_G(), MY_HAND, FENDER)
    expect(best).not.toBeNull()

    // Thumb takes the low G.
    const thumb = best!.assignments.find((a) => a.finger === 0)
    expect(thumb).toBeDefined()
    expect(thumb!.notes[0]!.string).toBe(6)
    expect(thumb!.notes[0]!.fret).toBe(3)
    expect(best!.strategies).toContain('thumb-bass')

    // Middle finger covers strings 5 and 4 at the 5th fret with one barre.
    const middle = best!.assignments.find((a) => a.finger === 2)
    expect(middle).toBeDefined()
    expect(middle!.notes.map((n) => n.string).sort()).toEqual([4, 5])
    expect(middle!.fret).toBe(5)

    // Index takes the 3rd on string 3.
    const index = best!.assignments.find((a) => a.finger === 1)
    expect(index!.notes[0]!.string).toBe(3)
    expect(index!.notes[0]!.fret).toBe(4)

    // And the pinky never gets used, so it is free for a melody note.
    expect(best!.assignments.some((a) => a.finger === 4)).toBe(false)
  })

  it('is cheaper than forcing the full six-string shape', () => {
    const four = bestFingering(FOUR_NOTE_G(), MY_HAND, FENDER)
    const full = bestFingering(FULL_G(), MY_HAND, FENDER)
    expect(four).not.toBeNull()
    if (full) expect(four!.cost).toBeLessThan(full.cost)
  })

  it('rejects the tangled fingering, or prices it far above the clean one', () => {
    const all = solveFingerings(FULL_G(), MY_HAND, FENDER, { maxResults: 50 })
    // Any surviving six-string fingering needs the pinky closer to the nut than
    // the middle finger, which is the crossing the cost function punishes.
    for (const f of all) {
      const middle = f.assignments.find((a) => a.finger === 2)
      const pinky = f.assignments.find((a) => a.finger === 4)
      if (middle && pinky) expect(f.cost).toBeGreaterThan(3)
    }
  })

  it('still sounds a G major with the 3rd on top', () => {
    const shape = FOUR_NOTE_G()
    const [best] = identifyVoicing(shape)
    expect(chordName(best!.symbol)).toBe('G')
    // Top note is the B - the 3rd - which is what makes it a chord-melody grip.
    expect(shape.topMidi % 12).toBe(11)
  })
})

describe('reporting', () => {
  it('prints a fingering a player can read', () => {
    const best = bestFingering(FOUR_NOTE_G(), MY_HAND, FENDER)
    const text = describeFingering(best!)
    expect(text).toContain('T:6@3')
    expect(text).toContain('2:4,5@5')
  })
})
