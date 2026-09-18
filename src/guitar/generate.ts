/**
 * The voicing generator.
 *
 * Given a chord, find every way to play it on the neck. This is the piece that
 * turns the engine into a chord dictionary generator rather than a chord
 * dictionary reader - and generating beats filtering, because a printed book is
 * fingered for one particular pair of hands and silently omits everything those
 * hands could not do.
 *
 * Ted Greene organises Chord Chemistry by STRING SET and by what is on TOP.
 * Both of those are first-class here: `stringSets` restricts the search, and
 * `topDegree` asks for voicings with a particular chord tone in the melody. The
 * grouping helpers at the bottom build the same index the book uses.
 *
 * Non-adjacent string sets - 6-4-3-2, 5-4-2-1 - are generated as readily as
 * contiguous ones. For a flatpicker those are awkward; for fingerstyle they are
 * free, and the open spacing is a large part of what makes those voicings sound
 * the way they do.
 */

import { essentialTones, type ChordSymbol } from '../notes/chord.js'
import { degreeLabel, intervalPitchClass, type Interval } from '../notes/interval.js'
import { toPitchClass } from '../notes/pitch.js'
import { midiAt, type Instrument, type StringNumber } from './instrument.js'
import { voicing, type VoicedNote, type Voicing } from './voicing.js'

export interface VoicingAnalysis {
  voicing: Voicing
  /** What each note is doing in the chord. */
  roles: { note: VoicedNote; interval: Interval; label: string }[]
  /** Chord tones this voicing leaves out. */
  omitted: Interval[]
  /** The melody note's role. In chord melody this is the thing you cannot change. */
  topInterval: Interval
  bassInterval: Interval
  stringSet: StringNumber[]
  /** 0 root position, 1 third in the bass, 2 fifth in the bass, 3 seventh. */
  inversion: number
  rootless: boolean
  /** How muddy or gappy the voicing is. 0 is clean. See `spacingOf`. */
  spacingPenalty: number
  /** Plain-language notes on what is wrong with the spacing, if anything. */
  spacingNotes: string[]
  /** True when every note is fretted, so the shape transposes up the neck. */
  moveable: boolean
}

/**
 * Low interval limits, roughly as an arranger would apply them.
 *
 * The same interval that sounds clear between the top two voices sounds like
 * mud between the bottom two, and the lower you go the wider the interval has
 * to be before it stays clear. This is why a first-position E chord puts a 5th
 * at the bottom and a 3rd at the top and not the other way round - and it is
 * the kind of thing you already do by ear and have never had a name for.
 *
 * The thresholds are rules of thumb, not physics. They are deliberately in one
 * function so they can be argued with.
 */
export function spacingOf(v: Voicing): { penalty: number; notes: string[] } {
  const midis = v.notes.map((n) => n.midi)
  let penalty = 0
  const notes: string[] = []

  for (let i = 1; i < midis.length; i++) {
    const lower = midis[i - 1]!
    const gap = midis[i]! - lower

    // Below C3 you want a 5th or wider; up to G3 a 3rd is fine; above that
    // anything but a semitone reads clearly.
    const minimum = lower < 48 ? 7 : lower < 55 ? 4 : 2
    if (gap < minimum) {
      penalty += (minimum - gap) * 0.3
      const where = i === 1 ? 'the bottom two voices' : 'two inner voices'
      const why = lower < 55 ? 'muddy down here' : 'a clash rather than a colour'
      notes.push(
        `${gap} semitone${gap === 1 ? '' : 's'} between ${where} is ${why}`,
      )
    }

    // A hole in the middle of a voicing disconnects it. A wide gap above the
    // bass note is normal and often the point, so only flag the upper voices.
    if (i > 1 && gap > 12) {
      penalty += (gap - 12) * 0.12
      notes.push(`${gap} semitones between upper voices leaves a hole`)
    }
  }

  return { penalty: Number(penalty.toFixed(3)), notes }
}

export interface GenerateOptions {
  fretRange?: [number, number]
  /** Widest stretch in frets, before any hand is considered. Default 5. */
  maxFretSpan?: number
  minNotes?: number
  maxNotes?: number
  /** Restrict the search. Default: every set within `maxStringSpread`. */
  stringSets?: StringNumber[][]
  /** How far apart the outer strings of a set may be. Default 5. */
  maxStringSpread?: number
  allowOpenStrings?: boolean
  /** Let the root be absent entirely. Default true - rootless voicings are useful. */
  allowOmitRoot?: boolean
  /** Ted's melody index: only voicings with this degree on top, e.g. 3. */
  topDegree?: number
  /** Only voicings with this exact pitch class on top - keeping a melody note. */
  topPitchClass?: number
  requireRootInBass?: boolean
  maxResults?: number
}

/** "5-4-3-2" - the way a player names a string set. */
export const stringSetKey = (set: StringNumber[]): string =>
  [...set].sort((a, b) => b - a).join('-')

/**
 * Every string set of a given size, optionally limited in how far the outer
 * strings may spread. Includes non-adjacent sets.
 */
export function allStringSets(
  stringCount = 6,
  minNotes = 3,
  maxNotes = 6,
  maxSpread = 5,
): StringNumber[][] {
  const sets: StringNumber[][] = []
  const total = 1 << stringCount
  for (let mask = 1; mask < total; mask++) {
    const set: StringNumber[] = []
    for (let i = 0; i < stringCount; i++) {
      if (mask & (1 << i)) set.push((i + 1) as StringNumber)
    }
    if (set.length < minNotes || set.length > maxNotes) continue
    const spread = set[set.length - 1]! - set[0]! + 1
    if (spread > maxSpread) continue
    sets.push(set)
  }
  return sets
}

/**
 * Every playable-shaped voicing of a chord on the neck.
 *
 * Note this applies no hand model at all - it answers "what voicings exist",
 * which is a question about the guitar, not about anybody's fingers. Pass the
 * results through src/hands to answer the second question.
 */
export function generateVoicings(
  instrument: Instrument,
  chord: ChordSymbol,
  options: GenerateOptions = {},
): VoicingAnalysis[] {
  const {
    fretRange = [0, 12],
    maxFretSpan = 5,
    minNotes = 3,
    maxNotes = 6,
    maxStringSpread = 5,
    allowOpenStrings = true,
    allowOmitRoot = true,
    topDegree,
    topPitchClass,
    requireRootInBass = false,
    maxResults = 500,
  } = options

  const stringSets =
    options.stringSets ??
    allStringSets(instrument.tuning.length, minNotes, maxNotes, maxStringSpread)

  const rootPc = toPitchClass(chord.root)
  const byPitchClass = new Map<number, Interval>()
  for (const interval of chord.intervals) {
    byPitchClass.set((rootPc + intervalPitchClass(interval)) % 12, interval)
  }
  const essential = essentialTones(chord.intervals)

  const results: VoicingAnalysis[] = []
  const seen = new Set<string>()

  for (const set of stringSets) {
    // Candidate frets on each string, cheapest thing to precompute.
    const candidates: { string: StringNumber; fret: number; interval: Interval }[][] = []
    let viable = true
    for (const string of set) {
      const forString: { string: StringNumber; fret: number; interval: Interval }[] = []
      for (let fret = fretRange[0]; fret <= fretRange[1]; fret++) {
        if (fret === 0 && !allowOpenStrings) continue
        const pc = (((midiAt(instrument, string, fret) % 12) + 12) % 12)
        const interval = byPitchClass.get(pc)
        if (interval) forString.push({ string, fret, interval })
      }
      if (forString.length === 0) {
        viable = false
        break
      }
      candidates.push(forString)
    }
    if (!viable) continue

    // One note per string, pruning as soon as the stretch is too wide.
    const chosen: { string: StringNumber; fret: number; interval: Interval }[] = []

    const walk = (depth: number, lowFret: number, highFret: number): void => {
      if (results.length >= maxResults) return
      if (depth === candidates.length) {
        const analysis = analyse(instrument, chosen, chord, essential, {
          allowOmitRoot,
          topDegree,
          topPitchClass,
          requireRootInBass,
        })
        if (!analysis) return
        const key = chosen.map((c) => `${c.string}:${c.fret}`).join(',')
        if (seen.has(key)) return
        seen.add(key)
        results.push(analysis)
        return
      }

      for (const candidate of candidates[depth]!) {
        let nextLow = lowFret
        let nextHigh = highFret
        if (candidate.fret > 0) {
          nextLow = Math.min(lowFret, candidate.fret)
          nextHigh = Math.max(highFret, candidate.fret)
          if (nextHigh - nextLow > maxFretSpan) continue
        }
        chosen.push(candidate)
        walk(depth + 1, nextLow, nextHigh)
        chosen.pop()
      }
    }

    walk(0, Infinity, -Infinity)
  }

  return results
}

function analyse(
  instrument: Instrument,
  chosen: { string: StringNumber; fret: number; interval: Interval }[],
  chord: ChordSymbol,
  essential: Interval[],
  filters: {
    allowOmitRoot: boolean
    topDegree?: number
    topPitchClass?: number
    requireRootInBass: boolean
  },
): VoicingAnalysis | null {
  const present = new Set(chosen.map((c) => c.interval))

  // Anything the chord's name depends on has to actually be there.
  for (const interval of essential) {
    if (!present.has(interval)) return null
  }
  const hasRoot = [...present].some((x) => x.degree === 1)
  if (!hasRoot && !filters.allowOmitRoot) return null

  const v = voicing(
    instrument,
    chosen.map((c) => [c.string, c.fret] as [StringNumber, number]),
  )

  // Two strings sounding the identical pitch is almost never what you want.
  const midis = v.notes.map((x) => x.midi)
  if (new Set(midis).size !== midis.length) return null

  const intervalOf = new Map(chosen.map((c) => [`${c.string}:${c.fret}`, c.interval]))
  const roles = v.notes.map((note) => {
    const interval = intervalOf.get(`${note.string}:${note.fret}`)!
    return { note, interval, label: degreeLabel(interval) }
  })

  const topInterval = roles[roles.length - 1]!.interval
  const bassInterval = roles[0]!.interval

  if (filters.topDegree !== undefined && topInterval.degree !== filters.topDegree) return null
  if (
    filters.topPitchClass !== undefined &&
    (((v.topMidi % 12) + 12) % 12) !== filters.topPitchClass
  ) {
    return null
  }
  if (filters.requireRootInBass && bassInterval.degree !== 1) return null

  const inversionByDegree: Record<number, number> = { 1: 0, 3: 1, 5: 2, 7: 3 }
  const spacing = spacingOf(v)

  return {
    voicing: v,
    roles,
    omitted: chord.intervals.filter((interval) => !present.has(interval)),
    topInterval,
    bassInterval,
    stringSet: v.stringSet,
    inversion: inversionByDegree[bassInterval.degree] ?? 4,
    rootless: !hasRoot,
    spacingPenalty: spacing.penalty,
    spacingNotes: spacing.notes,
    moveable: v.notes.every((n) => n.fret > 0),
  }
}

/* The Chord Chemistry index ---------------------------------------------- */

/** Group by string set - the book's primary organisation. */
export function byStringSet(
  list: VoicingAnalysis[],
): Map<string, VoicingAnalysis[]> {
  const groups = new Map<string, VoicingAnalysis[]>()
  for (const item of list) {
    const key = stringSetKey(item.stringSet)
    const bucket = groups.get(key) ?? []
    bucket.push(item)
    groups.set(key, bucket)
  }
  return groups
}

/**
 * Group by what is in the melody. This is how you actually use a chord
 * dictionary when harmonising a tune: the top note is given, and you need the
 * chords that put it there.
 */
export function byTopDegree(list: VoicingAnalysis[]): Map<string, VoicingAnalysis[]> {
  const groups = new Map<string, VoicingAnalysis[]>()
  for (const item of list) {
    const key = degreeLabel(item.topInterval)
    const bucket = groups.get(key) ?? []
    bucket.push(item)
    groups.set(key, bucket)
  }
  return groups
}

/** One-line summary: "6-4-3-2  3rd fret  R 5 R 3   (top: 3)" */
export function describeVoicing(analysis: VoicingAnalysis): string {
  const set = stringSetKey(analysis.stringSet).padEnd(9)
  const frets = analysis.voicing.notes
    .slice()
    .sort((a, b) => b.string - a.string)
    .map((n) => String(n.fret).padStart(2))
    .join('')
  const degrees = analysis.roles.map((r) => r.label).join(' ')
  return `${set}${frets}   ${degrees.padEnd(16)} top:${degreeLabel(analysis.topInterval)}`
}
