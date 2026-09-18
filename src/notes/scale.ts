/**
 * Scales, and which one belongs to a chord.
 *
 * A scale here is primarily a set of semitone offsets, because that is what the
 * bass-line generator and the fretboard map actually need - which notes are
 * available over this chord. Where a clean seven-note spelling exists it is
 * given too, so the app can say "that is the b6" rather than "that is 8".
 *
 * The diminished and altered scales deliberately have no spelling. An eight-note
 * scale cannot be spelled with seven letter names without doubling a degree, and
 * inventing a fake spelling to fill the field would be worse than admitting it.
 */

import { degreeLabel, type Interval } from './interval.js'
import type { ChordSymbol } from './chord.js'

export interface Scale {
  name: string
  /** Semitones above the root. The definition. */
  offsets: number[]
  /** Degree spelling, where a seven-note one exists. */
  intervals?: Interval[]
}

const iv = (degree: number, semitones: number): Interval => ({ degree, semitones })

const mode = (name: string, steps: [number, number][]): Scale => ({
  name,
  offsets: steps.map(([, semitones]) => semitones),
  intervals: steps.map(([degree, semitones]) => iv(degree, semitones)),
})

export const IONIAN = mode('Ionian', [
  [1, 0], [2, 2], [3, 4], [4, 5], [5, 7], [6, 9], [7, 11],
])
export const DORIAN = mode('Dorian', [
  [1, 0], [2, 2], [3, 3], [4, 5], [5, 7], [6, 9], [7, 10],
])
export const PHRYGIAN = mode('Phrygian', [
  [1, 0], [2, 1], [3, 3], [4, 5], [5, 7], [6, 8], [7, 10],
])
export const LYDIAN = mode('Lydian', [
  [1, 0], [2, 2], [3, 4], [4, 6], [5, 7], [6, 9], [7, 11],
])
export const MIXOLYDIAN = mode('Mixolydian', [
  [1, 0], [2, 2], [3, 4], [4, 5], [5, 7], [6, 9], [7, 10],
])
export const AEOLIAN = mode('Aeolian', [
  [1, 0], [2, 2], [3, 3], [4, 5], [5, 7], [6, 8], [7, 10],
])
export const LOCRIAN = mode('Locrian', [
  [1, 0], [2, 1], [3, 3], [4, 5], [5, 6], [6, 8], [7, 10],
])
export const LYDIAN_DOMINANT = mode('Lydian dominant', [
  [1, 0], [2, 2], [3, 4], [4, 6], [5, 7], [6, 9], [7, 10],
])
export const MELODIC_MINOR = mode('Melodic minor', [
  [1, 0], [2, 2], [3, 3], [4, 5], [5, 7], [6, 9], [7, 11],
])
export const HARMONIC_MINOR = mode('Harmonic minor', [
  [1, 0], [2, 2], [3, 3], [4, 5], [5, 7], [6, 8], [7, 11],
])

/** Eight notes, so no honest seven-degree spelling. */
export const HALF_WHOLE: Scale = {
  name: 'Half-whole diminished',
  offsets: [0, 1, 3, 4, 6, 7, 9, 10],
}
export const WHOLE_HALF: Scale = {
  name: 'Whole-half diminished',
  offsets: [0, 2, 3, 5, 6, 8, 9, 11],
}
export const ALTERED: Scale = {
  name: 'Altered',
  offsets: [0, 1, 3, 4, 6, 8, 10],
}

/**
 * The scale that goes with a chord.
 *
 * This is chord-scale theory in one table, and it is worth saying plainly what
 * it is for: the chord tells you which notes are structural, the scale tells you
 * which of the notes in between you can pass through without it sounding like a
 * mistake. Bass lines, passing tones and improvisation all come from that gap.
 */
export function scaleForChord(symbol: ChordSymbol): Scale {
  switch (symbol.quality) {
    case 'maj':
    case 'maj7':
    case 'maj9':
    case 'maj13':
    case '6':
    case '6/9':
    case 'add9':
      return IONIAN
    case 'maj7#11':
      return LYDIAN
    case 'min':
    case 'm7':
    case 'm9':
    case 'm11':
    case 'm6':
      return DORIAN
    case 'mMaj7':
      return MELODIC_MINOR
    case 'm7b5':
      return LOCRIAN
    case 'dim':
    case 'dim7':
      return WHOLE_HALF
    case '7':
    case '9':
    case '13':
    case 'sus2':
    case 'sus4':
    case '7sus4':
      return MIXOLYDIAN
    case '7#11':
      return LYDIAN_DOMINANT
    case '7b9':
    case '7#9':
      return HALF_WHOLE
    case '7b13':
    case 'aug':
      return ALTERED
    default:
      return IONIAN
  }
}

/** The scale's notes as pitch classes, given a root pitch class. */
export const scalePitchClasses = (rootPitchClass: number, scale: Scale): number[] =>
  scale.offsets.map((offset) => (rootPitchClass + offset) % 12)

/* What each note over a chord is actually doing --------------------------- */

export type ToneKind = 'chord-tone' | 'tension' | 'avoid'

export interface ToneRole {
  pitchClass: number
  kind: ToneKind
  /** Degree relative to the chord root, e.g. 'R', 'b7', '11'. */
  label: string
  why: string
}

const SEMITONE_DEGREES: [number, number][] = [
  [1, 0], [2, 1], [2, 2], [3, 3], [3, 4], [4, 5],
  [4, 6], [5, 7], [6, 8], [6, 9], [7, 10], [7, 11],
]

/**
 * Sort every note of the chord's scale into chord tone, available tension, or
 * avoid note.
 *
 * The avoid rule is the one worth knowing: a scale tone sitting a HALF STEP
 * above a chord tone will fight it. That is why the 4th sounds wrong held over
 * a major chord - it is a semitone above the 3rd - and why the same note is
 * perfectly good over the minor chord a third below, where nothing is sitting
 * underneath it. It is not that the note is forbidden; it is that it leans hard
 * on its neighbour and wants to move.
 */
export function toneRoles(symbol: ChordSymbol, rootPitchClass: number): ToneRole[] {
  const scale = scaleForChord(symbol)
  const chordPcs = new Map<number, Interval>()
  for (const interval of symbol.intervals) {
    const pc = (rootPitchClass + (((interval.semitones % 12) + 12) % 12)) % 12
    chordPcs.set(pc, interval)
  }

  const hasSeventh = symbol.intervals.some((x) => x.degree === 7)

  return scalePitchClasses(rootPitchClass, scale).map((pc) => {
    const chordTone = chordPcs.get(pc)
    if (chordTone) {
      return {
        pitchClass: pc,
        kind: 'chord-tone' as const,
        label: labelFor(chordTone, hasSeventh),
        why: 'a chord tone - it will always sound right, on any beat',
      }
    }

    const semitones = ((pc - rootPitchClass) % 12 + 12) % 12
    const [degree, exact] = SEMITONE_DEGREES[semitones]!
    const interval: Interval = { degree, semitones: exact }
    const label = labelFor(interval, hasSeventh)

    // A half step above a chord tone is the one to be careful with.
    const clashesWith = [...chordPcs.entries()].find(
      ([chordPc]) => ((pc - chordPc) % 12 + 12) % 12 === 1,
    )
    if (clashesWith) {
      return {
        pitchClass: pc,
        kind: 'avoid' as const,
        label,
        why:
          `a half step above the ${labelFor(clashesWith[1], hasSeventh)} - it leans on it. ` +
          'Fine passing through, rough sitting on.',
      }
    }

    return {
      pitchClass: pc,
      kind: 'tension' as const,
      label,
      why: 'in the scale and clear of every chord tone - colour you can land on',
    }
  })
}

/** Extensions read as 9, 11 and 13 once the chord has a 7th in it. */
function labelFor(interval: Interval, hasSeventh: boolean): string {
  if (!hasSeventh) return degreeLabel(interval)
  const raised: Record<number, number> = { 2: 9, 4: 11, 6: 13 }
  const degree = raised[interval.degree]
  if (degree === undefined) return degreeLabel(interval)
  return degreeLabel({ degree, semitones: interval.semitones + 12 })
}
