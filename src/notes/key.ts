/**
 * Keys, and what a chord's number means.
 *
 * A number is not stored anywhere. It is computed from the chord and the key
 * every time it is asked for, because the moment you store "this is the 5 chord"
 * alongside "this is G7" you have two facts that can disagree, and in a theory
 * app a disagreement shows up as wrong information taught to yourself.
 *
 * Deriving it also makes transposition free: a progression that knows its
 * numbers can be printed in any key without anything being rewritten.
 */

import { transpose, type Interval } from './interval.js'
import { noteName, toPitchClass, type SpelledNote } from './pitch.js'
import {
  AEOLIAN,
  DORIAN,
  IONIAN,
  LOCRIAN,
  LYDIAN,
  MIXOLYDIAN,
  PHRYGIAN,
  type Scale,
} from './scale.js'

export type Mode =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'

export interface Key {
  tonic: SpelledNote
  mode: Mode
}

const MODE_SCALES: Record<Mode, Scale> = {
  major: IONIAN,
  minor: AEOLIAN,
  dorian: DORIAN,
  phrygian: PHRYGIAN,
  lydian: LYDIAN,
  mixolydian: MIXOLYDIAN,
  locrian: LOCRIAN,
}

export const key = (tonic: SpelledNote, mode: Mode = 'major'): Key => ({ tonic, mode })

export const keyScale = (k: Key): Scale => MODE_SCALES[k.mode]

export function keyName(k: Key): string {
  return `${noteName(k.tonic)}${k.mode === 'major' ? '' : ` ${k.mode}`}`
}

/** The seven degrees of the key, as spelled notes. */
export function keyNotes(k: Key): SpelledNote[] {
  const scale = keyScale(k)
  return scale.intervals!.map((interval) => transpose(k.tonic, interval))
}

export interface Degree {
  /** 1 through 7, by letter name. */
  degree: number
  /** 0 diatonic, -1 flattened, +1 raised. */
  alteration: number
}

/**
 * Which degree of the key a note is, and by how much it is bent.
 *
 * Worked off the LETTER, not the sound, which is the whole reason notes are
 * spelled. In C, Bb is the flat seven and A# is the sharp six. They sound
 * identical and they are different numbers, and a chart that calls one the other
 * will read wrong to anybody playing from it.
 */
export function degreeOf(k: Key, note: SpelledNote): Degree {
  const letterDistance = (((note.letter - k.tonic.letter) % 7) + 7) % 7
  const degree = letterDistance + 1
  const natural = keyScale(k).intervals![degree - 1]!

  const actual = ((toPitchClass(note) - toPitchClass(k.tonic) + 12) % 12)
  let alteration = actual - (natural.semitones % 12)
  if (alteration > 6) alteration -= 12
  if (alteration < -6) alteration += 12

  return { degree, alteration }
}

/** The root note for a degree of the key, spelled the way the key spells it. */
export function degreeRoot(k: Key, degree: number, alteration = 0): SpelledNote {
  const natural = keyScale(k).intervals![degree - 1]!
  const shifted: Interval = {
    degree: natural.degree,
    semitones: natural.semitones + alteration,
  }
  return transpose(k.tonic, shifted)
}

/** Written the way it appears in front of a numeral: "b", "#", or nothing. */
export const alterationSign = (alteration: number): string =>
  alteration === 0 ? '' : alteration < 0 ? 'b'.repeat(-alteration) : '#'.repeat(alteration)

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const

export const romanFor = (degree: number): string => ROMAN[degree - 1] ?? String(degree)

/** Is this pitch class in the key at all? */
export function isDiatonic(k: Key, note: SpelledNote): boolean {
  return degreeOf(k, note).alteration === 0
}

/**
 * The triads or seventh chords built on each degree.
 * Quality falls out of the scale rather than being listed, so it stays correct
 * in dorian and mixolydian without a second table.
 */
export function diatonicQualities(k: Key, sevenths = false): string[] {
  const scale = keyScale(k)
  const offsets = scale.offsets
  const qualities: string[] = []

  for (let i = 0; i < 7; i++) {
    const at = (n: number) => (offsets[(i + n) % 7]! + (i + n >= 7 ? 12 : 0) - offsets[i]! + 24) % 12
    const third = at(2)
    const fifth = at(4)
    const seventh = at(6)

    let quality: string
    if (third === 4 && fifth === 7) quality = sevenths ? (seventh === 11 ? 'maj7' : '7') : 'maj'
    else if (third === 3 && fifth === 7) quality = sevenths ? 'm7' : 'min'
    else if (third === 3 && fifth === 6) quality = sevenths ? 'm7b5' : 'dim'
    else if (third === 4 && fifth === 8) quality = sevenths ? 'maj7' : 'aug'
    else quality = sevenths ? 'm7' : 'min'
    qualities.push(quality)
  }
  return qualities
}
