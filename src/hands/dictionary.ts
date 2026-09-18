/**
 * Your chord dictionary, generated.
 *
 * `generateVoicings` answers "what voicings of this chord exist on a guitar".
 * This file answers the second question - "which of them can these hands play,
 * and which are easiest" - by running each one through the fingering solver and
 * ranking by what it costs.
 *
 * The result is the thing a printed dictionary cannot be: correct for the hands
 * holding the instrument. Chord Chemistry is about two thousand voicings
 * fingered for a conventional hand. Filtering that book throws away most of it
 * AND misses everything a different hand can do that a conventional one cannot.
 * Generating has neither problem.
 */

import {
  generateVoicings,
  stringSetKey,
  type GenerateOptions,
  type VoicingAnalysis,
} from '../guitar/generate.js'
import type { Instrument } from '../guitar/instrument.js'
import type { Voicing } from '../guitar/voicing.js'
import type { ChordSymbol } from '../notes/chord.js'
import { degreeLabel } from '../notes/interval.js'
import { solveFingerings, type Fingering } from './fingering.js'
import type { HandModel } from './hand.js'

export interface PlayableVoicing extends VoicingAnalysis {
  fingering: Fingering
  /** What it costs the hand. */
  handCost: number
  /** handCost + spacingPenalty. What the list is sorted by. */
  cost: number
}

export interface DictionaryOptions extends GenerateOptions {
  /** Drop anything harder than this. Undefined keeps everything playable. */
  maxCost?: number
  /** How many to return. Default 25. */
  limit?: number
  /**
   * Only shapes with no open strings, which therefore transpose up the neck.
   *
   * Worth turning on for most dictionary use. Open strings are genuinely free
   * for the fretting hand, so without this they sweep the top of every ranking
   * and bury the moveable shapes - and an open voicing only works in the one
   * key it happens to fit.
   */
  moveableOnly?: boolean
  /** Drop voicings the spacing rules dislike. Default 1.0. */
  maxSpacingPenalty?: number
}

/**
 * Every voicing of a chord these hands can actually hold, best first.
 *
 * "Best" combines two different judgments that are worth keeping separate in
 * your head: `handCost` is whether you can play it, `spacingPenalty` is whether
 * it is worth playing. Both are reported so a shape that is easy but muddy does
 * not quietly outrank one that is slightly harder and sounds better.
 */
export function chordDictionary(
  instrument: Instrument,
  chord: ChordSymbol,
  hand: HandModel,
  options: DictionaryOptions = {},
): PlayableVoicing[] {
  const {
    maxCost,
    limit = 25,
    moveableOnly = false,
    maxSpacingPenalty = 1.0,
    ...generateOptions
  } = options

  if (moveableOnly) generateOptions.allowOpenStrings = false

  const playable: PlayableVoicing[] = []
  for (const analysis of generateVoicings(instrument, chord, generateOptions)) {
    if (analysis.spacingPenalty > maxSpacingPenalty) continue
    const [best] = solveFingerings(analysis.voicing, hand, instrument, { maxResults: 1 })
    if (!best) continue

    const cost = Number((best.cost + analysis.spacingPenalty).toFixed(4))
    if (maxCost !== undefined && cost > maxCost) continue
    playable.push({ ...analysis, fingering: best, handCost: best.cost, cost })
  }

  return playable.sort((a, b) => a.cost - b.cost).slice(0, limit)
}

export interface AlternativeOptions extends DictionaryOptions {
  /**
   * Keep the melody note. In chord melody the top voice is the tune, so a
   * substitute that changes it is not a substitute - it is a different
   * arrangement. This is a hard constraint, not a preference.
   */
  keepTopNote?: boolean
  /** Stay within this many frets of where the original sits. */
  nearFret?: number
}

/**
 * "I cannot play this chord. What can I play instead?"
 *
 * Takes the shape you were trying to hold and returns the closest things these
 * hands can actually do, each one carrying the reason it works.
 */
export function findAlternatives(
  instrument: Instrument,
  chord: ChordSymbol,
  target: Voicing,
  hand: HandModel,
  options: AlternativeOptions = {},
): PlayableVoicing[] {
  const { keepTopNote = false, nearFret, ...rest } = options

  const generateOptions: DictionaryOptions = { ...rest }
  if (keepTopNote) {
    generateOptions.topPitchClass = ((target.topMidi % 12) + 12) % 12
  }
  if (nearFret !== undefined) {
    generateOptions.fretRange = [
      Math.max(0, target.lowestFret - nearFret),
      target.highestFret + nearFret,
    ]
  }

  const targetKey = signature(target)
  return chordDictionary(instrument, chord, hand, generateOptions).filter(
    (option) => signature(option.voicing) !== targetKey,
  )
}

const signature = (v: Voicing): string =>
  v.notes.map((n) => `${n.string}:${n.fret}`).join(',')

/**
 * Why this voicing works, in the words you would use to explain it.
 *
 * This is the part that makes the accessibility feature a teaching feature:
 * every substitution comes with the chord theory that justifies it, so the
 * constraint produces exactly the understanding the books never delivered.
 */
export function explain(option: PlayableVoicing, target?: Voicing): string[] {
  const reasons: string[] = []

  if (option.omitted.length > 0) {
    const names = option.omitted.map(degreeLabel)
    const why = option.omitted.every((x) => x.degree === 5)
      ? 'the least functional tone in the chord'
      : 'not needed to state the harmony here'
    reasons.push(`drops the ${names.join(' and ')} - ${why}`)
  }

  if (option.rootless) {
    reasons.push('rootless - the bass line or the next chord covers the root')
  }

  if (option.fingering.strategies.includes('thumb-bass')) {
    reasons.push('thumb takes the bass note, which frees a finger above it')
  }
  if (option.fingering.strategies.includes('thumb-treble')) {
    reasons.push('thumb reaches a treble string - situational, but it unlocks this one')
  }
  for (const assignment of option.fingering.assignments) {
    if (!assignment.barreSpan) continue
    // Say how many voices it actually covers - a three-string barre is a
    // bigger favour than a two-string one, and the difference is the point.
    const voices = assignment.notes.length
    const count = voices === 2 ? 'two' : voices === 3 ? 'three' : String(voices)
    reasons.push(
      assignment.finger === 2
        ? `middle-finger barre covers ${count} voices with one finger`
        : `barre with finger ${assignment.finger} covers ${count} voices at once`,
    )
  }
  if (option.fingering.strategies.includes('open-strings')) {
    reasons.push('uses open strings, which cost no fingers at all')
  }

  const spread = option.stringSet
  const gaps = spread.some((s, i) => i > 0 && s - spread[i - 1]! > 1)
  if (gaps) {
    reasons.push(
      `skips a string (${stringSetKey(spread)}) to open up the spacing`,
    )
  }

  if (target) {
    const fretted = option.voicing.notes.filter((n) => n.fret > 0).length
    const shift = option.voicing.lowestFret - target.lowestFret

    // Only worth mentioning when there is a stretch for the position to help,
    // and only when it actually helps. A lower position is a wider stretch,
    // which is a cost, not a selling point.
    if (fretted >= 2 && shift > 0) {
      reasons.push(
        `sits ${shift} fret${shift === 1 ? '' : 's'} higher, where the same span ` +
          'asks less of the hand',
      )
    }
    if (option.voicing.fretSpan < target.fretSpan) {
      reasons.push(
        `spans ${option.voicing.fretSpan} fret${option.voicing.fretSpan === 1 ? '' : 's'} ` +
          `instead of ${target.fretSpan}`,
      )
    }
    if (
      ((target.topMidi % 12) + 12) % 12 ===
      ((option.voicing.topMidi % 12) + 12) % 12
    ) {
      reasons.push('keeps the same note in the melody')
    }
  }

  // Only meaningful when fingers are actually in play - "the pinky is free" is
  // not news about a chord that uses no fingers at all.
  const fingersUsed = option.fingering.assignments.filter((a) => a.finger !== 0)
  if (fingersUsed.length > 0 && !fingersUsed.some((a) => a.finger === 4)) {
    reasons.push('leaves the pinky free for a melody note')
  }

  return reasons
}
