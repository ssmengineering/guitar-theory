/**
 * Bass lines - walking, and the alternating thumb.
 *
 * You already play these. The chromatic walk-up into the next chord, the thumb
 * dropping to the 5th on beat two, the passing note that gets you from the root
 * to the third - those are in your hands and have been for years. What this file
 * does is put names on them, so a move you make by instinct in G becomes a move
 * you can deliberately make in Db.
 *
 * Every note that comes out carries its role: whether it is a chord tone, a
 * scale tone passing between two of them, a chromatic filler, or an approach
 * note aimed at the chord that is coming. That last category is the engine of
 * the whole thing - a bass line is mostly the art of arriving somewhere on
 * purpose.
 */

import type { ChordSymbol } from '../notes/chord.js'
import { degreeLabel, intervalPitchClass, type Interval } from '../notes/interval.js'
import { toPitchClass } from '../notes/pitch.js'
import { scaleForChord, scalePitchClasses } from '../notes/scale.js'
import { midiAt, type Instrument, type StringNumber } from './instrument.js'
import type { VoicedNote } from './voicing.js'

export type BassRole =
  | 'root'
  | 'chord-tone'
  | 'scale-tone'
  | 'chromatic-passing'
  | 'chromatic-approach'
  | 'dominant-approach'

export interface BassNote {
  /** 1-indexed within the bar. */
  beat: number
  bar: number
  note: VoicedNote
  role: BassRole
  /** What it is in the current chord, when it is a chord tone. */
  interval?: Interval
  /** Which side an approach note comes from. */
  approachFrom?: 'below' | 'above'
  /** 'R', '5', 'b7', or a short name for the passing function. */
  label: string
  /** Why this note is here, in the words you would use teaching it. */
  why: string
}

export interface BassBar {
  bar: number
  chord: ChordSymbol
  notes: BassNote[]
}

export interface BassOptions {
  /** Strings the thumb works on. Default 6, 5 and 4. */
  strings?: StringNumber[]
  fretRange?: [number, number]
  beatsPerBar?: number
  /** Keep the line inside this many semitones, so it stays in register. */
  range?: [number, number]
}

interface Candidate {
  note: VoicedNote
  role: BassRole
  interval?: Interval
  approachFrom?: 'below' | 'above'
  label: string
  why: string
}

const positions = (
  instrument: Instrument,
  pitchClass: number,
  strings: StringNumber[],
  fretRange: [number, number],
  range: [number, number],
): VoicedNote[] => {
  const found: VoicedNote[] = []
  for (const string of strings) {
    for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
      const midi = midiAt(instrument, string, fret)
      if (midi < range[0] || midi > range[1]) continue
      if ((((midi % 12) + 12) % 12) !== pitchClass) continue
      found.push({ string, fret, midi })
    }
  }
  return found
}

/**
 * Ways to arrive at a target root, which is most of what a bass line is doing
 * on the last beat of a bar.
 */
export function approachesTo(
  instrument: Instrument,
  targetPitchClass: number,
  options: BassOptions = {},
): Candidate[] {
  const {
    strings = [6, 5, 4],
    fretRange = [0, 12],
    range = [28, 60],
  } = options

  const make = (
    offset: number,
    role: BassRole,
    label: string,
    why: string,
    approachFrom?: 'below' | 'above',
  ): Candidate[] =>
    positions(instrument, (targetPitchClass + offset + 12) % 12, strings, fretRange, range).map(
      (note) => ({ note, role, label, why, approachFrom }),
    )

  return [
    ...make(
      -1,
      'chromatic-approach',
      'app.',
      'a half step below the next root - the strongest way in, because it leans upward into it',
      'below',
    ),
    ...make(
      1,
      'chromatic-approach',
      'app.',
      'a half step above the next root, falling into it',
      'above',
    ),
    ...make(
      7,
      'dominant-approach',
      'V',
      'a fifth above the next root, so the bass makes its own V-I into the change',
    ),
    ...make(
      5,
      'dominant-approach',
      'IV',
      'a fourth above the next root - the same cadence pulling the other way',
    ),
  ]
}

/** Chord tones and scale tones available over a chord, as playable positions. */
function poolFor(
  instrument: Instrument,
  symbol: ChordSymbol,
  options: Required<Pick<BassOptions, 'strings' | 'fretRange' | 'range'>>,
): Candidate[] {
  const rootPc = toPitchClass(symbol.root)
  const scale = scaleForChord(symbol)
  const scalePcs = new Set(scalePitchClasses(rootPc, scale))

  const chordPcs = new Map<number, Interval>()
  for (const interval of symbol.intervals) {
    chordPcs.set((rootPc + intervalPitchClass(interval)) % 12, interval)
  }

  const pool: Candidate[] = []

  for (const [pc, interval] of chordPcs) {
    for (const note of positions(instrument, pc, options.strings, options.fretRange, options.range)) {
      pool.push({
        note,
        role: interval.degree === 1 ? 'root' : 'chord-tone',
        interval,
        label: degreeLabel(interval),
        why:
          interval.degree === 1
            ? 'the root - where the bar lands'
            : `the ${degreeLabel(interval)} - a chord tone, so it is safe on any beat`,
      })
    }
  }

  for (const pc of scalePcs) {
    if (chordPcs.has(pc)) continue
    for (const note of positions(instrument, pc, options.strings, options.fretRange, options.range)) {
      pool.push({
        note,
        role: 'scale-tone',
        label: 'sc.',
        why: `from the ${scale.name} scale over this chord - fine passing between chord tones`,
      })
    }
  }

  // Everything else is chromatic. Usable, but only in passing.
  for (let pc = 0; pc < 12; pc++) {
    if (chordPcs.has(pc) || scalePcs.has(pc)) continue
    for (const note of positions(instrument, pc, options.strings, options.fretRange, options.range)) {
      pool.push({
        note,
        role: 'chromatic-passing',
        label: 'chr.',
        why: 'outside the scale - only works moving through, never landing',
      })
    }
  }

  return pool
}

/** How much a jump between two consecutive bass notes costs. */
function stepCost(from: VoicedNote, to: VoicedNote): number {
  const distance = Math.abs(to.midi - from.midi)
  let cost: number
  if (distance === 0) cost = 6 // repeating a note stops the line walking
  else if (distance <= 2) cost = 0
  else if (distance <= 4) cost = 1
  else if (distance <= 7) cost = 2.5
  else cost = 5
  // Keep the thumb near where it was.
  return cost + Math.abs(to.fret - from.fret) * 0.3
}

/** How much a note costs in its own right, on this beat. */
function placeCost(candidate: Candidate, beat: number, beatsPerBar: number): number {
  const strong = beat === 1 || beat === Math.floor(beatsPerBar / 2) + 1
  let cost = 0
  if (candidate.role === 'chromatic-passing') cost += strong ? 4 : 1.2
  if (candidate.role === 'scale-tone') cost += strong ? 1.5 : 0.2
  if (candidate.role === 'chromatic-approach' || candidate.role === 'dominant-approach') {
    cost += strong ? 3 : 0
  }
  // The leading tone leans into its target. Approaching from above works and is
  // worth having, but when both are available the one from below wins.
  if (candidate.approachFrom === 'below') cost -= 0.6
  return cost
}

/**
 * What the last three notes look like as a shape.
 *
 * Minimising movement alone produces a line that oscillates between two
 * adjacent notes forever - mathematically optimal, musically dead. A bass line
 * has DIRECTION: it runs somewhere, and turning round is an event rather than
 * the default. This is the term that knows the difference.
 */
function shapeCost(twoBack: VoicedNote, oneBack: VoicedNote, now: VoicedNote): number {
  let cost = 0
  // C-B-C-B: coming straight back to where we were two notes ago.
  if (twoBack.midi === now.midi) cost += 4
  const before = oneBack.midi - twoBack.midi
  const after = now.midi - oneBack.midi
  if (before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after)) cost += 0.7
  return cost
}

/**
 * A walking bass line through a progression.
 *
 * Beat one is the root, the last beat of each bar aims at the next chord, and
 * the beats in between fill the gap by step wherever they can. Solved as a
 * shortest path over the whole line rather than bar by bar, because the note you
 * choose on beat two is only right in light of where beat four has to get to.
 */
export function walkingBass(
  instrument: Instrument,
  progression: ChordSymbol[],
  options: BassOptions = {},
): BassBar[] {
  const {
    strings = [6, 5, 4],
    fretRange = [0, 12],
    beatsPerBar = 4,
    range = [28, 55],
  } = options
  const settings = { strings, fretRange, range }

  if (progression.length === 0) return []

  // One slot per beat, each holding its own candidate notes.
  const slots: { bar: number; beat: number; chord: ChordSymbol; candidates: Candidate[] }[] = []

  progression.forEach((symbol, bar) => {
    const pool = poolFor(instrument, symbol, settings)
    const nextChord = progression[bar + 1]
    const rootPc = toPitchClass(symbol.root)

    for (let beat = 1; beat <= beatsPerBar; beat++) {
      let candidates: Candidate[]
      if (beat === 1) {
        candidates = pool.filter((c) => c.role === 'root')
      } else if (beat === beatsPerBar && nextChord) {
        const nextRootPc = toPitchClass(nextChord.root)
        candidates = [
          ...approachesTo(instrument, nextRootPc, { ...settings }),
          ...pool.filter((c) => c.role === 'chord-tone' || c.role === 'scale-tone'),
        ]
        // A note that is already the next root is an arrival, not an approach.
        candidates = candidates.filter(
          (c) => (((c.note.midi % 12) + 12) % 12) !== nextRootPc,
        )
      } else {
        candidates = pool
      }
      if (candidates.length === 0) candidates = pool
      slots.push({ bar, beat, chord: symbol, candidates })
    }
  })

  if (slots.some((slot) => slot.candidates.length === 0)) return []
  if (slots.length < 3) {
    // Too short to have a shape; just take the cheapest note per beat.
    const chosen = slots.map((slot) => {
      let bestIndex = 0
      let bestValue = Infinity
      slot.candidates.forEach((candidate, index) => {
        const value = placeCost(candidate, slot.beat, beatsPerBar)
        if (value < bestValue) {
          bestValue = value
          bestIndex = index
        }
      })
      return bestIndex
    })
    return collect(slots, chosen, progression)
  }

  // Viterbi whose state is a PAIR of notes, not one. Direction and oscillation
  // are properties of three consecutive notes, so one note of memory is not
  // enough to see them.
  //   best[s][j][i] = cost of reaching candidate j at slot s, arriving from i.
  const width = (s: number) => slots[s]!.candidates.length
  const best: number[][][] = slots.map(() => [])
  const back: number[][][] = slots.map(() => [])

  best[1] = Array.from({ length: width(1) }, () => new Array<number>(width(0)).fill(Infinity))
  for (let j = 0; j < width(1); j++) {
    for (let i = 0; i < width(0); i++) {
      const from = slots[0]!.candidates[i]!
      const to = slots[1]!.candidates[j]!
      best[1]![j]![i] =
        placeCost(from, slots[0]!.beat, beatsPerBar) +
        placeCost(to, slots[1]!.beat, beatsPerBar) +
        stepCost(from.note, to.note)
    }
  }

  for (let s = 2; s < slots.length; s++) {
    const slot = slots[s]!
    best[s] = Array.from({ length: width(s) }, () =>
      new Array<number>(width(s - 1)).fill(Infinity),
    )
    back[s] = Array.from({ length: width(s) }, () => new Array<number>(width(s - 1)).fill(-1))

    for (let k = 0; k < width(s); k++) {
      const now = slot.candidates[k]!
      const own = placeCost(now, slot.beat, beatsPerBar)
      for (let j = 0; j < width(s - 1); j++) {
        const oneBack = slots[s - 1]!.candidates[j]!
        const step = stepCost(oneBack.note, now.note)
        for (let i = 0; i < width(s - 2); i++) {
          const prior = best[s - 1]![j]![i]!
          if (!Number.isFinite(prior)) continue
          const twoBack = slots[s - 2]!.candidates[i]!
          const total =
            prior + own + step + shapeCost(twoBack.note, oneBack.note, now.note)
          if (total < best[s]![k]![j]!) {
            best[s]![k]![j] = total
            back[s]![k]![j] = i
          }
        }
      }
    }
  }

  // Unwind from the cheapest final pair.
  const last = slots.length - 1
  let bestK = 0
  let bestJ = 0
  let bestValue = Infinity
  for (let k = 0; k < width(last); k++) {
    for (let j = 0; j < width(last - 1); j++) {
      if (best[last]![k]![j]! < bestValue) {
        bestValue = best[last]![k]![j]!
        bestK = k
        bestJ = j
      }
    }
  }

  const chosen = new Array<number>(slots.length).fill(0)
  chosen[last] = bestK
  chosen[last - 1] = bestJ
  for (let s = last; s >= 2; s--) {
    const i = back[s]![chosen[s]!]![chosen[s - 1]!]!
    chosen[s - 2] = i
  }

  return collect(slots, chosen, progression)
}

export interface AlternatingOptions extends BassOptions {
  /** What the thumb alternates to. Default the 5th. */
  alternateWith?: 3 | 5
  /** Aim the last beat at the next chord when the chord changes. Default true. */
  walkups?: boolean
}

/**
 * The alternating thumb - the Travis and Chet pattern.
 *
 * Root on the strong beats, the 5th (or the 3rd) in between, and when the chord
 * is about to change the last beat becomes an approach note instead. That final
 * substitution is the walk-up, and it is the thing that makes the pattern sound
 * like music rather than a metronome with a pitch.
 */
export function alternatingBass(
  instrument: Instrument,
  progression: ChordSymbol[],
  options: AlternatingOptions = {},
): BassBar[] {
  const {
    strings = [6, 5, 4],
    fretRange = [0, 12],
    beatsPerBar = 4,
    range = [28, 52],
    alternateWith = 5,
    walkups = true,
  } = options
  const settings = { strings, fretRange, range }

  if (progression.length === 0) return []

  const slots: { bar: number; beat: number; chord: ChordSymbol; candidates: Candidate[] }[] = []

  progression.forEach((symbol, bar) => {
    const pool = poolFor(instrument, symbol, settings)
    const nextChord = progression[bar + 1]
    const changing =
      nextChord !== undefined &&
      toPitchClass(nextChord.root) !== toPitchClass(symbol.root)

    for (let beat = 1; beat <= beatsPerBar; beat++) {
      const onBeatOne = beat % 2 === 1
      let candidates: Candidate[]

      if (walkups && changing && beat === beatsPerBar) {
        candidates = approachesTo(instrument, toPitchClass(nextChord!.root), settings)
      } else if (onBeatOne) {
        candidates = pool.filter((c) => c.role === 'root')
      } else {
        candidates = pool.filter((c) => c.interval?.degree === alternateWith)
        // Not every chord has the degree you asked for - a m7b5 has no perfect
        // 5th to alternate to - so fall back to any chord tone that is not the
        // root rather than silently repeating it.
        if (candidates.length === 0) {
          candidates = pool.filter((c) => c.role === 'chord-tone')
        }
      }
      if (candidates.length === 0) candidates = pool.filter((c) => c.role === 'root')
      slots.push({ bar, beat, chord: symbol, candidates })
    }
  })

  if (slots.some((slot) => slot.candidates.length === 0)) return []

  // Same shortest path, but the candidate sets are already nearly decided; this
  // is choosing WHERE on the neck to play them so the thumb barely moves.
  const best = slots.map((slot) => new Array<number>(slot.candidates.length).fill(Infinity))
  const prev = slots.map((slot) => new Array<number>(slot.candidates.length).fill(-1))
  best[0] = slots[0]!.candidates.map(() => 0)

  for (let s = 1; s < slots.length; s++) {
    const slot = slots[s]!
    for (let j = 0; j < slot.candidates.length; j++) {
      const candidate = slot.candidates[j]!
      for (let i = 0; i < slots[s - 1]!.candidates.length; i++) {
        const from = slots[s - 1]!.candidates[i]!
        // The alternating thumb wants the two notes close together and low.
        const move = Math.abs(candidate.note.midi - from.note.midi)
        const total =
          best[s - 1]![i]! +
          Math.abs(candidate.note.fret - from.note.fret) * 0.6 +
          (move > 9 ? (move - 9) * 0.5 : 0) +
          // Prefer walking up into the next root over dropping onto it. Fret
          // proximity alone picks whichever approach happens to sit closest,
          // which is not a musical reason.
          (candidate.approachFrom === 'below' ? -1.5 : 0)
        if (total < best[s]![j]!) {
          best[s]![j] = total
          prev[s]![j] = i
        }
      }
    }
  }

  const last = slots.length - 1
  let index = best[last]!.indexOf(Math.min(...best[last]!))
  const chosen = new Array<number>(slots.length).fill(0)
  for (let s = last; s >= 0; s--) {
    chosen[s] = index
    index = prev[s]![index]!
  }

  return collect(slots, chosen, progression)
}

function collect(
  slots: { bar: number; beat: number; chord: ChordSymbol; candidates: Candidate[] }[],
  chosen: number[],
  progression: ChordSymbol[],
): BassBar[] {
  const bars: BassBar[] = progression.map((chord, bar) => ({ bar, chord, notes: [] }))
  slots.forEach((slot, s) => {
    const candidate = slot.candidates[chosen[s]!]!
    bars[slot.bar]!.notes.push({
      beat: slot.beat,
      bar: slot.bar,
      note: candidate.note,
      role: candidate.role,
      interval: candidate.interval,
      approachFrom: candidate.approachFrom,
      label: candidate.label,
      why: candidate.why,
    })
  })
  return bars
}

/** One line per note, the way you would explain the line to someone. */
export function describeBassNote(note: BassNote): string {
  return (
    `beat ${note.beat}  string ${note.note.string} fret ${String(note.note.fret).padStart(2)}  ` +
    `${note.label.padEnd(5)} ${note.why}`
  )
}
