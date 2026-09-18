/**
 * The tuning, and the one fact that makes guitar theory its own subject.
 *
 * On a piano, an interval is an interval. On a guitar it is a SHAPE, and the
 * shape depends on which strings you are on, because the strings are not tuned
 * evenly. In standard tuning every adjacent pair is 5 frets apart except the G
 * and B strings, which are 4. So every shape that crosses that one boundary
 * needs an extra fret to stay the same interval.
 *
 * That single irregularity is responsible for most of what makes the fretboard
 * confusing, and no book about "music theory" will ever mention it, because on
 * every other instrument it does not exist. Here it is a first-class fact that
 * the engine derives rather than hard-codes, so it stays true in drop D, open
 * G, or anything else you tune to.
 */

import { midiAt, type Instrument, type StringNumber } from './instrument.js'

export interface StringPairStep {
  /** The lower-sounding string - the higher number. */
  lower: StringNumber
  /** The higher-sounding string - the lower number. */
  higher: StringNumber
  /** Frets between them when both are played at the same fret. */
  frets: number
  /**
   * Frets a shape gains when it crosses this pair, relative to the tuning's
   * regular step. On standard tuning this is +1 across the G and B strings and
   * 0 everywhere else.
   */
  shift: number
}

export interface TuningProfile {
  regularStep: number
  steps: StringPairStep[]
  /** The pairs that break the pattern. On standard tuning: G to B. */
  anomalies: StringPairStep[]
}

/**
 * Frets between two strings played at the same fret.
 * `low` is the lower-sounding string, which is the higher string number.
 */
export function fretsBetweenStrings(
  instrument: Instrument,
  low: StringNumber,
  high: StringNumber,
): number {
  return midiAt(instrument, high, 0) - midiAt(instrument, low, 0)
}

/**
 * Extra frets a shape needs when it moves from one string pair to another.
 *
 * The classic case: the octave shape on strings 6 and 4 is "2 strings over, 2
 * frets up". Move it to strings 4 and 2 and it becomes 3 frets up, because the
 * pair now crosses the G-B boundary. This function is where that +1 comes from,
 * and every "why did my shape stop working" question resolves to it.
 */
export function shapeShift(
  instrument: Instrument,
  from: [StringNumber, StringNumber],
  to: [StringNumber, StringNumber],
): number {
  return (
    fretsBetweenStrings(instrument, from[0], from[1]) -
    fretsBetweenStrings(instrument, to[0], to[1])
  )
}

export function tuningProfile(instrument: Instrument): TuningProfile {
  const count = instrument.tuning.length
  const raw: Omit<StringPairStep, 'shift'>[] = []
  for (let low = count; low > 1; low--) {
    raw.push({
      lower: low as StringNumber,
      higher: (low - 1) as StringNumber,
      frets: fretsBetweenStrings(instrument, low as StringNumber, (low - 1) as StringNumber),
    })
  }

  // The regular step is simply whichever gap turns up most often.
  const tally = new Map<number, number>()
  for (const step of raw) tally.set(step.frets, (tally.get(step.frets) ?? 0) + 1)
  const regularStep = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]![0]

  const steps: StringPairStep[] = raw.map((step) => ({
    ...step,
    shift: regularStep - step.frets,
  }))

  return { regularStep, steps, anomalies: steps.filter((s) => s.shift !== 0) }
}

/** Does a move from one string to another cross an irregular pair? */
export function crossesAnomaly(
  instrument: Instrument,
  low: StringNumber,
  high: StringNumber,
): StringPairStep[] {
  const { anomalies } = tuningProfile(instrument)
  return anomalies.filter((step) => step.lower <= low && step.higher >= high)
}

export function describeTuning(instrument: Instrument): string {
  const profile = tuningProfile(instrument)
  const lines = profile.steps.map((step) => {
    const flag = step.shift === 0 ? '' : `   <- ${step.shift > 0 ? '+' : ''}${step.shift} fret`
    return `  string ${step.lower} to ${step.higher}:  ${step.frets} frets${flag}`
  })
  return lines.join('\n')
}
