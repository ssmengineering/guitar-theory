/**
 * Intervals as things you do with your hands.
 *
 * A book will tell you a minor 3rd is three semitones. That is true and it has
 * never once helped anybody find one on a guitar. On the fretboard a b3 is:
 *
 *   3 frets up on the same string
 *   1 string toward the treble, 2 frets back
 *   2 strings toward the treble, 2 frets up      (and 3 if you cross G to B)
 *
 * Those are the same interval and they are five different physical moves. This
 * module treats the moves as the primary definition and the semitone count as
 * the arithmetic behind it - which is the right way round for a player.
 */

import { degreeLabel, type Interval } from '../notes/interval.js'
import { intervalPitchClass } from '../notes/interval.js'
import type { ChordSymbol } from '../notes/chord.js'
import { toPitchClass } from '../notes/pitch.js'
import { toneRoles, type ToneKind } from '../notes/scale.js'
import { midiAt, type Instrument, type StringNumber } from './instrument.js'
import { crossesAnomaly, fretsBetweenStrings } from './tuning.js'

export interface IntervalShape {
  interval: Interval
  /** The lower-sounding note's string - the higher number. */
  lowString: StringNumber
  /** The higher-sounding note's string. Equal to lowString for one-string moves. */
  highString: StringNumber
  /** Frets from the low note to the high note. Negative means back toward the nut. */
  fretOffset: number
  /** How many strings the move crosses. */
  stringSpan: number
  /** True when this pair straddles an irregular string pair, e.g. G to B. */
  crossesAnomaly: boolean
}

export interface ShapeOptions {
  /** How many strings the move may span. Default 3. */
  maxStringSpan?: number
  /** Fret window for the move. Default -4 to +5. */
  fretRange?: [number, number]
  /** Include moves that stay on one string. Default true. */
  includeSameString?: boolean
}

/** Frets in an interval. The number a guitarist actually counts. */
export const fretsIn = (interval: Interval): number => interval.semitones

/**
 * Every physical way to play an interval, as a move from one place to another.
 * This is the raw material for "show me every b3 from this note".
 */
export function shapesFor(
  instrument: Instrument,
  interval: Interval,
  options: ShapeOptions = {},
): IntervalShape[] {
  const {
    maxStringSpan = 3,
    fretRange = [-4, 5],
    includeSameString = true,
  } = options
  const stringCount = instrument.tuning.length
  const found: IntervalShape[] = []

  for (let low = stringCount; low >= 1; low--) {
    for (let high = low; high >= Math.max(1, low - maxStringSpan); high--) {
      if (high === low && !includeSameString) continue
      const stringGap =
        high === low ? 0 : fretsBetweenStrings(instrument, low as StringNumber, high as StringNumber)
      const fretOffset = interval.semitones - stringGap
      if (fretOffset < fretRange[0] || fretOffset > fretRange[1]) continue

      found.push({
        interval,
        lowString: low as StringNumber,
        highString: high as StringNumber,
        fretOffset,
        stringSpan: low - high,
        crossesAnomaly:
          crossesAnomaly(instrument, low as StringNumber, high as StringNumber).length > 0,
      })
    }
  }
  return found
}

/** Describe a move the way you would say it out loud to another player. */
export function describeShape(shape: IntervalShape): string {
  const frets =
    shape.fretOffset === 0
      ? 'same fret'
      : shape.fretOffset > 0
        ? `${shape.fretOffset} fret${shape.fretOffset === 1 ? '' : 's'} up`
        : `${-shape.fretOffset} fret${shape.fretOffset === -1 ? '' : 's'} back`

  if (shape.stringSpan === 0) return `${frets} on the same string`
  const strings = `${shape.stringSpan} string${shape.stringSpan === 1 ? '' : 's'} toward the treble`
  return `${strings}, ${frets}`
}

/** "b3 - 3 frets" */
export function intervalInFrets(interval: Interval): string {
  const frets = fretsIn(interval)
  return `${degreeLabel(interval)} - ${frets} fret${frets === 1 ? '' : 's'}`
}

/**
 * The octave shapes. Worth having on their own because finding the same note
 * somewhere else is the first fretboard skill, and the shape changes by exactly
 * one fret the moment the pair crosses the G and B strings.
 */
export function octaveShapes(instrument: Instrument): IntervalShape[] {
  return shapesFor(instrument, { degree: 8, semitones: 12 }, {
    maxStringSpan: 3,
    fretRange: [0, 5],
    includeSameString: false,
  })
}

/** What interval is this move? Answers in frets, plus the likeliest degree. */
export function intervalOfMove(
  instrument: Instrument,
  low: { string: StringNumber; fret: number },
  high: { string: StringNumber; fret: number },
): { frets: number; interval: Interval } {
  const frets = midiAt(instrument, high.string, high.fret) - midiAt(instrument, low.string, low.fret)
  return { frets, interval: commonInterval(frets) }
}

/** Most likely spelling for a raw fret count, absent chord context. */
export function commonInterval(frets: number): Interval {
  const octaves = Math.floor(frets / 12)
  const within = ((frets % 12) + 12) % 12
  const table: [number, number][] = [
    [1, 0], [2, 1], [2, 2], [3, 3], [3, 4], [4, 5],
    [4, 6], [5, 7], [6, 8], [6, 9], [7, 10], [7, 11],
  ]
  const [degree, semitones] = table[within]!
  return { degree: degree + octaves * 7, semitones: semitones + octaves * 12 }
}

export interface FretboardCell {
  string: StringNumber
  fret: number
  interval: Interval
  /** 'R', 'b3', '#9' - what the app prints on the dot. */
  label: string
}

/**
 * Every place a chord's tones fall inside a fret window, labelled by degree.
 *
 * This is the primitive behind the improvisation HUD: lock a position, name the
 * chord, and see which dots are chord tones - in degrees, not letter names,
 * because the degree is what tells you how the note will behave.
 */
export function fretboardMap(
  instrument: Instrument,
  rootPitchClass: number,
  intervals: Interval[],
  fretRange: [number, number] = [0, 12],
): FretboardCell[] {
  const byPitchClass = new Map<number, Interval>()
  for (const interval of intervals) {
    byPitchClass.set((rootPitchClass + intervalPitchClass(interval)) % 12, interval)
  }

  const cells: FretboardCell[] = []
  for (let string = 1; string <= instrument.tuning.length; string++) {
    for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
      const pc = (((midiAt(instrument, string as StringNumber, fret) % 12) + 12) % 12)
      const interval = byPitchClass.get(pc)
      if (!interval) continue
      cells.push({
        string: string as StringNumber,
        fret,
        interval,
        label: degreeLabel(interval),
      })
    }
  }
  return cells
}

/**
 * Every note in a fret window, sorted into chord tone, tension and avoid note.
 *
 * This is the improvisation HUD in one function: lock a position, name the
 * chord, and see which dots are safe, which are colour, and which lean on
 * something underneath them. In degrees rather than letter names, because the
 * degree is what tells you how a note will behave when the chord changes
 * beneath it - and the whole point of watching this is that the same five frets
 * recolour while your hand stays put.
 */
export interface PositionCell {
  string: StringNumber
  fret: number
  midi: number
  kind: ToneKind
  label: string
  why: string
}

export function positionMap(
  instrument: Instrument,
  symbol: ChordSymbol,
  fretRange: [number, number] = [0, 12],
): PositionCell[] {
  const roles = new Map(
    toneRoles(symbol, toPitchClass(symbol.root)).map((role) => [role.pitchClass, role]),
  )

  const cells: PositionCell[] = []
  for (let string = 1; string <= instrument.tuning.length; string++) {
    for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
      const midi = midiAt(instrument, string as StringNumber, fret)
      const role = roles.get(((midi % 12) + 12) % 12)
      if (!role) continue
      cells.push({
        string: string as StringNumber,
        fret,
        midi,
        kind: role.kind,
        label: role.label,
        why: role.why,
      })
    }
  }
  return cells
}
