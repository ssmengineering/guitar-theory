/**
 * Layer 3 - Voicings.
 *
 * A voicing is a set of specific notes at specific places on the neck. Two
 * deliberate choices here, both of which come straight from how Ted Greene
 * organises Chord Chemistry:
 *
 *   1. `notes` is a sparse list, not a six-slot array. String sets like 6-4-3-2
 *      that skip a string are ordinary citizens, not an array full of nulls.
 *   2. `topMidi` is promoted to its own field, because a huge number of useful
 *      questions are really "what is in the melody?" - and in chord melody
 *      playing the top voice is the tune, so it is a hard constraint when
 *      searching for substitutes.
 */

import { identifyChord, type ChordCandidate } from '../notes/chord.js'
import {
  midiAt,
  physicalSpan,
  type Instrument,
  type StringNumber,
} from './instrument.js'

export interface VoicedNote {
  string: StringNumber
  /** 0 means open. */
  fret: number
  midi: number
}

export interface Voicing {
  notes: VoicedNote[]
  /** Strings used, high to low: [1, 2, 3, 5] for a set that skips string 4. */
  stringSet: StringNumber[]
  /** The melody note. */
  topMidi: number
  bassMidi: number
  lowestFret: number
  highestFret: number
  /** Distance in frets, ignoring open strings. */
  fretSpan: number
}

/** Build a voicing from [string, fret] pairs. Use -1 for a muted string. */
export function voicing(
  instrument: Instrument,
  positions: [StringNumber, number][],
): Voicing {
  const notes: VoicedNote[] = positions
    .filter(([, fret]) => fret >= 0)
    .map(([string, fret]) => ({ string, fret, midi: midiAt(instrument, string, fret) }))
    .sort((a, b) => a.midi - b.midi)

  if (notes.length === 0) throw new Error('A voicing needs at least one note')

  const fretted = notes.map((x) => x.fret).filter((f) => f > 0)
  const lowestFret = fretted.length ? Math.min(...fretted) : 0
  const highestFret = fretted.length ? Math.max(...fretted) : 0

  return {
    notes,
    stringSet: notes.map((x) => x.string).sort((a, b) => a - b),
    topMidi: notes[notes.length - 1]!.midi,
    bassMidi: notes[0]!.midi,
    lowestFret,
    highestFret,
    fretSpan: fretted.length ? highestFret - lowestFret : 0,
  }
}

/** Inches of reach this voicing demands on a given instrument. */
export function voicingSpanInches(v: Voicing, instrument: Instrument): number {
  return physicalSpan(
    v.notes.map((x) => x.fret),
    instrument.scaleLength,
  )
}

/** What chords could this shape be? Bass note is taken into account. */
export function identifyVoicing(v: Voicing, maxResults = 6): ChordCandidate[] {
  return identifyChord(
    v.notes.map((x) => ((x.midi % 12) + 12) % 12),
    { bassPitchClass: ((v.bassMidi % 12) + 12) % 12, maxResults },
  )
}

/** Move a voicing along the neck. Open strings block transposition. */
export function transposeVoicing(
  v: Voicing,
  instrument: Instrument,
  semitones: number,
): Voicing | null {
  const moved: [StringNumber, number][] = []
  for (const note of v.notes) {
    const fret = note.fret + semitones
    if (fret < 1 || fret > instrument.fretCount) return null
    moved.push([note.string, fret])
  }
  return voicing(instrument, moved)
}

/** ASCII chord diagram, handy in tests and in the terminal. */
export function diagram(v: Voicing): string {
  const byString = new Map(v.notes.map((x) => [x.string, x.fret]))
  const lines: string[] = []
  for (let s = 1; s <= 6; s++) {
    const fret = byString.get(s as StringNumber)
    const label = fret === undefined ? 'x' : String(fret)
    lines.push(`${s}|${label.padStart(2, ' ')}`)
  }
  return lines.join('\n')
}
