/**
 * Progressions, and the numbers that make them portable.
 *
 * A chart written in letters tells you what to play in one key. A chart written
 * in numbers tells you what the song IS, and you can put it in any key on the
 * stand. That is the whole argument for the Nashville system, and it is also
 * why numbers are the right thing to have on screen while you write: every chart
 * you make quietly drills functional thinking, which is more theory teaching
 * than a lessons module would ever manage.
 *
 * Nothing here stores a number. Numbers are derived from the chord and the key
 * on demand, so they cannot drift out of step with the chords they describe.
 */

import {
  QUALITIES,
  chord,
  chordName,
  parseChord,
  qualityByName,
  type ChordSymbol,
} from './chord.js'
import {
  alterationSign,
  degreeOf,
  degreeRoot,
  diatonicQualities,
  key,
  keyName,
  romanFor,
  type Key,
} from './key.js'
import { noteName, toPitchClass } from './pitch.js'

export interface ChartChord {
  symbol: ChordSymbol
  beats: number
}

export interface Bar {
  chords: ChartChord[]
}

export interface Progression {
  key: Key
  bars: Bar[]
  beatsPerBar: number
  title?: string
}

/* Reading and writing charts ---------------------------------------------- */

/**
 * Parse a chart: "| Cmaj7 | Am7 | Dm7 G7 | Cmaj7 |".
 * Chords inside a bar split the bar evenly between them.
 */
export function parseChart(k: Key, text: string, beatsPerBar = 4): Progression {
  const bars: Bar[] = text
    .split('|')
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0)
    .map((bar) => {
      const names = bar.split(/\s+/).filter((x) => x.length > 0)
      const beats = beatsPerBar / names.length
      return { chords: names.map((name) => ({ symbol: parseChord(name), beats })) }
    })
  return { key: k, bars, beatsPerBar }
}

export const chordsOf = (p: Progression): ChordSymbol[] =>
  p.bars.flatMap((bar) => bar.chords.map((c) => c.symbol))

/* Numbering ---------------------------------------------------------------- */

const SPECIAL_ROMAN: Record<string, string> = {
  min: '', m7: '7', m9: '9', m11: '11', m6: '6',
  dim: '°', dim7: '° 7'.replace(' ', ''), m7b5: 'ø 7'.replace(' ', ''),
  maj: '', aug: '+', mMaj7: 'maj7',
}

/** Lower case when the chord has a minor third - the classical convention. */
const isMinorish = (symbol: ChordSymbol): boolean =>
  symbol.intervals.some((x) => x.degree === 3 && x.semitones === 3)

/** "V7", "ii", "bVII", "viiø7" */
export function romanNumeral(symbol: ChordSymbol, k: Key): string {
  const { degree, alteration } = degreeOf(k, symbol.root)
  const base = romanFor(degree)
  const cased = isMinorish(symbol) ? base.toLowerCase() : base
  const quality = symbol.quality ?? 'maj'
  const decoration =
    SPECIAL_ROMAN[quality] ?? qualityByName(quality).suffix.replace(/^m(?!aj)/, '')
  const slash = symbol.bass ? `/${noteName(symbol.bass)}` : ''
  return alterationSign(alteration) + cased + decoration + slash
}

/**
 * "1", "6m", "2m7", "5(7)", "b7".
 *
 * A quality that starts with a digit goes in brackets, because "57" reads as a
 * number rather than as the five chord with a seventh on it.
 */
export function nashville(symbol: ChordSymbol, k: Key): string {
  const { degree, alteration } = degreeOf(k, symbol.root)
  const suffix = qualityByName(symbol.quality ?? 'maj').suffix
  const written = suffix.length === 0 ? '' : /^\d/.test(suffix) ? `(${suffix})` : suffix
  const slash = symbol.bass ? `/${noteName(symbol.bass)}` : ''
  return alterationSign(alteration) + String(degree) + written + slash
}

/* Analysis ----------------------------------------------------------------- */

export type HarmonicRole =
  | 'diatonic'
  | 'secondary-dominant'
  | 'tritone-sub'
  | 'borrowed'
  | 'chromatic'

export interface ChordAnalysis {
  symbol: ChordSymbol
  bar: number
  beats: number
  degree: number
  alteration: number
  roman: string
  nashville: string
  role: HarmonicRole
  /** The degree a secondary dominant or tritone sub is aimed at. */
  targets?: number
  explanation: string
}

const isDominant = (symbol: ChordSymbol): boolean =>
  symbol.intervals.some((x) => x.degree === 3 && x.semitones === 4) &&
  symbol.intervals.some((x) => x.degree === 7 && x.semitones === 10)

/** Which diatonic degree, if any, sits on this pitch class. */
function diatonicDegreeAt(k: Key, pitchClass: number): number | undefined {
  for (let degree = 1; degree <= 7; degree++) {
    if (toPitchClass(degreeRoot(k, degree)) === pitchClass) return degree
  }
  return undefined
}

const BORROWED_NOTES: Record<string, string> = {
  b7: 'the flat seven - borrowed from the parallel minor, and the backbone of most rock and folk',
  b3: 'the flat three - borrowed from the parallel minor',
  b6: 'the flat six - borrowed from the parallel minor, and a favourite way to darken a turnaround',
  '4': 'the minor four - the classic sad turn on the way home',
  '2': 'the half-diminished two - the parallel minor lending you its ii chord',
}

const parallelOf = (k: Key): Key =>
  key(k.tonic, k.mode === 'major' ? 'minor' : 'major')

/**
 * The numeral for a degree of the key, cased by what the key builds there.
 * "V of ii" rather than "V of II" - the case is how the notation says that the
 * chord being aimed at is a minor one.
 */
function romanForDegreeIn(k: Key, degree: number): string {
  const quality = diatonicQualities(k, false)[degree - 1]
  const base = romanFor(degree)
  return quality === 'min' || quality === 'dim' ? base.toLowerCase() : base
}

function classify(
  symbol: ChordSymbol,
  k: Key,
  degree: number,
  alteration: number,
): Pick<ChordAnalysis, 'role' | 'targets' | 'explanation'> {
  const roman = romanNumeral(symbol, k)
  const quality = symbol.quality ?? 'maj'

  // Straight out of the key: right root, and the quality the key builds there.
  if (alteration === 0) {
    const triads = diatonicQualities(k, false)
    const sevenths = diatonicQualities(k, true)
    if (quality === triads[degree - 1] || quality === sevenths[degree - 1]) {
      return {
        role: 'diatonic',
        explanation: `${roman} - straight out of ${keyName(k)}`,
      }
    }
  }

  const rootPc = toPitchClass(symbol.root)

  if (isDominant(symbol) || quality === 'maj') {
    // A dominant resolves down a fifth, which is up a fourth: +5 semitones.
    const target = diatonicDegreeAt(k, (rootPc + 5) % 12)
    if (target !== undefined && isDominant(symbol)) {
      const targetRoman = romanForDegreeIn(k, target)
      return {
        role: 'secondary-dominant',
        targets: target,
        explanation:
          `V of ${targetRoman} - a dominant aimed at ${noteName(degreeRoot(k, target))} ` +
          `rather than at the key. It borrows the leading tone of ${targetRoman} for one chord.`,
      }
    }
  }

  if (isDominant(symbol)) {
    // The tritone sub falls a half step into its target.
    const target = diatonicDegreeAt(k, (rootPc + 11) % 12)
    if (target !== undefined) {
      const targetRoman = romanForDegreeIn(k, target)
      return {
        role: 'tritone-sub',
        targets: target,
        explanation:
          `the tritone substitute for V of ${targetRoman} - same 3rd and 7th as that ` +
          `dominant, root a tritone away, so the bass walks down a half step into ${targetRoman}.`,
      }
    }
  }

  // Anything the parallel mode would give you is borrowed rather than foreign.
  const parallel = parallelOf(k)
  const inParallel = degreeOf(parallel, symbol.root)
  if (inParallel.alteration === 0) {
    const triads = diatonicQualities(parallel, false)
    const sevenths = diatonicQualities(parallel, true)
    if (
      quality === triads[inParallel.degree - 1] ||
      quality === sevenths[inParallel.degree - 1]
    ) {
      const tag = alterationSign(alteration) + String(degree)
      return {
        role: 'borrowed',
        explanation: `${roman} - ${BORROWED_NOTES[tag] ?? `borrowed from ${keyName(parallel)}`}`,
      }
    }
  }

  return {
    role: 'chromatic',
    explanation: `${roman} - outside ${keyName(k)}, and not obviously borrowed or aimed anywhere`,
  }
}

export function analyze(p: Progression): ChordAnalysis[] {
  const out: ChordAnalysis[] = []
  p.bars.forEach((bar, index) => {
    for (const entry of bar.chords) {
      const { degree, alteration } = degreeOf(p.key, entry.symbol.root)
      out.push({
        symbol: entry.symbol,
        bar: index,
        beats: entry.beats,
        degree,
        alteration,
        roman: romanNumeral(entry.symbol, p.key),
        nashville: nashville(entry.symbol, p.key),
        ...classify(entry.symbol, p.key, degree, alteration),
      })
    }
  })
  return out
}

/* Cadences ----------------------------------------------------------------- */

export interface Cadence {
  kind: 'ii-V-I' | 'ii-V' | 'V-I' | 'IV-I' | 'deceptive'
  /** Indices into the analysis array. */
  at: number[]
  explanation: string
}

/**
 * The shapes that turn a list of chords into a sentence.
 * ii-V-I first, because once you can see it you see it everywhere.
 */
export function findCadences(analysis: ChordAnalysis[]): Cadence[] {
  const found: Cadence[] = []
  const at = (i: number) => analysis[i]
  const isDegree = (i: number, degree: number) =>
    at(i) !== undefined && at(i)!.degree === degree && at(i)!.alteration === 0

  for (let i = 0; i < analysis.length; i++) {
    if (isDegree(i, 2) && isDegree(i + 1, 5)) {
      if (isDegree(i + 2, 1)) {
        found.push({
          kind: 'ii-V-I',
          at: [i, i + 1, i + 2],
          explanation:
            'ii-V-I - the sentence most of this music is written in. The 7th of the ' +
            'ii falls to the 3rd of the V, and the 7th of the V falls to the 3rd of the I.',
        })
        i += 2
        continue
      }
      found.push({
        kind: 'ii-V',
        at: [i, i + 1],
        explanation: 'ii-V with the resolution withheld - it is going somewhere',
      })
      i += 1
      continue
    }
    if (isDegree(i, 5) && isDegree(i + 1, 1)) {
      found.push({ kind: 'V-I', at: [i, i + 1], explanation: 'V-I - the plain authentic cadence' })
      i += 1
    } else if (isDegree(i, 5) && isDegree(i + 1, 6)) {
      found.push({
        kind: 'deceptive',
        at: [i, i + 1],
        explanation: 'V-vi - the deceptive cadence: it lands, but not where you expected',
      })
      i += 1
    } else if (isDegree(i, 4) && isDegree(i + 1, 1)) {
      found.push({
        kind: 'IV-I',
        at: [i, i + 1],
        explanation: 'IV-I - the plagal cadence, the amen',
      })
      i += 1
    }
  }
  return found
}

/* Moving between keys ------------------------------------------------------ */

/** Put the same progression in another key, spelled the way that key spells it. */
export function transposeTo(p: Progression, target: Key): Progression {
  return {
    ...p,
    key: target,
    bars: p.bars.map((bar) => ({
      chords: bar.chords.map((entry) => {
        const { degree, alteration } = degreeOf(p.key, entry.symbol.root)
        const root = degreeRoot(target, degree, alteration)
        const bass = entry.symbol.bass
          ? (() => {
              const d = degreeOf(p.key, entry.symbol.bass!)
              return degreeRoot(target, d.degree, d.alteration)
            })()
          : undefined
        return {
          beats: entry.beats,
          symbol: chord(root, entry.symbol.quality ?? 'maj', bass),
        }
      }),
    })),
  }
}

const NASHVILLE_PATTERN = /^(b+|#+)?([1-7])(.*)$/

/** Read a chart written in numbers and put it in a key. */
export function parseNashvilleChart(
  k: Key,
  text: string,
  beatsPerBar = 4,
): Progression {
  const bars: Bar[] = text
    .split('|')
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0)
    .map((bar) => {
      const tokens = bar.split(/\s+/).filter((x) => x.length > 0)
      const beats = beatsPerBar / tokens.length
      return {
        chords: tokens.map((token) => {
          const match = NASHVILLE_PATTERN.exec(token)
          if (!match) throw new Error(`Cannot parse number: ${JSON.stringify(token)}`)
          const [, sign, degreeText, rest] = match
          const alteration = sign ? (sign.startsWith('b') ? -sign.length : sign.length) : 0
          const suffix = (rest ?? '').replace(/^\((.*)\)$/, '$1')
          const quality =
            suffix.length === 0
              ? 'maj'
              : (QUALITIES.find((q) => q.suffix === suffix)?.name ?? suffix)
          return {
            beats,
            symbol: chord(degreeRoot(k, Number(degreeText), alteration), quality),
          }
        }),
      }
    })
  return { key: k, bars, beatsPerBar }
}

/* Printing ----------------------------------------------------------------- */

export type ChartStyle = 'letters' | 'nashville' | 'roman' | 'both'

export function renderChart(p: Progression, style: ChartStyle = 'both'): string {
  const write = (symbol: ChordSymbol): string => {
    switch (style) {
      case 'letters':
        return chordName(symbol)
      case 'nashville':
        return nashville(symbol, p.key)
      case 'roman':
        return romanNumeral(symbol, p.key)
      case 'both':
        return `${chordName(symbol)} (${nashville(symbol, p.key)})`
    }
  }
  return `| ${p.bars.map((bar) => bar.chords.map((c) => write(c.symbol)).join(' ')).join(' | ')} |`
}
