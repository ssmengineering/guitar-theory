/**
 * Fitting the hand model to an actual hand.
 *
 * Every number in a hand profile started as a guess, and guesses about hands are
 * bad: neither of us can introspect a stretch into inches, and the numbers that
 * matter most here - how wide a middle-finger barre goes, how far the thumb
 * reaches from the hand position - are ones no book would ever have reason to
 * write down.
 *
 * So the app asks instead. It shows a grip, you try it, you say whether it was
 * comfortable, awkward, or not happening. Empirical characterisation rather than
 * a priori modelling, which is the right way round when the system being
 * modelled is sitting right there holding the instrument.
 *
 * The one design decision that makes the fitting tractable: each probe ISOLATES
 * a single parameter, and probes for a parameter come in a graded series that
 * gets harder. Fitting is then just finding where each series stops working,
 * rather than a search over a model with six knobs at once.
 */

import { fretGap, type Instrument, type StringNumber } from '../guitar/instrument.js'
import { voicing, type Voicing } from '../guitar/voicing.js'
import type { HandModel, ThumbMode } from './hand.js'

export type Verdict = 'comfortable' | 'awkward' | 'impossible'

export type ParameterId =
  | 'span-index-pinky'
  | 'span-middle-pinky'
  | 'middle-barre'
  | 'thumb-strings'
  | 'thumb-barre'
  | 'thumb-offset'

export interface Probe {
  id: string
  parameter: ParameterId
  /** Position in the graded series. Higher is harder. */
  step: number
  positions: [StringNumber, number][]
  /** What this grip is asking you. */
  asks: string
  /** Which digits to use, so the probe tests what it means to test. */
  suggestion: string
  /** The parameter value this step demonstrates, if you can play it. */
  value: number
}

export interface ProbeGroup {
  parameter: ParameterId
  title: string
  /** Why this parameter is worth several minutes of your time. */
  why: string
  /**
   * True when the probes get steadily harder, so the fit is "where does this
   * stop working". False when they are independent questions - whether the
   * thumb reaches string 5 says nothing about whether it reaches string 6.
   */
  graded: boolean
  probes: Probe[]
}

export interface ProbeResult {
  probeId: string
  verdict: Verdict
}

const SPAN_ANCHOR = 3

/**
 * The probe set.
 *
 * Span probes sit down at the 3rd fret on purpose: that is where the frets are
 * widest and a limit actually bites. The answer is converted to inches, which is
 * position-independent, so one series near the nut tells the model what is
 * possible everywhere on the neck.
 */
export function buildProbes(instrument: Instrument): ProbeGroup[] {
  const spanInches = (frets: number) =>
    fretGap(SPAN_ANCHOR, SPAN_ANCHOR + frets, instrument.scaleLength)

  const spanSeries = (
    parameter: ParameterId,
    fingers: string,
    lowString: StringNumber,
    highString: StringNumber,
    reach: number[],
  ): Probe[] =>
    reach.map((frets, index) => ({
      id: `${parameter}-${frets}`,
      parameter,
      step: index,
      positions: [
        [lowString, SPAN_ANCHOR],
        [highString, SPAN_ANCHOR + frets],
      ] as [StringNumber, number][],
      asks: `A ${frets}-fret stretch down at the 3rd fret — ${spanInches(frets).toFixed(2)}″ of reach.`,
      suggestion: fingers,
      value: spanInches(frets),
    }))

  return [
    {
      parameter: 'span-middle-pinky',
      graded: true,
      title: 'Middle to pinky',
      why:
        'The number that matters most. With no ring finger between them, your ' +
        'pinky covers ground that would normally be split between two fingers, ' +
        'so this span decides more about what is playable than anything else here.',
      probes: spanSeries(
        'span-middle-pinky',
        'Middle finger on the lower note, pinky on the higher one.',
        5,
        4,
        [2, 3, 4, 5],
      ),
    },
    {
      parameter: 'span-index-pinky',
      graded: true,
      title: 'Index to pinky',
      why: 'The outer limit of the hand — the widest grip you can form at all.',
      probes: spanSeries(
        'span-index-pinky',
        'Index on the lower note, pinky on the higher one.',
        5,
        4,
        [3, 4, 5, 6],
      ),
    },
    {
      parameter: 'middle-barre',
      graded: true,
      title: 'Middle-finger barre',
      why:
        'Not standard technique, and not in any chord book — which is exactly ' +
        'why it needs measuring. It is the capability that buys back the voice ' +
        'the ring finger used to cover, and the generator reaches for it often.',
      probes: [2, 3, 4].map((width, index) => ({
        id: `middle-barre-${width}`,
        parameter: 'middle-barre' as const,
        step: index,
        positions: [
          [6, 5] as [StringNumber, number],
          ...Array.from(
            { length: width },
            (_, i) => [(4 - i) as StringNumber, 7] as [StringNumber, number],
          ),
        ],
        asks: `Middle finger flat across ${width} strings at the 7th fret, index on the low E.`,
        suggestion: 'Index on string 6, middle laid flat across the rest.',
        value: width,
      })),
    },
    {
      parameter: 'thumb-strings',
      graded: false,
      title: 'What the thumb can reach',
      why:
        'String 6 is the workhorse. If string 5 also works, every A-shape ' +
        'voicing opens up the same way E-shapes already have.',
      probes: [
        {
          id: 'thumb-strings-6',
          parameter: 'thumb-strings',
          step: 0,
          positions: [
            [6, 5],
            [4, 7],
            [3, 6],
          ],
          asks: 'Thumb over the top for the low E, fingers on the shape above it.',
          suggestion: 'Thumb on string 6. Fingers take the other two.',
          value: 6,
        },
        {
          id: 'thumb-strings-5',
          parameter: 'thumb-strings',
          step: 1,
          positions: [
            [5, 5],
            [3, 7],
            [2, 6],
          ],
          asks: 'The same idea one string over — thumb on the A string this time.',
          suggestion: 'Thumb on string 5, letting string 6 stay silent.',
          value: 5,
        },
      ],
    },
    {
      parameter: 'thumb-barre',
      graded: true,
      title: 'Barring while the thumb is wrapped',
      why:
        'The single highest-value answer in this session. With the thumb over ' +
        'the top you lose the leverage for a full barre, but the index can ' +
        'usually still lie across the treble side. How far it reaches decides ' +
        'whether a whole family of voicings exists.',
      probes: [2, 3, 4].map((highest, index) => ({
        id: `thumb-barre-${highest}`,
        parameter: 'thumb-barre' as const,
        step: index,
        positions: [
          [6, 5] as [StringNumber, number],
          ...Array.from(
            { length: highest },
            (_, i) => [(i + 1) as StringNumber, 5] as [StringNumber, number],
          ),
        ],
        asks: `Thumb on the low E, index barring strings 1 through ${highest} at the same fret.`,
        suggestion: 'Thumb wrapped over. Index flat across the treble strings.',
        value: highest,
      })),
    },
    {
      parameter: 'thumb-offset',
      graded: true,
      title: 'How far the thumb sits from the hand',
      why:
        'Whether the thumb has to sit level with the fingers or can lag behind ' +
        'or lead them. Currently assumed to be within one fret, which is ' +
        'conservative and may be costing you arrangements.',
      probes: [-2, -1, 0, 1, 2].map((offset, index) => ({
        id: `thumb-offset-${offset}`,
        parameter: 'thumb-offset' as const,
        step: index,
        positions: [
          [6, 7 + offset] as [StringNumber, number],
          [3, 7] as [StringNumber, number],
          [2, 7] as [StringNumber, number],
        ],
        asks:
          offset === 0
            ? 'Thumb level with the fingers.'
            : `Thumb ${Math.abs(offset)} fret${Math.abs(offset) === 1 ? '' : 's'} ` +
              `${offset < 0 ? 'behind' : 'ahead of'} the fingers.`,
        suggestion: 'Thumb on string 6, index and middle holding the two above.',
        value: offset,
      })),
    },
  ]
}

export const allProbes = (instrument: Instrument): Probe[] =>
  buildProbes(instrument).flatMap((group) => group.probes)

export function probeVoicing(instrument: Instrument, probe: Probe): Voicing {
  return voicing(instrument, probe.positions)
}

/* Fitting ------------------------------------------------------------------ */

export interface ParameterChange {
  parameter: ParameterId
  label: string
  before: string
  after: string
  note: string
}

export interface FitResult {
  hand: HandModel
  changes: ParameterChange[]
  answered: number
  total: number
}

/**
 * Turn answers into parameters.
 *
 * "Awkward" counts as possible. The model has one number per capability, not
 * two, so the honest reading of an awkward grip is that it is within reach and
 * expensive - which is what a cost function is for. Only "impossible" closes a
 * door.
 */
export function fitHand(
  base: HandModel,
  results: ProbeResult[],
  instrument: Instrument,
): FitResult {
  const verdicts = new Map(results.map((r) => [r.probeId, r.verdict]))
  const groups = buildProbes(instrument)
  const changes: ParameterChange[] = []

  const answeredIn = (parameter: ParameterId): Probe[] =>
    groups
      .find((g) => g.parameter === parameter)!
      .probes.filter((p) => verdicts.has(p.id))

  /** The hardest step in a series that was not ruled out. */
  const limitOf = (parameter: ParameterId): number | undefined => {
    const answered = answeredIn(parameter)
    if (answered.length === 0) return undefined
    const possible = answered.filter((p) => verdicts.get(p.id) !== 'impossible')
    if (possible.length === 0) {
      // Everything failed, so the limit is below the easiest thing tried.
      return Math.min(...answered.map((p) => p.value))
    }
    return Math.max(...possible.map((p) => p.value))
  }

  const fingers = { ...base.fingers }
  let maxSpanInches = base.maxSpanInches
  let thumbModes: ThumbMode[] = base.thumbModes.map((m) => ({ ...m }))

  // Span: the outer limit is whichever series reaches further.
  const spans = [limitOf('span-index-pinky'), limitOf('span-middle-pinky')].filter(
    (x): x is number => x !== undefined,
  )
  if (spans.length > 0) {
    const fitted = Number(Math.max(...spans).toFixed(2))
    if (Math.abs(fitted - base.maxSpanInches) > 0.01) {
      changes.push({
        parameter: 'span-index-pinky',
        label: 'Maximum reach',
        before: `${base.maxSpanInches.toFixed(2)}″`,
        after: `${fitted.toFixed(2)}″`,
        note:
          fitted > base.maxSpanInches
            ? 'Wider than assumed — more voicings are within reach than the model allowed.'
            : 'Narrower than assumed — the model was offering you grips you cannot hold.',
      })
    }
    maxSpanInches = fitted
  }

  const barre = limitOf('middle-barre')
  if (barre !== undefined && barre !== fingers[2].maxBarreStrings) {
    changes.push({
      parameter: 'middle-barre',
      label: 'Middle-finger barre',
      before: `${fingers[2].maxBarreStrings} strings`,
      after: `${barre} strings`,
      note:
        barre < fingers[2].maxBarreStrings
          ? 'Narrower than assumed. Voicings that needed a wider middle barre will disappear.'
          : 'Wider than assumed. More of the generated dictionary opens up.',
    })
    fingers[2] = { ...fingers[2], maxBarreStrings: barre }
  }

  // Thumb strings are independent yes/no questions, not a graded series.
  const thumbStringProbes = answeredIn('thumb-strings')
  if (thumbStringProbes.length > 0) {
    const reachable = thumbStringProbes
      .filter((p) => verdicts.get(p.id) !== 'impossible')
      .map((p) => p.value as StringNumber)
      .sort((a, b) => b - a)
    const bass = thumbModes.find((m) => m.name === 'bass-wrap')
    if (bass && reachable.length > 0 && reachable.join() !== bass.strings.join()) {
      changes.push({
        parameter: 'thumb-strings',
        label: 'Thumb reach (bass wrap)',
        before: `string${bass.strings.length === 1 ? '' : 's'} ${bass.strings.join(', ')}`,
        after: `string${reachable.length === 1 ? '' : 's'} ${reachable.join(', ')}`,
        note: reachable.includes(5)
          ? 'String 5 works, so A-shape voicings open up the way E-shapes already had.'
          : 'String 6 only, as assumed.',
      })
      bass.strings = reachable
    }
  }

  const barreLimit = limitOf('thumb-barre')
  const bassMode = thumbModes.find((m) => m.name === 'bass-wrap')
  if (barreLimit !== undefined && bassMode && barreLimit !== bassMode.barreLimit) {
    changes.push({
      parameter: 'thumb-barre',
      label: 'Index barre while the thumb is wrapped',
      before: bassMode.barreLimit === null ? 'unrestricted' : `to string ${bassMode.barreLimit}`,
      after: `to string ${barreLimit}`,
      note:
        barreLimit >= 3
          ? 'A wide treble barre survives the thumb wrap — that is a large family of voicings.'
          : 'Only a narrow barre survives, so the generator will stop offering wide ones.',
    })
    bassMode.barreLimit = barreLimit
  }

  // Offset is a range, so it needs both ends rather than a single limit.
  const offsetProbes = answeredIn('thumb-offset').filter(
    (p) => verdicts.get(p.id) !== 'impossible',
  )
  if (offsetProbes.length > 0 && bassMode) {
    const low = Math.min(...offsetProbes.map((p) => p.value))
    const high = Math.max(...offsetProbes.map((p) => p.value))
    const before = bassMode.fretOffset
    if (low !== before[0] || high !== before[1]) {
      changes.push({
        parameter: 'thumb-offset',
        label: 'Thumb position relative to the hand',
        before: `${before[0]} to ${before[1]} frets`,
        after: `${low} to ${high} frets`,
        note:
          high - low > before[1] - before[0]
            ? 'A wider window than assumed, which frees up the thumb-and-fingers arrangements.'
            : 'A tighter window, so the thumb has to stay closer to the hand.',
      })
      bassMode.fretOffset = [low, high]
      const treble = thumbModes.find((m) => m.name === 'treble-reach')
      if (treble) treble.fretOffset = [low, high]
    }
  }

  const total = groups.reduce((sum, g) => sum + g.probes.length, 0)

  return {
    hand: { ...base, fingers, maxSpanInches, thumbModes },
    changes,
    answered: verdicts.size,
    total,
  }
}

/** The fitted profile, as something to paste into profiles.ts. */
export function profileSource(hand: HandModel): string {
  const thumb = hand.thumbModes
    .map(
      (m) =>
        `  {\n` +
        `    name: '${m.name}',\n` +
        `    strings: [${m.strings.join(', ')}],\n` +
        `    maxSimultaneous: ${m.maxSimultaneous},\n` +
        `    fretOffset: [${m.fretOffset[0]}, ${m.fretOffset[1]}],\n` +
        `    barreLimit: ${m.barreLimit},\n` +
        `    cost: ${m.cost},\n` +
        `  },`,
    )
    .join('\n')

  return (
    `// Fitted from a calibration session, not guessed.\n` +
    `maxSpanInches: ${hand.maxSpanInches},\n` +
    `fingers[2].maxBarreStrings: ${hand.fingers[2].maxBarreStrings},\n` +
    `thumbModes: [\n${thumb}\n]`
  )
}
