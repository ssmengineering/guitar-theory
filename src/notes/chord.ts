/**
 * Chord spelling.
 *
 * A chord is a root plus a set of intervals, optionally over a different bass
 * note. This is the chord as it appears written above the staff, before it
 * becomes a grip - guitar/voicing.ts is where it gets strings and frets, and
 * guitar/shapes.ts is where its tones become dots on the neck.
 *
 * The second half of this file is the identification engine - given the notes
 * under your fingers, what chords could this be? That question has more than
 * one right answer, which is the entire premise of Chord Chemistry, so the
 * engine returns a ranked list rather than a verdict.
 */

import {
  A5, b13, b9, d5, d7, M13, M2, M3, M6, M7, M9, m3, m7, P1, P11, P4, P5,
  degreeLabel, intervalPitchClass, s11, s9, type Interval,
} from './interval.js'
import {
  noteName,
  parseNote,
  type Alter,
  type Letter,
  type SpelledNote,
} from './pitch.js'

export interface ChordQuality {
  /** Registry key, e.g. 'maj7'. */
  name: string
  /** What gets appended to the root when printing: C + 'maj7' = 'Cmaj7'. */
  suffix: string
  intervals: Interval[]
  /** Rough ranking nudge: plainer chords win ties against exotic ones. */
  complexity: number
}

const q = (
  name: string,
  suffix: string,
  complexity: number,
  intervals: Interval[],
): ChordQuality => ({ name, suffix, complexity, intervals })

/**
 * The quality registry. Order matters only as a tiebreak; scoring does the work.
 * Extend this freely - every entry automatically becomes something the
 * identifier can recognise and the voicing generator can build.
 */
export const QUALITIES: ChordQuality[] = [
  q('maj', '', 0, [P1, M3, P5]),
  q('min', 'm', 0, [P1, m3, P5]),
  q('dim', 'dim', 2, [P1, m3, d5]),
  q('aug', 'aug', 2, [P1, M3, A5]),
  q('sus2', 'sus2', 2, [P1, M2, P5]),
  q('sus4', 'sus4', 1, [P1, P4, P5]),
  q('6', '6', 1, [P1, M3, P5, M6]),
  q('m6', 'm6', 2, [P1, m3, P5, M6]),
  q('7', '7', 1, [P1, M3, P5, m7]),
  q('maj7', 'maj7', 1, [P1, M3, P5, M7]),
  q('m7', 'm7', 1, [P1, m3, P5, m7]),
  q('m7b5', 'm7b5', 3, [P1, m3, d5, m7]),
  q('dim7', 'dim7', 3, [P1, m3, d5, d7]),
  q('mMaj7', 'mMaj7', 4, [P1, m3, P5, M7]),
  q('7sus4', '7sus4', 2, [P1, P4, P5, m7]),
  q('add9', 'add9', 2, [P1, M3, P5, M9]),
  q('6/9', '6/9', 3, [P1, M3, P5, M6, M9]),
  q('9', '9', 2, [P1, M3, P5, m7, M9]),
  q('maj9', 'maj9', 2, [P1, M3, P5, M7, M9]),
  q('m9', 'm9', 2, [P1, m3, P5, m7, M9]),
  q('7b9', '7b9', 4, [P1, M3, P5, m7, b9]),
  q('7#9', '7#9', 4, [P1, M3, P5, m7, s9]),
  q('7#11', '7#11', 4, [P1, M3, P5, m7, s11]),
  q('7b13', '7b13', 4, [P1, M3, P5, m7, b13]),
  q('maj7#11', 'maj7#11', 4, [P1, M3, P5, M7, s11]),
  q('m11', 'm11', 4, [P1, m3, P5, m7, M9, P11]),
  q('13', '13', 3, [P1, M3, P5, m7, M9, M13]),
  q('maj13', 'maj13', 4, [P1, M3, P5, M7, M9, M13]),
]

export function qualityByName(name: string): ChordQuality {
  const found = QUALITIES.find((x) => x.name === name)
  if (!found) throw new Error(`Unknown chord quality: ${name}`)
  return found
}

export interface ChordSymbol {
  root: SpelledNote
  intervals: Interval[]
  /** Slash chords. Undefined means the root is in the bass. */
  bass?: SpelledNote
  /** Registry key when the chord came from a known quality. */
  quality?: string
}

export function chord(
  root: SpelledNote,
  qualityName: string,
  bass?: SpelledNote,
): ChordSymbol {
  const found = qualityByName(qualityName)
  return { root, intervals: found.intervals, quality: qualityName, bass }
}

const pcSet = (values: number[]): Set<number> =>
  new Set(values.map((v) => ((v % 12) + 12) % 12))

/** Exact interval-set match against the registry. */
function matchQuality(intervals: Interval[]): ChordQuality | undefined {
  const target = pcSet(intervals.map(intervalPitchClass))
  return QUALITIES.find((candidate) => {
    const set = pcSet(candidate.intervals.map(intervalPitchClass))
    return set.size === target.size && [...set].every((x) => target.has(x))
  })
}

export function chordName(symbol: ChordSymbol): string {
  const found = symbol.quality
    ? qualityByName(symbol.quality)
    : matchQuality(symbol.intervals)
  const suffix = found
    ? found.suffix
    : `(${symbol.intervals.map(degreeLabel).join(' ')})`
  const slash = symbol.bass ? `/${noteName(symbol.bass)}` : ''
  return noteName(symbol.root) + suffix + slash
}

/* Identification --------------------------------------------------------- */

export type Completeness = 'complete' | 'no5' | 'rootless' | 'shell' | 'partial'

export interface ChordCandidate {
  symbol: ChordSymbol
  quality: ChordQuality
  /** Which chord degree each supplied pitch class turned out to be. */
  roles: { pitchClass: number; interval: Interval; label: string }[]
  /** Chord tones the voicing leaves out. */
  omitted: Interval[]
  completeness: Completeness
  /** 0..1. Higher means a more believable reading of these notes. */
  plausibility: number
}

/**
 * The tones a quality cannot do without, because they are what the name is
 * claiming. "Cadd9 with no 9" is not a reading of anything - it is just a C -
 * so omitting a characteristic tone disqualifies the reading outright rather
 * than merely costing it.
 *
 * Omittable: the root (that is what makes a rootless voicing), a perfect 5th
 * (guitarists drop it constantly), and intermediate extensions - a 13th chord
 * voiced R-3-b7-13 with no 9th is completely ordinary.
 *
 * Not omittable: the 3rd or its sus replacement, any altered 5th, the 6th, the
 * 7th, and whichever extension sits on top and gives the chord its name.
 */
export function essentialTones(intervals: Interval[]): Interval[] {
  const topDegree = Math.max(...intervals.map((x) => x.degree))
  return intervals.filter((interval) => {
    if (interval.degree === 1) return false
    if (interval.degree === 5) return interval.semitones !== 7
    if (interval.degree <= 4) return true
    if (interval.degree === 6 || interval.degree === 7) return true
    return interval.degree === topDegree
  })
}

const CHARACTERISTIC = new Map<string, Interval[]>(
  QUALITIES.map((quality) => [quality.name, essentialTones(quality.intervals)]),
)

/**
 * How bad it is to leave a given chord tone out. The fifth is nearly free -
 * guitarists drop it constantly and nobody misses it. The third and seventh
 * carry the chord identity, so a reading that assumes both are missing is
 * usually the wrong reading.
 */
function omissionCost(interval: Interval): number {
  switch (interval.degree) {
    case 5:
      return 0.12
    case 1:
      return 0.55
    case 9:
    case 11:
    case 13:
      return 0.45
    case 7:
      return 1.2
    case 2:
    case 3:
    case 4:
      return 1.6
    case 6:
      return 0.9
    default:
      return 0.8
  }
}

/** Default spelling for each pitch class, absent any key context. */
const DEFAULT_SPELLING: [Letter, Alter][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0],
  [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
]

export function spellPitchClass(pitchClass: number, octave = 4): SpelledNote {
  const entry = DEFAULT_SPELLING[((pitchClass % 12) + 12) % 12]!
  return { letter: entry[0], alter: entry[1], octave }
}

export interface IdentifyOptions {
  /** Lowest sounding pitch class. Root-in-bass readings score higher. */
  bassPitchClass?: number
  /** Allow readings whose root is not actually sounding. */
  allowRootless?: boolean
  maxResults?: number
}

/**
 * Given the pitch classes of a voicing, return the chords it could be, best
 * first.
 *
 * Every pitch class is tried as a candidate root - including ones that are not
 * present, which is how rootless voicings get found. A reading is discarded
 * outright if it cannot account for every note that IS sounding: a wrong note
 * is fatal, a missing note is merely a cost.
 */
export function identifyChord(
  pitchClasses: number[],
  options: IdentifyOptions = {},
): ChordCandidate[] {
  const { bassPitchClass, allowRootless = true, maxResults = 8 } = options
  const sounding = pcSet(pitchClasses)
  if (sounding.size === 0) return []

  const candidates: ChordCandidate[] = []

  for (let root = 0; root < 12; root++) {
    const rootIsSounding = sounding.has(root)
    if (!rootIsSounding && !allowRootless) continue

    for (const quality of QUALITIES) {
      const byPc = new Map<number, Interval>()
      for (const interval of quality.intervals) {
        byPc.set((root + intervalPitchClass(interval)) % 12, interval)
      }

      // A note the quality cannot explain rules this reading out entirely.
      if ([...sounding].some((pc) => !byPc.has(pc))) continue

      const omitted = quality.intervals.filter(
        (interval) => !sounding.has((root + intervalPitchClass(interval)) % 12),
      )

      // Dropping a tone the name depends on is not a reading, it is a different
      // chord. Rule it out rather than pricing it.
      const essential = CHARACTERISTIC.get(quality.name)!
      if (omitted.some((interval) => essential.includes(interval))) continue

      let cost = omitted.reduce((sum, interval) => sum + omissionCost(interval), 0)
      cost += quality.complexity * 0.08
      if (bassPitchClass !== undefined) {
        if (bassPitchClass === root) cost -= 0.35
        else if (!rootIsSounding) cost += 0.25
      }
      // Two notes can be read as almost anything. Say so with a low score.
      if (sounding.size < 3) cost += 0.6

      const roles = [...sounding]
        .map((pc) => {
          const interval = byPc.get(pc)!
          return { pitchClass: pc, interval, label: degreeLabel(interval) }
        })
        .sort((a, b) => a.interval.degree - b.interval.degree)

      candidates.push({
        symbol: {
          root: spellPitchClass(root),
          intervals: quality.intervals,
          quality: quality.name,
          bass:
            bassPitchClass !== undefined && bassPitchClass !== root
              ? spellPitchClass(bassPitchClass)
              : undefined,
        },
        quality,
        roles,
        omitted,
        completeness: classify(omitted, rootIsSounding, sounding.size),
        plausibility: 1 / (1 + Math.max(0, cost)),
      })
    }
  }

  return candidates
    .sort((a, b) => b.plausibility - a.plausibility)
    .slice(0, maxResults)
}

function classify(
  omitted: Interval[],
  rootIsSounding: boolean,
  size: number,
): Completeness {
  if (!rootIsSounding) return 'rootless'
  if (omitted.length === 0) return 'complete'
  // Root, 3rd and 7th with nothing else: the shell voicing.
  if (size === 3 && omitted.every((x) => x.degree === 5 || x.degree >= 9)) return 'shell'
  if (omitted.length === 1 && omitted[0]!.degree === 5) return 'no5'
  return 'partial'
}

/** Print a candidate the way the decoder panel would. */
export function describeCandidate(candidate: ChordCandidate): string {
  const degrees = candidate.roles.map((r) => r.label).join(' ')
  const missing = candidate.omitted.length
    ? ` (no ${candidate.omitted.map(degreeLabel).join(', no ')})`
    : ''
  return `${chordName(candidate.symbol)}${missing} [${degrees}]`
}

/* Reading a chord off a chart ---------------------------------------------- */

/** Ways people actually write qualities, mapped to registry names. */
const SUFFIX_ALIASES: Record<string, string> = {
  '': 'maj', M: 'maj', maj: 'maj', ma: 'maj',
  m: 'min', min: 'min', '-': 'min',
  M7: 'maj7', ma7: 'maj7', j7: 'maj7', t7: 'maj7',
  min7: 'm7', '-7': 'm7',
  dom7: '7',
  o: 'dim', '°': 'dim', o7: 'dim7', '°7': 'dim7',
  '+': 'aug', 'aug7': '7b13',
  'ø': 'm7b5', 'ø7': 'm7b5', 'm7-5': 'm7b5', 'min7b5': 'm7b5', 'half-dim': 'm7b5',
  sus: 'sus4',
  add2: 'add9',
}

const ROOT_PATTERN = /^([A-Ga-g])(bb|b|##|#|x)?(.*)$/

function qualityFromSuffix(suffix: string): string {
  const trimmed = suffix.trim()
  const alias = SUFFIX_ALIASES[trimmed]
  if (alias) return alias
  const exact = QUALITIES.find((q) => q.suffix === trimmed)
  if (exact) return exact.name
  const byName = QUALITIES.find((q) => q.name === trimmed)
  if (byName) return byName.name
  throw new Error(`Unrecognised chord quality: ${JSON.stringify(suffix)}`)
}

/**
 * Parse a written chord: "Cmaj7", "F#m7b5", "Bb13", "D7/A", "C6/9".
 *
 * The slash is ambiguous and has to be resolved by looking: in "D7/A" it marks
 * a bass note, in "C6/9" it is part of the quality's own name. If what follows
 * the slash parses as a note it is a bass note, and otherwise it is not.
 */
export function parseChord(text: string): ChordSymbol {
  const input = text.trim()
  if (input.length === 0) throw new Error('Cannot parse an empty chord')

  let main = input
  let bass: SpelledNote | undefined

  const slash = input.lastIndexOf('/')
  if (slash > 0) {
    const after = input.slice(slash + 1)
    if (/^[A-Ga-g](bb|b|##|#|x)?$/.test(after.trim())) {
      main = input.slice(0, slash)
      bass = parseNote(after.trim())
    }
  }

  const match = ROOT_PATTERN.exec(main)
  if (!match) throw new Error(`Cannot parse chord: ${JSON.stringify(text)}`)
  const [, letter, accidental, suffix] = match

  const root = parseNote(`${letter}${accidental ?? ''}`)
  return chord(root, qualityFromSuffix(suffix ?? ''), bass)
}
