import { describe, expect, it } from 'vitest'
import {
  DROP_D_TUNING,
  FENDER,
  guitar,
  SCALE_LENGTHS,
} from '../src/guitar/instrument.js'
import {
  crossesAnomaly,
  fretsBetweenStrings,
  shapeShift,
  tuningProfile,
} from '../src/guitar/tuning.js'
import {
  commonInterval,
  describeShape,
  fretboardMap,
  fretsIn,
  intervalInFrets,
  intervalOfMove,
  octaveShapes,
  shapesFor,
} from '../src/guitar/shapes.js'
import { M3, m3, P5 } from '../src/notes/interval.js'
import { qualityByName } from '../src/notes/chord.js'

describe('the tuning', () => {
  it('finds the G-to-B anomaly without being told about it', () => {
    const profile = tuningProfile(FENDER)
    expect(profile.regularStep).toBe(5)
    expect(profile.anomalies).toHaveLength(1)

    const odd = profile.anomalies[0]!
    expect(odd.lower).toBe(3) // G string
    expect(odd.higher).toBe(2) // B string
    expect(odd.frets).toBe(4)
    expect(odd.shift).toBe(1) // shapes gain a fret crossing it
  })

  it('stays correct in a tuning that is not standard', () => {
    const dropD = guitar('Drop D', SCALE_LENGTHS.fender, DROP_D_TUNING)
    const profile = tuningProfile(dropD)
    // Low E down to D makes string 6 to 5 a 7-fret gap, so now there are two
    // irregular pairs, not one. Nothing about the code assumed otherwise.
    expect(profile.anomalies.length).toBe(2)
    expect(fretsBetweenStrings(dropD, 6, 5)).toBe(7)
  })

  it('measures the gap between any two strings at the same fret', () => {
    expect(fretsBetweenStrings(FENDER, 6, 5)).toBe(5)
    expect(fretsBetweenStrings(FENDER, 3, 2)).toBe(4) // the odd one
    expect(fretsBetweenStrings(FENDER, 6, 4)).toBe(10)
    expect(fretsBetweenStrings(FENDER, 4, 2)).toBe(9)
  })

  it('explains the +1 fret when a shape crosses G to B', () => {
    // The octave shape on 6-4 versus the same octave on 4-2.
    expect(shapeShift(FENDER, [6, 4], [4, 2])).toBe(1)
    expect(shapeShift(FENDER, [6, 4], [5, 3])).toBe(0)
  })

  it('knows which moves straddle the irregular pair', () => {
    expect(crossesAnomaly(FENDER, 4, 2)).toHaveLength(1)
    expect(crossesAnomaly(FENDER, 6, 4)).toHaveLength(0)
  })
})

describe('intervals as shapes', () => {
  it('gives the two octave shapes every guitarist learns first', () => {
    const shapes = octaveShapes(FENDER)

    const sixToFour = shapes.find((s) => s.lowString === 6 && s.highString === 4)!
    expect(sixToFour.fretOffset).toBe(2)
    expect(describeShape(sixToFour)).toBe('2 strings toward the treble, 2 frets up')

    // Same shape, one string pair over, and it needs an extra fret.
    const fourToTwo = shapes.find((s) => s.lowString === 4 && s.highString === 2)!
    expect(fourToTwo.fretOffset).toBe(3)
    expect(fourToTwo.crossesAnomaly).toBe(true)
  })

  it('finds a b3 as several different physical moves', () => {
    const shapes = shapesFor(FENDER, m3)
    const sameString = shapes.find((s) => s.stringSpan === 0)!
    expect(sameString.fretOffset).toBe(3)
    expect(describeShape(sameString)).toBe('3 frets up on the same string')

    // One string over, on a regular pair: 5 frets of string, so 2 frets back.
    const adjacent = shapes.find((s) => s.lowString === 5 && s.highString === 4)!
    expect(adjacent.fretOffset).toBe(-2)
    expect(describeShape(adjacent)).toBe('1 string toward the treble, 2 frets back')

    // Across G to B the same move needs one more fret.
    const acrossGB = shapes.find((s) => s.lowString === 3 && s.highString === 2)!
    expect(acrossGB.fretOffset).toBe(-1)
  })

  it('counts a P5 as 7 frets, which is what a player actually counts', () => {
    expect(fretsIn(P5)).toBe(7)
    expect(intervalInFrets(m3)).toBe('b3 - 3 frets')
    expect(intervalInFrets(M3)).toBe('3 - 4 frets')
  })

  it('reads a move back off the neck', () => {
    // A string 5th fret up to D string 7th fret.
    const result = intervalOfMove(FENDER, { string: 5, fret: 5 }, { string: 4, fret: 7 })
    expect(result.frets).toBe(7)
    expect(result.interval.degree).toBe(5)
  })

  it('spells a raw fret count the common way', () => {
    expect(commonInterval(4)).toEqual(M3)
    expect(commonInterval(7)).toEqual(P5)
    expect(commonInterval(12)).toEqual({ degree: 8, semitones: 12 })
  })
})

describe('the fretboard map behind the improv HUD', () => {
  it('labels chord tones by degree, not by letter name', () => {
    // G7 across the first five frets.
    const cells = fretboardMap(FENDER, 7, qualityByName('7').intervals, [0, 5])

    const labels = new Set(cells.map((c) => c.label))
    expect(labels).toEqual(new Set(['R', '3', '5', 'b7']))

    // Low E string, 3rd fret is the root.
    const lowRoot = cells.find((c) => c.string === 6 && c.fret === 3)!
    expect(lowRoot.label).toBe('R')

    // Open D string is the 5th of G.
    const openD = cells.find((c) => c.string === 4 && c.fret === 0)!
    expect(openD.label).toBe('5')
  })

  it('finds every root in the window, not just the first', () => {
    const cells = fretboardMap(FENDER, 7, qualityByName('maj').intervals, [0, 12])
    const roots = cells.filter((c) => c.label === 'R')
    expect(roots.length).toBeGreaterThan(3)
  })
})
