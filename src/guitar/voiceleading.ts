/**
 * Voice leading - what each finger does when the chord changes.
 *
 * The single most useful thing this file produces is a sentence like "the b7
 * falls a half step to the 3rd". That is the whole of functional harmony in one
 * observation, and it is invisible if you think of chords as grips that replace
 * each other rather than as voices that move.
 *
 * For fingerstyle it is the difference between playing chords and playing
 * music: the inner line moving under a held melody note is the Chet and Ted
 * Greene sound, and it is almost always a single voice shifting one or two
 * frets while everything around it stays put.
 *
 * The matching is order-preserving - the lowest voice goes to the lowest voice,
 * and so on down the line - which is both the musically correct model and the
 * reason the algorithm is a small dynamic program instead of a search over
 * permutations. Voices are not allowed to cross, because in real voice leading
 * they do not.
 */

import { degreeLabel, intervalPitchClass, type Interval } from '../notes/interval.js'
import { toPitchClass } from '../notes/pitch.js'
import { QUALITIES, chord, spellPitchClass, type ChordSymbol } from '../notes/chord.js'
import type { VoicingAnalysis } from './generate.js'
import { midiAt, type Instrument, type StringNumber } from './instrument.js'
import type { VoicedNote, Voicing } from './voicing.js'

export type MotionKind = 'common' | 'step' | 'leap' | 'added' | 'dropped'

export interface VoiceMotion {
  /** Undefined when a voice appears out of nowhere. */
  from?: VoicedNote
  /** Undefined when a voice drops out. */
  to?: VoicedNote
  /** Signed, in semitones. Negative falls. */
  semitones: number
  kind: MotionKind
  fromInterval?: Interval
  toInterval?: Interval
}

export interface Transition {
  from: Voicing
  to: Voicing
  motions: VoiceMotion[]
  /** Semitones travelled by the voices that persist through the change. */
  totalMotion: number
  commonTones: number
  /**
   * Voices that appear or vanish.
   *
   * These have to count. Measuring only the voices that survive means a change
   * that abandons the entire shape and grabs a different one somewhere else
   * scores as "no movement", which is both false and exactly backwards.
   */
  voicesChanged: number
  /** Frets the hand itself has to travel. Cheap to ignore, expensive to play. */
  handShift: number
  /** The sort key: motion, plus what it costs to change and relocate. */
  effort: number
  /** The largest single jump - a low total with one big leap still plays badly. */
  largestLeap: number
  /** Nothing moves more than a whole step, and no voice enters or leaves. */
  smooth: boolean
}

/** What a voice appearing or vanishing is worth, in semitone-equivalents. */
const VOICE_CHANGE_COST = 2
/** What moving the hand one fret along the neck is worth. */
const HAND_SHIFT_COST = 1

/** What it costs to have a voice appear or vanish, in the alignment. */
const VOICE_GAP_COST = 3

/**
 * Order-preserving alignment of two sets of voices.
 * Classic edit-distance shape: match, drop, or add.
 */
function align(a: VoicedNote[], b: VoicedNote[]): [number | null, number | null][] {
  const n = a.length
  const m = b.length
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  const back: ('match' | 'drop' | 'add')[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill('match'),
  )

  for (let i = 1; i <= n; i++) {
    cost[i]![0] = i * VOICE_GAP_COST
    back[i]![0] = 'drop'
  }
  for (let j = 1; j <= m; j++) {
    cost[0]![j] = j * VOICE_GAP_COST
    back[0]![j] = 'add'
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const matched = cost[i - 1]![j - 1]! + Math.abs(a[i - 1]!.midi - b[j - 1]!.midi)
      const dropped = cost[i - 1]![j]! + VOICE_GAP_COST
      const added = cost[i]![j - 1]! + VOICE_GAP_COST
      const best = Math.min(matched, dropped, added)
      cost[i]![j] = best
      back[i]![j] = best === matched ? 'match' : best === dropped ? 'drop' : 'add'
    }
  }

  const pairs: [number | null, number | null][] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const move = i === 0 ? 'add' : j === 0 ? 'drop' : back[i]![j]!
    if (move === 'match') {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (move === 'drop') {
      pairs.push([i - 1, null])
      i--
    } else {
      pairs.push([null, j - 1])
      j--
    }
  }
  return pairs.reverse()
}

const kindOf = (semitones: number): MotionKind => {
  const distance = Math.abs(semitones)
  if (distance === 0) return 'common'
  if (distance <= 2) return 'step'
  return 'leap'
}

export interface TransitionContext {
  from?: VoicingAnalysis
  to?: VoicingAnalysis
}

/** How the hand gets from one voicing to the next. */
export function transition(
  from: Voicing,
  to: Voicing,
  context: TransitionContext = {},
): Transition {
  const roleOf = (analysis: VoicingAnalysis | undefined, note: VoicedNote) =>
    analysis?.roles.find((r) => r.note === note)?.interval ??
    analysis?.roles.find((r) => r.note.string === note.string && r.note.fret === note.fret)
      ?.interval

  const motions: VoiceMotion[] = []
  for (const [i, j] of align(from.notes, to.notes)) {
    const fromNote = i === null ? undefined : from.notes[i]!
    const toNote = j === null ? undefined : to.notes[j]!

    if (fromNote && toNote) {
      const semitones = toNote.midi - fromNote.midi
      motions.push({
        from: fromNote,
        to: toNote,
        semitones,
        kind: kindOf(semitones),
        fromInterval: roleOf(context.from, fromNote),
        toInterval: roleOf(context.to, toNote),
      })
    } else if (fromNote) {
      motions.push({
        from: fromNote,
        semitones: 0,
        kind: 'dropped',
        fromInterval: roleOf(context.from, fromNote),
      })
    } else if (toNote) {
      motions.push({
        to: toNote,
        semitones: 0,
        kind: 'added',
        toInterval: roleOf(context.to, toNote),
      })
    }
  }

  const moved = motions.filter((x) => x.from && x.to)
  const totalMotion = moved.reduce((sum, x) => sum + Math.abs(x.semitones), 0)
  const largestLeap = moved.reduce((max, x) => Math.max(max, Math.abs(x.semitones)), 0)
  const voicesChanged = motions.filter(
    (x) => x.kind === 'added' || x.kind === 'dropped',
  ).length
  const handShift = Math.abs(to.lowestFret - from.lowestFret)

  return {
    from,
    to,
    motions,
    totalMotion,
    commonTones: motions.filter((x) => x.kind === 'common').length,
    voicesChanged,
    handShift,
    effort:
      totalMotion + voicesChanged * VOICE_CHANGE_COST + handShift * HAND_SHIFT_COST,
    largestLeap,
    smooth: largestLeap <= 2 && voicesChanged === 0,
  }
}

/**
 * One line of plain English per voice.
 * "the b7 falls a half step to the 3rd" is the sentence worth chasing.
 */
export function describeMotion(motion: VoiceMotion): string {
  const naming =
    motion.fromInterval && motion.toInterval
      ? `the ${degreeLabel(motion.fromInterval)} ${
          degreeLabel(motion.fromInterval) === degreeLabel(motion.toInterval)
            ? 'stays put as'
            : 'becomes'
        } the ${degreeLabel(motion.toInterval)}`
      : undefined

  if (motion.kind === 'dropped') {
    return `${motion.fromInterval ? `the ${degreeLabel(motion.fromInterval)}` : 'a voice'} drops out`
  }
  if (motion.kind === 'added') {
    return `${motion.toInterval ? `the ${degreeLabel(motion.toInterval)}` : 'a voice'} comes in`
  }
  if (motion.kind === 'common') {
    return naming
      ? `${naming} - held, no movement`
      : 'held, no movement'
  }

  const distance = Math.abs(motion.semitones)
  const size =
    distance === 1 ? 'a half step' : distance === 2 ? 'a whole step' : `${distance} frets`
  const direction = motion.semitones < 0 ? 'falls' : 'rises'

  if (motion.fromInterval && motion.toInterval) {
    return `the ${degreeLabel(motion.fromInterval)} ${direction} ${size} to the ${degreeLabel(
      motion.toInterval,
    )}`
  }
  return `${direction} ${size}`
}

export function describeTransition(t: Transition): string[] {
  return t.motions.map(describeMotion)
}

/* Choosing the next voicing ---------------------------------------------- */

export interface RankedByMotion<T> {
  candidate: T
  transition: Transition
}

/**
 * Sort candidate voicings by how little the hand has to move to reach them.
 * This is the voice-leading tool and the comping tool and half of the
 * reharmonisation sandbox, all of which are the same sort.
 */
export function rankByMotion(
  current: Voicing,
  candidates: VoicingAnalysis[],
  currentAnalysis?: VoicingAnalysis,
): RankedByMotion<VoicingAnalysis>[] {
  return candidates
    .map((candidate) => ({
      candidate,
      transition: transition(current, candidate.voicing, {
        from: currentAnalysis,
        to: candidate,
      }),
    }))
    .sort(
      (a, b) =>
        a.transition.effort - b.transition.effort ||
        a.transition.largestLeap - b.transition.largestLeap,
    )
}

/* Guide tones ------------------------------------------------------------- */

export interface GuideToneStep {
  chord: ChordSymbol
  note: VoicedNote
  interval: Interval
  label: string
  /** Semitones from the previous step. 0 for the first. */
  motion: number
}

export interface GuideToneOptions {
  /** Which degrees count. Default the 3rd and the 7th. */
  degrees?: number[]
  fretRange?: [number, number]
  stringRange?: [StringNumber, StringNumber]
}

/**
 * The 3rds and 7ths through a progression, connected with the least movement.
 *
 * This is most of bebop pedagogy in one function. The 3rd and the 7th are what
 * make a chord sound like itself; play only those through the changes and the
 * harmony is already unmistakable. Everything else is decoration on top of this
 * line, which is why it is the thing to learn first and the thing to practise
 * when a solo stops making sense.
 *
 * Solved as a shortest path: each chord offers a handful of candidate positions,
 * and the line picks the one that moves least from the note before it.
 */
export function guideToneLine(
  instrument: Instrument,
  progression: ChordSymbol[],
  options: GuideToneOptions = {},
): GuideToneStep[] {
  const {
    degrees = [3, 7],
    fretRange = [0, 12],
    stringRange = [2, 5],
  } = options

  type Candidate = { note: VoicedNote; interval: Interval }

  const layers: Candidate[][] = progression.map((symbol) => {
    const rootPc = toPitchClass(symbol.root)
    const wanted = symbol.intervals.filter((interval) => degrees.includes(interval.degree))
    // A chord with no 7th still has a 3rd; a sus chord has neither, so fall
    // back to whatever defines it rather than returning nothing.
    const tones = wanted.length > 0 ? wanted : symbol.intervals.filter((x) => x.degree !== 1)

    const found: Candidate[] = []
    for (const interval of tones) {
      const pc = (rootPc + intervalPitchClass(interval)) % 12
      for (let string = stringRange[0]; string <= stringRange[1]; string++) {
        for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
          const midi = midiAt(instrument, string as StringNumber, fret)
          if ((((midi % 12) + 12) % 12) !== pc) continue
          found.push({ note: { string: string as StringNumber, fret, midi }, interval })
        }
      }
    }
    return found
  })

  if (layers.some((layer) => layer.length === 0)) return []

  // Viterbi over the layers, minimising total movement.
  const best: number[][] = layers.map((layer) => new Array(layer.length).fill(Infinity))
  const prev: number[][] = layers.map((layer) => new Array(layer.length).fill(-1))
  best[0] = layers[0]!.map(() => 0)

  for (let step = 1; step < layers.length; step++) {
    for (let j = 0; j < layers[step]!.length; j++) {
      for (let i = 0; i < layers[step - 1]!.length; i++) {
        const move = Math.abs(layers[step]![j]!.note.midi - layers[step - 1]![i]!.note.midi)
        const total = best[step - 1]![i]! + move
        if (total < best[step]![j]!) {
          best[step]![j] = total
          prev[step]![j] = i
        }
      }
    }
  }

  const last = layers.length - 1
  let index = best[last]!.indexOf(Math.min(...best[last]!))
  const chosen: number[] = new Array(layers.length).fill(0)
  for (let step = last; step >= 0; step--) {
    chosen[step] = index
    index = prev[step]![index]!
  }

  return layers.map((layer, step) => {
    const candidate = layer[chosen[step]!]!
    const previous = step === 0 ? undefined : layers[step - 1]![chosen[step - 1]!]!
    return {
      chord: progression[step]!,
      note: candidate.note,
      interval: candidate.interval,
      label: degreeLabel(candidate.interval),
      motion: previous ? candidate.note.midi - previous.note.midi : 0,
    }
  })
}

/* Common tones, and substitution ----------------------------------------- */

export interface SharedTone {
  pitchClass: number
  inFirst: Interval
  inSecond: Interval
}

/** The notes two chords have in common, and what each one does in each chord. */
export function commonTones(a: ChordSymbol, b: ChordSymbol): SharedTone[] {
  const rootA = toPitchClass(a.root)
  const rootB = toPitchClass(b.root)
  const inA = new Map<number, Interval>()
  for (const interval of a.intervals) {
    inA.set((rootA + intervalPitchClass(interval)) % 12, interval)
  }

  const shared: SharedTone[] = []
  for (const interval of b.intervals) {
    const pc = (rootB + intervalPitchClass(interval)) % 12
    const match = inA.get(pc)
    if (match) shared.push({ pitchClass: pc, inFirst: match, inSecond: interval })
  }
  return shared
}

export interface Substitution {
  chord: ChordSymbol
  shared: SharedTone[]
  /** Notes in the substitute that were not in the original. */
  changedTones: number
  /** Shares both of the original's guide tones - the 3rd and the 7th. */
  sharesGuideTones: boolean
  /** Same root, so this is really an extension rather than a substitution. */
  sameRoot: boolean
  /** Weighted overlap. Ranks by which tones are shared, not how many. */
  strength: number
}

/**
 * How much a shared tone is worth.
 *
 * Counting shared notes gets this wrong in a way that matters. G7 and Db7 have
 * only two notes in common - but they are B and F, the 3rd and the 7th, the
 * tritone that makes a dominant sound like a dominant. That is the whole reason
 * the tritone substitution works, and a raw count buries it under chords that
 * happen to share a root and a fifth and nothing that matters.
 */
function toneWeight(interval: Interval): number {
  if (interval.degree === 3 || interval.degree === 7) return 3
  if (interval.degree === 6) return 2
  if (interval.degree === 5) return interval.semitones === 7 ? 0.5 : 2
  if (interval.degree >= 9) return 1.5
  return 1
}

/**
 * Chords that can stand in for this one because they share enough notes.
 *
 * Ted Greene's substitution principle, made mechanical: two chords sharing two
 * or three tones will generally sit in the same hole in a progression. The
 * tritone sub, the relative minor, the III for I - they all fall out of this
 * rather than needing to be memorised as separate rules.
 */
export function substitutesFor(
  symbol: ChordSymbol,
  options: { minShared?: number; maxResults?: number } = {},
): Substitution[] {
  const { minShared = 3, maxResults = 12 } = options
  const originalPcs = new Set(
    symbol.intervals.map(
      (interval) => (toPitchClass(symbol.root) + intervalPitchClass(interval)) % 12,
    ),
  )

  const found: Substitution[] = []
  for (let root = 0; root < 12; root++) {
    for (const quality of QUALITIES) {
      const candidate = chord(spellPitchClass(root), quality.name)
      const candidatePcs = new Set(
        candidate.intervals.map((x) => (root + intervalPitchClass(x)) % 12),
      )
      // Same notes in the same order is the chord itself, not a substitute.
      if (
        candidatePcs.size === originalPcs.size &&
        [...candidatePcs].every((pc) => originalPcs.has(pc))
      ) {
        continue
      }

      const shared = commonTones(symbol, candidate)
      if (shared.length < minShared) continue

      const guideDegrees = new Set(
        shared.filter((s) => s.inFirst.degree === 3 || s.inFirst.degree === 7)
          .map((s) => s.inFirst.degree),
      )
      const originalGuides = symbol.intervals.filter(
        (x) => x.degree === 3 || x.degree === 7,
      ).length

      found.push({
        chord: candidate,
        shared,
        changedTones: candidatePcs.size - shared.length,
        sharesGuideTones: originalGuides > 0 && guideDegrees.size === originalGuides,
        sameRoot: root === toPitchClass(symbol.root),
        strength: Number(
          (
            shared.reduce((sum, s) => sum + toneWeight(s.inFirst), 0) -
            0.5 * (candidatePcs.size - shared.length)
          ).toFixed(3),
        ),
      })
    }
  }

  return found
    .sort(
      (a, b) =>
        // Extensions of the same chord are useful but they are not
        // substitutions, so they sit below anything with a different root.
        Number(a.sameRoot) - Number(b.sameRoot) ||
        Number(b.sharesGuideTones) - Number(a.sharesGuideTones) ||
        b.strength - a.strength ||
        a.changedTones - b.changedTones,
    )
    .slice(0, maxResults)
}
