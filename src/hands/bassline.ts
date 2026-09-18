/**
 * Bass under a held chord.
 *
 * Generating a bass line is one problem; playing it while your fingers are busy
 * holding a chord is a different one, and it is the one that actually decides
 * whether an arrangement works. In this style the thumb is doing the bass and
 * the fingers are doing everything else, so the real question about any bass
 * note is not "can I reach it" but "can I reach it from here, right now, with
 * the hand shaped like this".
 *
 * Four ways a bass note is free:
 *   - its string is already fretted at that fret by the chord
 *   - it is an open string the chord is not using
 *   - it falls under a barre the hand is already holding
 *   - a finger is idle and can get there
 *
 * And one way it costs something: the thumb has to come over and take it, which
 * is fine if the profile says the thumb reaches that string.
 */

import { alternatingBass, type BassBar, type BassNote } from '../guitar/bass.js'
import { allStringSets } from '../guitar/generate.js'
import type { Instrument, StringNumber } from '../guitar/instrument.js'
import type { VoicedNote, Voicing } from '../guitar/voicing.js'
import type { ChordSymbol } from '../notes/chord.js'
import { chordDictionary } from './dictionary.js'
import { solveFingerings, type Fingering } from './fingering.js'
import type { FingerId, HandModel } from './hand.js'

export type ReachMethod =
  | 'already-fretted'
  | 'open-string'
  | 'under-barre'
  | 'free-finger'
  | 'thumb'
  | 'unreachable'

export interface Reach {
  method: ReachMethod
  reachable: boolean
  /** Which digit does it, when one is needed. */
  finger?: FingerId
  why: string
}

/** Can this bass note be played while the hand holds that voicing? */
export function reachFor(
  bass: VoicedNote,
  voicing: Voicing,
  fingering: Fingering,
  hand: HandModel,
): Reach {
  const occupied = voicing.notes.find((n) => n.string === bass.string)

  if (occupied && occupied.fret === bass.fret) {
    return {
      method: 'already-fretted',
      reachable: true,
      why: 'the chord is already holding that note - the thumb just sounds it',
    }
  }

  // A string the chord is using at a different fret cannot also give you this.
  if (occupied) {
    return {
      method: 'unreachable',
      reachable: false,
      why: `string ${bass.string} is held at fret ${occupied.fret} by the chord`,
    }
  }

  if (bass.fret === 0) {
    const barred = fingering.assignments.find(
      (a) => a.barreSpan && bass.string >= a.barreSpan[0] && bass.string <= a.barreSpan[1],
    )
    if (barred) {
      return {
        method: 'unreachable',
        reachable: false,
        why: `the barre at fret ${barred.fret} is lying across string ${bass.string}`,
      }
    }
    return {
      method: 'open-string',
      reachable: true,
      why: 'an open string the chord is not using - it costs nothing',
    }
  }

  const barre = fingering.assignments.find(
    (a) =>
      a.barreSpan &&
      a.fret === bass.fret &&
      bass.string >= a.barreSpan[0] &&
      bass.string <= a.barreSpan[1],
  )
  if (barre) {
    return {
      method: 'under-barre',
      reachable: true,
      finger: barre.finger,
      why: `already under the finger ${barre.finger} barre at fret ${bass.fret}`,
    }
  }

  const thumbUsed = fingering.assignments.some((a) => a.finger === 0)
  if (!thumbUsed) {
    const mode = hand.thumbModes.find((m) => m.strings.includes(bass.string))
    if (mode) {
      const anchor = fingering.assignments
        .filter((a) => a.finger !== 0)
        .reduce((low, a) => Math.min(low, a.fret), Infinity)
      const offset = Number.isFinite(anchor) ? bass.fret - anchor : 0
      if (offset >= mode.fretOffset[0] && offset <= mode.fretOffset[1]) {
        return {
          method: 'thumb',
          reachable: true,
          finger: 0,
          why: `the thumb comes over for it (${mode.name})`,
        }
      }
      return {
        method: 'unreachable',
        reachable: false,
        why:
          `the thumb reaches string ${bass.string} but not ${offset} fret` +
          `${Math.abs(offset) === 1 ? '' : 's'} from where the hand is sitting`,
      }
    }
  }

  const free = ([1, 2, 3, 4] as FingerId[]).filter(
    (id) => hand.fingers[id].canFret && !fingering.assignments.some((a) => a.finger === id),
  )
  for (const id of free) {
    const [low, high] = hand.fingers[id].fretOffset
    const anchor =
      fingering.assignments.find((a) => a.finger === 1)?.fret ??
      fingering.assignments
        .filter((a) => a.finger !== 0)
        .reduce((lowest, a) => Math.min(lowest, a.fret), bass.fret)
    const offset = bass.fret - anchor
    if (offset >= low - 1 && offset <= high + 1) {
      return {
        method: 'free-finger',
        reachable: true,
        finger: id,
        why: `finger ${id} is idle and can get there`,
      }
    }
  }

  return {
    method: 'unreachable',
    reachable: false,
    why: 'no free digit can get to it while the chord is held',
  }
}

export interface ArrangedNote extends BassNote {
  reach: Reach
}

export interface ArrangedBar {
  bar: number
  chord: BassBar['chord']
  voicing: Voicing
  fingering: Fingering
  notes: ArrangedNote[]
  /** True when every bass note in the bar is playable under this shape. */
  playable: boolean
}

/**
 * Put a bass line together with the chord shapes it has to be played under, and
 * report honestly which notes do not work.
 *
 * The failures are the useful part. A bass note that cannot be reached under a
 * particular grip is not a dead end - it is a signal that the grip is the thing
 * to change, which is exactly what `findAlternatives` is for.
 */
export function arrangeBass(
  _instrument: Instrument,
  bars: BassBar[],
  voicings: { voicing: Voicing; fingering: Fingering }[],
  hand: HandModel,
): ArrangedBar[] {
  return bars.map((bar, index) => {
    const held = voicings[index] ?? voicings[voicings.length - 1]!
    const notes: ArrangedNote[] = bar.notes.map((note) => ({
      ...note,
      reach: reachFor(note.note, held.voicing, held.fingering, hand),
    }))
    return {
      bar: bar.bar,
      chord: bar.chord,
      voicing: held.voicing,
      fingering: held.fingering,
      notes,
      playable: notes.every((n) => n.reach.reachable),
    }
  })
}

export interface ThumbAndFingersOptions {
  /** Strings the chord may use. Default the top four. */
  chordStrings?: StringNumber[]
  /** Strings the thumb works on. Default 6 and 5. */
  bassStrings?: StringNumber[]
  fretRange?: [number, number]
  alternateWith?: 3 | 5
  walkups?: boolean
  /** Candidate chord shapes tried per bar. Default 40. */
  branching?: number
}

/**
 * Thumb and fingers together, which is the only way this style actually works.
 *
 * Generating a bass line and a set of chord shapes separately produces two
 * things that cannot be played at the same time: the comping search puts chords
 * wherever they are easiest, the bass search puts roots wherever they are
 * lowest, and the hand cannot be in both places. They have to be chosen
 * together or not at all.
 *
 * So the chord is confined to the upper strings and forbidden the thumb - the
 * thumb has a job already - and shapes are then scored on whether the bar's bass
 * notes are within reach of that shape, not merely on whether the grip is easy.
 */
export function arrangeThumbAndFingers(
  instrument: Instrument,
  progression: ChordSymbol[],
  hand: HandModel,
  options: ThumbAndFingersOptions = {},
): ArrangedBar[] {
  const {
    chordStrings = [1, 2, 3, 4],
    bassStrings = [6, 5],
    fretRange = [0, 9],
    alternateWith = 5,
    walkups = true,
    branching = 40,
  } = options

  // The bass goes first: its notes are far more constrained than the chord's.
  const bars = alternatingBass(instrument, progression, {
    strings: bassStrings,
    fretRange,
    alternateWith,
    walkups,
  })

  const stringSets = allStringSets(6, 3, chordStrings.length, chordStrings.length).filter(
    (set) => set.every((s) => chordStrings.includes(s)),
  )

  return bars.map((bar) => {
    const candidates = chordDictionary(instrument, bar.chord, hand, {
      stringSets,
      fretRange,
      moveableOnly: false,
      limit: branching,
    })

    let chosen: { voicing: Voicing; fingering: Fingering; notes: ArrangedNote[] } | undefined
    let chosenScore = Infinity

    for (const candidate of candidates) {
      // The thumb is spoken for, so a grip that needs it is not available here.
      const [fingering] = solveFingerings(candidate.voicing, hand, instrument, {
        maxResults: 1,
        allowThumb: false,
      })
      if (!fingering) continue

      const notes: ArrangedNote[] = bar.notes.map((note) => ({
        ...note,
        reach: reachFor(note.note, candidate.voicing, fingering, hand),
      }))
      const unreachable = notes.filter((n) => !n.reach.reachable).length
      const score = unreachable * 10 + fingering.cost + candidate.spacingPenalty
      if (score < chosenScore) {
        chosenScore = score
        chosen = { voicing: candidate.voicing, fingering, notes }
      }
      if (unreachable === 0 && score < 3) break
    }

    if (!chosen) {
      return {
        bar: bar.bar,
        chord: bar.chord,
        voicing: undefined as unknown as Voicing,
        fingering: undefined as unknown as Fingering,
        notes: bar.notes.map((note) => ({
          ...note,
          reach: {
            method: 'unreachable' as const,
            reachable: false,
            why: 'no chord shape on these strings works for this hand',
          },
        })),
        playable: false,
      }
    }

    return {
      bar: bar.bar,
      chord: bar.chord,
      voicing: chosen.voicing,
      fingering: chosen.fingering,
      notes: chosen.notes,
      playable: chosen.notes.every((n) => n.reach.reachable),
    }
  })
}
