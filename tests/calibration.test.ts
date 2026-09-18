import { describe, expect, it } from 'vitest'
import { FENDER, GIBSON } from '../src/guitar/instrument.js'
import { MY_HAND, STANDARD_HAND } from '../src/hands/profiles.js'
import {
  allProbes,
  buildProbes,
  fitHand,
  probeVoicing,
  type ProbeResult,
  type Verdict,
} from '../src/hands/calibration.js'

const probes = allProbes(FENDER)
const byId = new Map(probes.map((p) => [p.id, p]))

const answer = (pairs: Record<string, Verdict>): ProbeResult[] =>
  Object.entries(pairs).map(([probeId, verdict]) => ({ probeId, verdict }))

/** Answer a whole graded series up to `limit`, failing everything past it. */
function upTo(parameter: string, limit: number): ProbeResult[] {
  return probes
    .filter((p) => p.parameter === parameter)
    .map((p) => ({
      probeId: p.id,
      verdict: (p.value <= limit ? 'comfortable' : 'impossible') as Verdict,
    }))
}

describe('the probe set', () => {
  it('gives every probe a real, buildable grip', () => {
    for (const probe of probes) {
      const shape = probeVoicing(FENDER, probe)
      expect(shape.notes.length).toBe(probe.positions.length)
    }
  })

  it('asks something and suggests how to try it', () => {
    for (const probe of probes) {
      expect(probe.asks.length).toBeGreaterThan(12)
      expect(probe.suggestion.length).toBeGreaterThan(12)
    }
  })

  it('grades each series from easier to harder', () => {
    for (const group of buildProbes(FENDER).filter((g) => g.graded)) {
      const values = group.probes.map((p) => p.value)
      expect(values).toEqual([...values].sort((a, b) => a - b))
    }
  })

  it('marks the one group that is not a series', () => {
    // Whether the thumb reaches string 5 tells you nothing about string 6, so
    // there is no "where does it stop" to look for.
    const ungraded = buildProbes(FENDER).filter((g) => !g.graded)
    expect(ungraded.map((g) => g.parameter)).toEqual(['thumb-strings'])
  })

  it('isolates one parameter per probe', () => {
    for (const group of buildProbes(FENDER)) {
      for (const probe of group.probes) {
        expect(probe.parameter).toBe(group.parameter)
      }
    }
  })

  it('measures spans in inches, so the answer holds anywhere on the neck', () => {
    const onFender = allProbes(FENDER).filter((p) => p.parameter === 'span-middle-pinky')
    const onGibson = allProbes(GIBSON).filter((p) => p.parameter === 'span-middle-pinky')
    // The same fret count is a shorter reach on a shorter scale, and the probe
    // values say so rather than both claiming "4 frets".
    expect(onGibson[2]!.value).toBeLessThan(onFender[2]!.value)
  })
})

describe('fitting', () => {
  it('changes nothing when nothing has been answered', () => {
    const fit = fitHand(MY_HAND, [], FENDER)
    expect(fit.changes).toHaveLength(0)
    expect(fit.answered).toBe(0)
    expect(fit.hand.maxSpanInches).toBe(MY_HAND.maxSpanInches)
  })

  it('treats awkward as possible, because the model prices rather than forbids', () => {
    const wide = probes.find((p) => p.parameter === 'span-index-pinky' && p.step === 3)!
    const fit = fitHand(MY_HAND, answer({ [wide.id]: 'awkward' }), FENDER)
    expect(fit.hand.maxSpanInches).toBeCloseTo(wide.value, 2)
  })

  it('narrows the reach when the wide stretches fail', () => {
    const results = [...upTo('span-index-pinky', 3.5), ...upTo('span-middle-pinky', 3.5)]
    const fit = fitHand(MY_HAND, results, FENDER)
    expect(fit.hand.maxSpanInches).toBeLessThan(MY_HAND.maxSpanInches)
    expect(fit.changes.some((c) => c.note.includes('cannot hold'))).toBe(true)
  })

  it('falls back below the easiest probe when every stretch fails', () => {
    const results = probes
      .filter((p) => p.parameter === 'span-middle-pinky')
      .map((p) => ({ probeId: p.id, verdict: 'impossible' as Verdict }))
    const fit = fitHand(MY_HAND, results, FENDER)
    const easiest = Math.min(
      ...probes.filter((p) => p.parameter === 'span-middle-pinky').map((p) => p.value),
    )
    expect(fit.hand.maxSpanInches).toBeCloseTo(easiest, 2)
  })

  it('narrows the middle-finger barre when the wide ones fail', () => {
    const fit = fitHand(MY_HAND, upTo('middle-barre', 2), FENDER)
    expect(fit.hand.fingers[2].maxBarreStrings).toBe(2)
    // This was the placeholder that most changed what the generator offers.
    expect(fit.changes.some((c) => c.parameter === 'middle-barre')).toBe(true)
  })

  it('opens up string 5 for the thumb when it works', () => {
    const fit = fitHand(
      MY_HAND,
      answer({ 'thumb-strings-6': 'comfortable', 'thumb-strings-5': 'awkward' }),
      FENDER,
    )
    const bass = fit.hand.thumbModes.find((m) => m.name === 'bass-wrap')!
    expect(bass.strings).toEqual([6, 5])
    expect(fit.changes.some((c) => c.note.includes('A-shape'))).toBe(true)
  })

  it('keeps the thumb on string 6 when string 5 does not work', () => {
    const fit = fitHand(
      MY_HAND,
      answer({ 'thumb-strings-6': 'comfortable', 'thumb-strings-5': 'impossible' }),
      FENDER,
    )
    expect(fit.hand.thumbModes.find((m) => m.name === 'bass-wrap')!.strings).toEqual([6])
  })

  it('fits how much barre survives the thumb wrap', () => {
    const wide = fitHand(MY_HAND, upTo('thumb-barre', 4), FENDER)
    expect(wide.hand.thumbModes.find((m) => m.name === 'bass-wrap')!.barreLimit).toBe(4)

    const narrow = fitHand(MY_HAND, upTo('thumb-barre', 2), FENDER)
    expect(narrow.hand.thumbModes.find((m) => m.name === 'bass-wrap')!.barreLimit).toBe(2)
    expect(narrow.changes.some((c) => c.note.includes('narrow'))).toBe(true)
  })

  it('fits the thumb window as a range, not a single limit', () => {
    const results = answer({
      'thumb-offset--2': 'impossible',
      'thumb-offset--1': 'comfortable',
      'thumb-offset-0': 'comfortable',
      'thumb-offset-1': 'comfortable',
      'thumb-offset-2': 'awkward',
    })
    const fit = fitHand(MY_HAND, results, FENDER)
    const bass = fit.hand.thumbModes.find((m) => m.name === 'bass-wrap')!
    expect(bass.fretOffset).toEqual([-1, 2])
  })

  it('never mutates the profile it was given', () => {
    const before = JSON.stringify(MY_HAND)
    fitHand(MY_HAND, upTo('middle-barre', 2), FENDER)
    fitHand(MY_HAND, upTo('thumb-barre', 2), FENDER)
    expect(JSON.stringify(MY_HAND)).toBe(before)
  })

  it('works on any profile, not just this one', () => {
    const fit = fitHand(STANDARD_HAND, upTo('middle-barre', 4), FENDER)
    expect(fit.hand.fingers[2].maxBarreStrings).toBe(4)
    expect(fit.hand.name).toBe('Standard')
    // The ring finger is untouched by calibration - it was never in question.
    expect(fit.hand.fingers[3].canFret).toBe(true)
  })

  it('produces a fitted profile that the solver can actually use', () => {
    const results = [
      ...upTo('span-index-pinky', 4.5),
      ...upTo('middle-barre', 3),
      ...upTo('thumb-barre', 3),
    ]
    const fit = fitHand(MY_HAND, results, FENDER)
    expect(fit.hand.fingers[3].canFret).toBe(false)
    expect(fit.hand.thumbModes.length).toBe(MY_HAND.thumbModes.length)
    expect(fit.hand.maxSpanInches).toBeGreaterThan(0)
  })
})
