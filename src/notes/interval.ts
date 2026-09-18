/**
 * Interval arithmetic.
 *
 * An interval carries TWO numbers, and the pair is the whole point:
 *
 *   degree     which chord tone it is     (the 3rd, the 7th, the 9th)
 *   semitones  how many frets you move    (4 frets, 10 frets, 14 frets)
 *
 * b3 and #9 are both 3 frets apart on one string. They differ only in degree -
 * 3 versus 9 - and that is what lets the app say "that is the sharp nine, you
 * are playing a Hendrix chord" instead of "that is a flat third, you are
 * playing a minor chord". One number cannot tell those apart. Two can.
 *
 * For intervals as physical moves on the neck - which string, how many frets,
 * and why the shape changes across the G and B strings - see guitar/shapes.ts.
 * That file is where an interval becomes something you can put your fingers on.
 */

import {
  LETTER_SEMITONES,
  type Alter,
  type Letter,
  type SpelledNote,
  toMidi,
} from './pitch.js'

export interface Interval {
  /** Diatonic size: 1 = unison, 3 = third, 7 = seventh, 9 = ninth, 13 = thirteenth. */
  degree: number
  /** Actual distance in semitones. May exceed 12 for compound intervals. */
  semitones: number
}

export const iv = (degree: number, semitones: number): Interval => ({ degree, semitones })

/* Simple intervals ------------------------------------------------------- */
export const P1 = iv(1, 0)
export const A1 = iv(1, 1)
export const m2 = iv(2, 1)
export const M2 = iv(2, 2)
export const m3 = iv(3, 3)
export const M3 = iv(3, 4)
export const P4 = iv(4, 5)
export const A4 = iv(4, 6)
export const d5 = iv(5, 6)
export const P5 = iv(5, 7)
export const A5 = iv(5, 8)
export const m6 = iv(6, 8)
export const M6 = iv(6, 9)
export const d7 = iv(7, 9)
export const m7 = iv(7, 10)
export const M7 = iv(7, 11)
export const P8 = iv(8, 12)

/* Compound intervals - the tensions. Spelled as 9/11/13, never 2/4/6. ----- */
export const b9 = iv(9, 13)
export const M9 = iv(9, 14)
export const s9 = iv(9, 15) // #9 - same sound as m3, different meaning
export const P11 = iv(11, 17)
export const s11 = iv(11, 18) // #11 - same sound as d5
export const b13 = iv(13, 20)
export const M13 = iv(13, 21) // same sound as M6

/** Semitones spanned by `degree` letter-steps of a natural scale from C. */
function naturalSemitones(degree: number): number {
  const steps = degree - 1
  return 12 * Math.floor(steps / 7) + LETTER_SEMITONES[(steps % 7) as Letter]
}

/**
 * Quality name relative to the natural interval of that degree:
 * P/M/m/d/A. Used for display and for debugging bad chord spellings.
 */
export function intervalName(interval: Interval): string {
  const delta = interval.semitones - naturalSemitones(interval.degree)
  const perfectDegree = [1, 4, 5, 8, 11, 12, 15].includes(interval.degree)
  let quality: string
  if (delta === 0) quality = perfectDegree ? 'P' : 'M'
  else if (delta === -1) quality = perfectDegree ? 'd' : 'm'
  else if (delta === -2) quality = perfectDegree ? 'dd' : 'd'
  else if (delta === 1) quality = 'A'
  else if (delta === 2) quality = 'AA'
  else quality = `${delta > 0 ? '+' : ''}${delta}`
  return quality + String(interval.degree)
}

/**
 * How the interval reads as a chord degree: "R", "b3", "#9", "b7".
 * This is the label the fretboard shows, and it is the vocabulary the whole
 * app teaches in place of letter names.
 */
export function degreeLabel(interval: Interval): string {
  const simple = simplify(interval)
  if (simple.degree === 1 && simple.semitones === 0) return 'R'
  const delta = interval.semitones - naturalSemitones(interval.degree)
  const sign = delta === 0 ? '' : delta < 0 ? 'b'.repeat(-delta) : '#'.repeat(delta)
  return sign + String(interval.degree)
}

/** Reduce a compound interval into a single octave: M9 becomes M2. */
export function simplify(interval: Interval): Interval {
  let { degree, semitones } = interval
  while (degree > 7 && semitones >= 12) {
    degree -= 7
    semitones -= 12
  }
  return { degree, semitones }
}

/** Where the interval lands on the 12-tone clock, ignoring octave and spelling. */
export function intervalPitchClass(interval: Interval): number {
  return ((interval.semitones % 12) + 12) % 12
}

/** Same sound, e.g. m3 and #9 - true. Same meaning - not necessarily. */
export function isEnharmonicInterval(a: Interval, b: Interval): boolean {
  return intervalPitchClass(a) === intervalPitchClass(b)
}

/**
 * Move a note by an interval, keeping the spelling correct.
 *
 * The letter is decided by the degree, then the accidental is whatever it takes
 * to land on the right sound. That ordering is what makes C + #9 come back as
 * D# rather than Eb.
 */
export function transpose(n: SpelledNote, interval: Interval): SpelledNote {
  const letterIndex = n.letter + (interval.degree - 1)
  const letter = (((letterIndex % 7) + 7) % 7) as Letter
  const octave = n.octave + Math.floor(letterIndex / 7)
  const naturalMidi = (octave + 1) * 12 + LETTER_SEMITONES[letter]
  const alter = toMidi(n) + interval.semitones - naturalMidi
  if (alter < -2 || alter > 2) {
    throw new Error(
      `Transposing ${n.letter}/${n.alter} by ${intervalName(interval)} needs ` +
        `${alter} accidentals, which is past double sharp/flat.`,
    )
  }
  return { letter, alter: alter as Alter, octave }
}

/** The interval from `a` up to `b`. Negative semitones if `b` is below `a`. */
export function intervalBetween(a: SpelledNote, b: SpelledNote): Interval {
  const letterDistance = b.letter - a.letter + 7 * (b.octave - a.octave)
  return { degree: letterDistance + 1, semitones: toMidi(b) - toMidi(a) }
}
