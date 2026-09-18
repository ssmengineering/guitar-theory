/**
 * Layer 3.5 - The hand.
 *
 * This layer is a LENS, not a filter baked into the engine. Nothing in
 * src/theory or src/guitar imports anything from here. The theory stays
 * universal; a hand profile is applied at the very end, when the question
 * changes from "what are the voicings of this chord" to "which of them can
 * these particular hands actually play".
 *
 * That separation is what keeps the app a general theory tool. Swap the
 * profile and it answers for anybody - a student, a standard-handed player, or
 * a hand with its own history.
 */

import type { StringNumber } from '../guitar/instrument.js'

/** 0 is the thumb. 1 index, 2 middle, 3 ring, 4 pinky. */
export type FingerId = 0 | 1 | 2 | 3 | 4

export interface FingerModel {
  id: FingerId
  /** Can it stop a string cleanly at all? */
  canFret: boolean
  /** Can it damp a string? A finger may be useful for this and not for fretting. */
  canMute: boolean
  /** Widest barre in strings. 0 means it cannot barre. */
  maxBarreStrings: number
  /**
   * Fret range this finger works in, relative to the index finger's fret.
   * The index is the anchor at [0, 0]. Fitted by calibration.
   */
  fretOffset: [number, number]
  notes?: string
}

/**
 * The thumb does more than one job, and the jobs have different reach.
 * Modelling it as a single reach range would imply it can also stop the middle
 * strings, which is not how a thumb over the neck works.
 */
export interface ThumbMode {
  name: string
  /** Strings this mode can actually stop. */
  strings: StringNumber[]
  /** 1, or 2 if the thumb lies across a pair. */
  maxSimultaneous: number
  fretOffset: [number, number]
  /**
   * How much index barre survives while this mode is in use, as the highest
   * string number reachable: 3 means the index can still barre strings 1-3.
   * null means the barre is unaffected. 0 means no barre at all.
   */
  barreLimit: number | null
  /** Search cost. Everyday technique is cheap; situational tricks are not. */
  cost: number
}

export interface HandModel {
  name: string
  fingers: Record<FingerId, FingerModel>
  thumbModes: ThumbMode[]
  /**
   * Widest reach between the lowest and highest fretted note, in inches.
   * A calibration parameter - fitted from marked examples, not measured.
   */
  maxSpanInches: number
  /**
   * Cost per fret of an out-of-order fingering, where a higher-numbered finger
   * sits closer to the nut than a lower-numbered one. Physically possible but
   * tangled, and the number says how much you dislike it.
   */
  crossingPenalty: number
}

export const fretingFingers = (hand: HandModel): FingerModel[] =>
  ([1, 2, 3, 4] as FingerId[]).map((id) => hand.fingers[id]).filter((f) => f.canFret)

export const thumbModeFor = (hand: HandModel, string: StringNumber): ThumbMode[] =>
  hand.thumbModes.filter((mode) => mode.strings.includes(string))
