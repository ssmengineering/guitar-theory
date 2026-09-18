/**
 * Layer 3 - The instrument.
 *
 * This is the first file that knows what a guitar is. Everything below it in
 * src/theory is pure music and stays that way.
 *
 * The important content here is fret geometry. Frets are spaced exponentially,
 * so the same shape needs meaningfully less reach the further up the neck you
 * play it. On a 25.5" scale a four-fret span at the 1st fret asks the hand to
 * cover about 4.97 inches; the identical span at the 9th fret asks for 3.13.
 * That 37% difference is why "try it somewhere else on the neck" is a real
 * answer to an unplayable chord and not just encouragement.
 */

import { parseNote, toMidi, type SpelledNote } from '../notes/pitch.js'

/** Strings are numbered the way players number them: 1 is the high E. */
export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6

export interface Instrument {
  name: string
  /** Index 0 is string 1 (high E), index 5 is string 6 (low E). */
  tuning: SpelledNote[]
  /** Nut to bridge, in inches. */
  scaleLength: number
  fretCount: number
  capo?: number
}

export const SCALE_LENGTHS = {
  gibson: 24.75,
  gretsch: 24.6,
  fender: 25.5,
} as const

export const STANDARD_TUNING: SpelledNote[] = [
  parseNote('E4'),
  parseNote('B3'),
  parseNote('G3'),
  parseNote('D3'),
  parseNote('A2'),
  parseNote('E2'),
]

export const DROP_D_TUNING: SpelledNote[] = [
  ...STANDARD_TUNING.slice(0, 5),
  parseNote('D2'),
]

export function guitar(
  name: string,
  scaleLength: number,
  tuning: SpelledNote[] = STANDARD_TUNING,
  fretCount = 20,
): Instrument {
  return { name, tuning, scaleLength, fretCount }
}

export const GIBSON = guitar('Gibson-scale', SCALE_LENGTHS.gibson)
export const FENDER = guitar('Fender-scale', SCALE_LENGTHS.fender)

/**
 * Distance from the nut to a fret, in inches.
 *
 * Each fret divides the remaining string length by the twelfth root of two,
 * which is the same equal-temperament ratio the pitch system runs on. The
 * geometry of the neck and the mathematics of the scale are literally the same
 * equation, which is a nice thing to be able to show a student.
 */
export function fretFromNut(fret: number, scaleLength: number): number {
  return scaleLength * (1 - Math.pow(2, -fret / 12))
}

/** Inches between two frets. Shrinks as the numbers get higher. */
export function fretGap(lowFret: number, highFret: number, scaleLength: number): number {
  return fretFromNut(highFret, scaleLength) - fretFromNut(lowFret, scaleLength)
}

/**
 * Inches the hand must actually cover for a set of fretted notes. Open strings
 * are excluded because they cost no reach at all.
 */
export function physicalSpan(frets: number[], scaleLength: number): number {
  const fretted = frets.filter((f) => f > 0)
  if (fretted.length < 2) return 0
  return fretGap(Math.min(...fretted), Math.max(...fretted), scaleLength)
}

/** MIDI number sounding at a given string and fret. */
export function midiAt(
  instrument: Instrument,
  string: StringNumber,
  fret: number,
): number {
  const open = instrument.tuning[string - 1]
  if (!open) throw new Error(`Instrument has no string ${string}`)
  return toMidi(open) + fret + (fret > 0 ? (instrument.capo ?? 0) : 0)
}

/**
 * Every place a pitch class can be played, low to high.
 * The raw material for "show me this voicing somewhere else".
 */
export function positionsOf(
  instrument: Instrument,
  pitchClass: number,
  fretRange: [number, number] = [0, instrument.fretCount],
): { string: StringNumber; fret: number; midi: number }[] {
  const found: { string: StringNumber; fret: number; midi: number }[] = []
  for (let s = 1; s <= instrument.tuning.length; s++) {
    for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
      const midi = midiAt(instrument, s as StringNumber, fret)
      if (((midi % 12) + 12) % 12 === pitchClass) {
        found.push({ string: s as StringNumber, fret, midi })
      }
    }
  }
  return found.sort((a, b) => a.midi - b.midi)
}
