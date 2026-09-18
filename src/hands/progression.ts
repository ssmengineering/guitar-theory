/**
 * Playing through changes.
 *
 * Choosing voicings for a progression is not the same problem as choosing a
 * voicing for a chord. A shape that is easy on its own may be the wrong shape
 * here, because getting to it means throwing the whole hand across the neck -
 * and a slightly harder grip that leaves three fingers where they already are
 * beats it every time.
 *
 * So this is a shortest path, not a series of independent lookups: every chord
 * offers candidates, and the route is chosen to minimise the hand's total work
 * across the whole progression rather than at each step separately.
 */

import type { Instrument } from '../guitar/instrument.js'
import {
  transition,
  type Transition,
} from '../guitar/voiceleading.js'
import type { ChordSymbol } from '../notes/chord.js'
import { chordDictionary, type DictionaryOptions, type PlayableVoicing } from './dictionary.js'
import type { HandModel } from './hand.js'

export interface PathStep {
  chord: ChordSymbol
  option: PlayableVoicing
  /** How the hand got here. Undefined for the first chord. */
  transition?: Transition
}

export interface PathOptions extends DictionaryOptions {
  /**
   * How much to weigh smooth voice leading against an easy grip.
   * 0 ignores motion entirely; 1 is roughly parity; higher chases smoothness
   * even into harder shapes. Default 0.35.
   */
  motionWeight?: number
  /** Candidate voicings considered per chord. Default 12. */
  branching?: number
  /** Keep this degree in the melody throughout, e.g. 3 for a held third. */
  holdTopDegree?: number
}

/**
 * The smoothest way these hands can play a progression.
 *
 * Returns one voicing per chord plus the motion between them, so the result can
 * be read either as a comping part or as a voice-leading lesson - the same data
 * answers "what do I play" and "why does it move like that".
 */
export function smoothestPath(
  instrument: Instrument,
  progression: ChordSymbol[],
  hand: HandModel,
  options: PathOptions = {},
): PathStep[] {
  const {
    motionWeight = 0.35,
    branching = 12,
    holdTopDegree,
    ...dictionaryOptions
  } = options

  if (progression.length === 0) return []

  const layers = progression.map((symbol) =>
    chordDictionary(instrument, symbol, hand, {
      moveableOnly: true,
      ...dictionaryOptions,
      ...(holdTopDegree === undefined ? {} : { topDegree: holdTopDegree }),
      limit: branching,
    }),
  )

  if (layers.some((layer) => layer.length === 0)) return []

  // Viterbi. Cost of a step is the grip plus the journey to reach it.
  const best: number[][] = layers.map((layer) => new Array(layer.length).fill(Infinity))
  const prev: number[][] = layers.map((layer) => new Array(layer.length).fill(-1))
  best[0] = layers[0]!.map((entry) => entry.cost)

  for (let step = 1; step < layers.length; step++) {
    for (let j = 0; j < layers[step]!.length; j++) {
      const candidate = layers[step]![j]!
      for (let i = 0; i < layers[step - 1]!.length; i++) {
        const previous = layers[step - 1]![i]!
        const move = transition(previous.voicing, candidate.voicing, {
          from: previous,
          to: candidate,
        })
        const total =
          best[step - 1]![i]! + candidate.cost + move.effort * motionWeight
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
    const option = layer[chosen[step]!]!
    if (step === 0) return { chord: progression[step]!, option }
    const previous = layers[step - 1]![chosen[step - 1]!]!
    return {
      chord: progression[step]!,
      option,
      transition: transition(previous.voicing, option.voicing, {
        from: previous,
        to: option,
      }),
    }
  })
}

/** Total voice movement across a whole path - the number to beat. */
export const pathMotion = (path: PathStep[]): number =>
  path.reduce((sum, step) => sum + (step.transition?.totalMotion ?? 0), 0)

/** Movement plus the cost of changing and relocating the shape. */
export const pathEffort = (path: PathStep[]): number =>
  path.reduce((sum, step) => sum + (step.transition?.effort ?? 0), 0)
