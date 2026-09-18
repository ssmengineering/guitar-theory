/**
 * The fingering solver.
 *
 * Given a voicing and a hand, which digits go where - and what does it cost?
 *
 * Playability is a number, not a yes/no. Most grips are possible with enough
 * contortion; what matters is the ranking, because that turns "find me an
 * easier voicing" into an ordinary sort. A grip no assignment can satisfy
 * simply returns nothing, which is the honest way to say "not with these
 * hands".
 *
 * The search space is tiny - at most six notes over at most five digits - so
 * this is plain exhaustive search with pruning. No cleverness required.
 */

import { fretGap, type Instrument, type StringNumber } from '../guitar/instrument.js'
import type { VoicedNote, Voicing } from '../guitar/voicing.js'
import type { FingerId, HandModel, ThumbMode } from './hand.js'

export interface FingerAssignment {
  finger: FingerId
  /** More than one note means a barre. */
  notes: VoicedNote[]
  fret: number
  /** Lowest and highest string the barre physically covers. */
  barreSpan?: [StringNumber, StringNumber]
}

export interface Fingering {
  assignments: FingerAssignment[]
  /** Open strings cost no fingers at all. */
  openStrings: VoicedNote[]
  thumbMode?: string
  cost: number
  /** Human-readable tags: 'thumb-bass', 'barre:2', 'open-strings'. */
  strategies: string[]
  spanInches: number
}

export interface SolveOptions {
  /** Stop after this many results. */
  maxResults?: number
  /** Allow the thumb to fret. Turn off to see what the fingers alone can do. */
  allowThumb?: boolean
}

interface PartialFinger {
  finger: FingerId
  notes: VoicedNote[]
  fret: number
}

/**
 * All the ways this hand can hold this voicing, cheapest first.
 * An empty array means the voicing is out of reach for this hand.
 */
export function solveFingerings(
  v: Voicing,
  hand: HandModel,
  instrument: Instrument,
  options: SolveOptions = {},
): Fingering[] {
  const { maxResults = 10, allowThumb = true } = options

  const open = v.notes.filter((note) => note.fret === 0)
  const fretted = v.notes
    .filter((note) => note.fret > 0)
    .sort((a, b) => a.fret - b.fret || b.string - a.string)

  const results: Fingering[] = []

  // Branch on what the thumb does first, since it constrains the index barre.
  const thumbBranches: { note: VoicedNote | null; mode: ThumbMode | null }[] = [
    { note: null, mode: null },
  ]
  if (allowThumb && hand.fingers[0].canFret) {
    for (const note of fretted) {
      for (const mode of hand.thumbModes) {
        if (mode.strings.includes(note.string)) thumbBranches.push({ note, mode })
      }
    }
  }

  for (const branch of thumbBranches) {
    const remaining = branch.note
      ? fretted.filter((note) => note !== branch.note)
      : fretted
    const barreCap = branch.mode?.barreLimit ?? null

    search(remaining, 0, [], (partials) => {
      const fingering = evaluate(
        partials,
        branch,
        open,
        v,
        hand,
        instrument,
        barreCap,
      )
      if (fingering) results.push(fingering)
    }, hand)
  }

  return results.sort((a, b) => a.cost - b.cost).slice(0, maxResults)
}

/**
 * Recursively hand each fretted note to a digit. A digit already in use can
 * take another note only if the two form a legal barre - same fret, and the
 * physical span within that finger's barre width.
 */
function search(
  notes: VoicedNote[],
  index: number,
  partials: PartialFinger[],
  emit: (partials: PartialFinger[]) => void,
  hand: HandModel,
): void {
  if (index === notes.length) {
    emit(partials.map((p) => ({ ...p, notes: [...p.notes] })))
    return
  }
  const note = notes[index]!

  // Extend an existing finger into a barre.
  for (const partial of partials) {
    if (partial.fret !== note.fret) continue
    const model = hand.fingers[partial.finger]
    if (model.maxBarreStrings < 2) continue
    const strings = [...partial.notes.map((x) => x.string), note.string]
    const width = Math.max(...strings) - Math.min(...strings) + 1
    if (width > model.maxBarreStrings) continue
    partial.notes.push(note)
    search(notes, index + 1, partials, emit, hand)
    partial.notes.pop()
  }

  // Or bring in a fresh finger.
  for (const id of [1, 2, 3, 4] as FingerId[]) {
    const model = hand.fingers[id]
    if (!model.canFret) continue
    if (partials.some((p) => p.finger === id)) continue
    partials.push({ finger: id, notes: [note], fret: note.fret })
    search(notes, index + 1, partials, emit, hand)
    partials.pop()
  }
}

function evaluate(
  partials: PartialFinger[],
  branch: { note: VoicedNote | null; mode: ThumbMode | null },
  open: VoicedNote[],
  v: Voicing,
  hand: HandModel,
  instrument: Instrument,
  barreCap: number | null,
): Fingering | null {
  const assignments: FingerAssignment[] = []
  const strategies: string[] = []

  for (const partial of partials) {
    const strings = partial.notes.map((x) => x.string)
    const low = Math.min(...strings) as StringNumber
    const high = Math.max(...strings) as StringNumber
    const isBarre = partial.notes.length > 1 || high > low

    if (isBarre) {
      // While the thumb is wrapped, the index can only barre the treble side.
      if (partial.finger === 1 && barreCap !== null) {
        if (barreCap === 0) return null
        if (high > barreCap) return null
      }
      // Every sounding string the barre crosses must be at or above its fret.
      for (const note of v.notes) {
        if (note.string >= low && note.string <= high && note.fret < partial.fret) {
          return null
        }
      }
      strategies.push(`barre:${partial.finger}`)
    }

    assignments.push({
      finger: partial.finger,
      notes: partial.notes,
      fret: partial.fret,
      barreSpan: isBarre ? [low, high] : undefined,
    })
  }

  // Reach: the physical distance the hand must cover, which depends on where
  // on the neck this sits, not just on how many frets it spans.
  const frets = [
    ...partials.map((p) => p.fret),
    ...(branch.note ? [branch.note.fret] : []),
  ]
  const spanInches = frets.length > 1
    ? fretGap(Math.min(...frets), Math.max(...frets), instrument.scaleLength)
    : 0
  if (spanInches > hand.maxSpanInches) return null

  let cost = 0

  // Fewer fingers is easier, all else equal.
  cost += assignments.length * 0.35

  for (const assignment of assignments) {
    if (assignment.barreSpan) {
      const width = assignment.barreSpan[1] - assignment.barreSpan[0] + 1
      cost += 0.3 + 0.12 * (width - 2)
    }
  }

  // Stretch cost grows faster than linearly - the last half inch is the worst.
  if (spanInches > 0) {
    cost += 2 * Math.pow(spanInches / hand.maxSpanInches, 2)
  }

  // Crossings: a higher-numbered finger sitting closer to the nut than a
  // lower-numbered one. Possible, but it tangles the hand.
  const byFinger = new Map(assignments.map((a) => [a.finger, a.fret]))
  for (const [a, fretA] of byFinger) {
    for (const [b, fretB] of byFinger) {
      if (a < b && fretA > fretB) cost += hand.crossingPenalty * (fretA - fretB)
    }
  }

  if (branch.mode && branch.note) {
    cost += branch.mode.cost
    strategies.push(branch.mode.name === 'bass-wrap' ? 'thumb-bass' : 'thumb-treble')
    // The thumb must sit near the hand's anchor fret, not off on its own.
    if (partials.length > 0) {
      const anchor = Math.min(...partials.map((p) => p.fret))
      const offset = branch.note.fret - anchor
      if (offset < branch.mode.fretOffset[0] || offset > branch.mode.fretOffset[1]) {
        return null
      }
    }
    assignments.push({ finger: 0, notes: [branch.note], fret: branch.note.fret })
  }

  if (open.length > 0) strategies.push('open-strings')

  return {
    assignments: assignments.sort((a, b) => a.finger - b.finger),
    openStrings: open,
    thumbMode: branch.mode?.name,
    cost: Number(cost.toFixed(4)),
    strategies,
    spanInches: Number(spanInches.toFixed(3)),
  }
}

export function bestFingering(
  v: Voicing,
  hand: HandModel,
  instrument: Instrument,
): Fingering | null {
  return solveFingerings(v, hand, instrument, { maxResults: 1 })[0] ?? null
}

export function isPlayable(
  v: Voicing,
  hand: HandModel,
  instrument: Instrument,
): boolean {
  return bestFingering(v, hand, instrument) !== null
}

const FINGER_NAMES: Record<FingerId, string> = {
  0: 'T',
  1: '1',
  2: '2',
  3: '3',
  4: '4',
}

/** One-line summary, e.g. "T:6@3  1:3@4  2:5,4@5" */
export function describeFingering(f: Fingering): string {
  const parts = f.assignments.map((a) => {
    const strings = a.notes.map((x) => x.string).sort((x, y) => x - y).join(',')
    return `${FINGER_NAMES[a.finger]}:${strings}@${a.fret}`
  })
  return parts.join('  ')
}
