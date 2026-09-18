/**
 * Hand profiles.
 *
 * Every number marked CALIBRATE is a placeholder waiting for real data. The
 * plan is not to guess these: the app shows a spread of grips, you mark each
 * one comfortable / awkward / impossible, and the parameters get fitted to
 * your answers. Empirical characterisation beats a priori modelling here,
 * because neither of us can accurately introspect a hand into millimetres.
 */

import type { FingerId, FingerModel, HandModel, ThumbMode } from './hand.js'

const finger = (
  id: FingerId,
  canFret: boolean,
  maxBarreStrings: number,
  fretOffset: [number, number],
  notes?: string,
): FingerModel => ({ id, canFret, canMute: canFret, maxBarreStrings, fretOffset, notes })

/* ------------------------------------------------------------------------ */

const STANDARD_THUMB: ThumbMode[] = [
  {
    name: 'bass-wrap',
    strings: [6],
    maxSimultaneous: 1,
    fretOffset: [-1, 1],
    barreLimit: 0,
    cost: 0.8,
  },
]

/** A conventional four-finger hand. The default for anybody else. */
export const STANDARD_HAND: HandModel = {
  name: 'Standard',
  fingers: {
    0: finger(0, true, 0, [-1, 1], 'Thumb over the top, string 6 only.'),
    1: finger(1, true, 6, [0, 0], 'The anchor.'),
    2: finger(2, true, 2, [0, 3]),
    3: finger(3, true, 2, [1, 4]),
    4: finger(4, true, 0, [2, 5]),
  },
  thumbModes: STANDARD_THUMB,
  maxSpanInches: 4.6,
  crossingPenalty: 1.2,
}

/* ------------------------------------------------------------------------ */

const MY_THUMB: ThumbMode[] = [
  {
    // The workhorse. Thumb takes the root on string 6, which frees the fingers
    // to build the shape above it - an E-shape G played without a full barre.
    name: 'bass-wrap',
    strings: [6], // CALIBRATE: does string 5 work too? That would unlock A shapes.
    maxSimultaneous: 1,
    fretOffset: [-1, 1],
    barreLimit: 3, // CALIBRATE: how much index barre survives - strings 1-2, or 1-3?
    cost: 0.2, // cheap, because this is everyday technique
  },
  {
    // The occasional trick: certain shapes only, treble strings only.
    name: 'treble-reach',
    strings: [1, 2],
    maxSimultaneous: 1,
    fretOffset: [-1, 1],
    barreLimit: 0,
    cost: 3.0, // expensive, so the search only reaches for it to unlock something
  },
]

/**
 * This hand: index, middle and pinky fret; the ring finger takes no notes but
 * stays out of the way, so it is simply absent from the search rather than
 * penalised.
 * Barres come from index AND middle, which is not standard technique and is not
 * assumed by any chord book in print - it is the capability that buys back the
 * voice the ring finger used to cover.
 */
export const MY_HAND: HandModel = {
  name: 'Mine',
  fingers: {
    0: finger(0, true, 0, [-1, 1], 'Two modes: bass wrap on 6, occasional reach to 1-2.'),
    1: finger(1, true, 6, [0, 0], 'Full barre available when the thumb is behind the neck.'),
    2: finger(2, true, 4, [0, 3], 'Barres - load-bearing, not a curiosity.'), // CALIBRATE width
    3: finger(3, false, 0, [0, 0], 'Takes no notes. Mobile and out of the way, so it costs nothing.'),
    4: finger(4, true, 0, [1, 5], 'Covers ground that would normally be split with the ring finger.'),
  },
  thumbModes: MY_THUMB,
  maxSpanInches: 4.6, // CALIBRATE: the 2-to-4 span is the number that matters most
  crossingPenalty: 1.6, // tangled shapes are worse without a ring finger to anchor
}

export const HAND_PROFILES: Record<string, HandModel> = {
  standard: STANDARD_HAND,
  mine: MY_HAND,
}
