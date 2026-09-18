import { describe, expect, it } from 'vitest'
import { FENDER } from '../src/guitar/instrument.js'
import {
  allStringSets,
  byStringSet,
  byTopDegree,
  generateVoicings,
  spacingOf,
  stringSetKey,
} from '../src/guitar/generate.js'
import { identifyVoicing, voicing } from '../src/guitar/voicing.js'
import { chord, chordName } from '../src/notes/chord.js'
import { parseNote } from '../src/notes/pitch.js'
import { MY_HAND, STANDARD_HAND } from '../src/hands/profiles.js'
import { chordDictionary, explain, findAlternatives } from '../src/hands/dictionary.js'

const Cmaj7 = chord(parseNote('C'), 'maj7')
const G7 = chord(parseNote('G'), '7')
const Am7 = chord(parseNote('A'), 'm7')

describe('string sets', () => {
  it('includes non-adjacent sets, which fingerstyle gets for free', () => {
    const sets = allStringSets(6, 4, 4, 5)
    const keys = sets.map(stringSetKey)
    expect(keys).toContain('4-3-2-1') // contiguous
    expect(keys).toContain('6-4-3-2') // skips string 5
    expect(keys).toContain('5-4-2-1') // skips string 3
  })

  it('respects the spread limit', () => {
    for (const set of allStringSets(6, 3, 4, 4)) {
      expect(set[set.length - 1]! - set[0]! + 1).toBeLessThanOrEqual(4)
    }
  })
})

describe('generating voicings', () => {
  it('produces voicings that really are the chord asked for', () => {
    const all = generateVoicings(FENDER, Cmaj7, { fretRange: [0, 9], maxResults: 120 })
    expect(all.length).toBeGreaterThan(40)

    for (const analysis of all.slice(0, 40)) {
      const [reading] = identifyVoicing(analysis.voicing, 1)
      // Every generated shape must be recognisable as some reading of Cmaj7.
      const name = chordName(reading!.symbol)
      expect(typeof name).toBe('string')
      // And every note in it must be a chord tone, by construction.
      for (const role of analysis.roles) {
        expect(Cmaj7.intervals).toContain(role.interval)
      }
    }
  })

  it('never drops the tone the chord name depends on', () => {
    for (const analysis of generateVoicings(FENDER, Cmaj7, { maxResults: 200 })) {
      const degrees = analysis.roles.map((r) => r.interval.degree)
      expect(degrees).toContain(3) // the 3rd
      expect(degrees).toContain(7) // the major 7th
    }
  })

  it('will drop the 5th, and will drop the root when asked to', () => {
    const all = generateVoicings(FENDER, Cmaj7, { maxResults: 300 })
    expect(all.some((a) => a.omitted.some((x) => x.degree === 5))).toBe(true)
    expect(all.some((a) => a.rootless)).toBe(true)

    const rootedOnly = generateVoicings(FENDER, Cmaj7, {
      allowOmitRoot: false,
      maxResults: 300,
    })
    expect(rootedOnly.every((a) => !a.rootless)).toBe(true)
  })

  it('honours a stretch limit before any hand is considered', () => {
    for (const analysis of generateVoicings(FENDER, G7, { maxFretSpan: 3 })) {
      expect(analysis.voicing.fretSpan).toBeLessThanOrEqual(3)
    }
  })

  it('never sounds the same pitch on two strings', () => {
    for (const analysis of generateVoicings(FENDER, G7, { maxResults: 200 })) {
      const midis = analysis.voicing.notes.map((n) => n.midi)
      expect(new Set(midis).size).toBe(midis.length)
    }
  })
})

describe('the Chord Chemistry index', () => {
  it('finds voicings with a chosen degree in the melody', () => {
    const thirdOnTop = generateVoicings(FENDER, Cmaj7, {
      topDegree: 3,
      maxResults: 100,
    })
    expect(thirdOnTop.length).toBeGreaterThan(5)
    for (const analysis of thirdOnTop) {
      expect(analysis.topInterval.degree).toBe(3)
    }
  })

  it('searches a single string set the way the book is laid out', () => {
    const onFourThreeTwoOne = generateVoicings(FENDER, Am7, {
      stringSets: [[1, 2, 3, 4]],
      fretRange: [0, 12],
    })
    expect(onFourThreeTwoOne.length).toBeGreaterThan(3)
    for (const analysis of onFourThreeTwoOne) {
      expect(stringSetKey(analysis.stringSet)).toBe('4-3-2-1')
    }
  })

  it('groups by string set and by melody note', () => {
    const all = generateVoicings(FENDER, Cmaj7, { fretRange: [0, 9], maxResults: 200 })
    const sets = byStringSet(all)
    const tops = byTopDegree(all)
    expect(sets.size).toBeGreaterThan(3)
    expect([...tops.keys()].sort()).toEqual(expect.arrayContaining(['3', '5', 'R']))
  })
})

describe('the generated dictionary', () => {
  it('returns voicings ranked by what they cost the hand', () => {
    const entries = chordDictionary(FENDER, Cmaj7, MY_HAND, {
      fretRange: [0, 9],
      limit: 15,
    })
    expect(entries.length).toBeGreaterThan(5)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.cost).toBeGreaterThanOrEqual(entries[i - 1]!.cost)
    }
  })

  it('never offers a voicing needing the ring finger', () => {
    for (const entry of chordDictionary(FENDER, G7, MY_HAND, { limit: 40 })) {
      expect(entry.fingering.assignments.some((a) => a.finger === 3)).toBe(false)
    }
  })

  it('gives the two hands different dictionaries for the same chord', () => {
    const options = { fretRange: [0, 9] as [number, number], limit: 30 }
    const mine = chordDictionary(FENDER, Cmaj7, MY_HAND, options)
    const standard = chordDictionary(FENDER, Cmaj7, STANDARD_HAND, options)

    const key = (v: { voicing: { notes: { string: number; fret: number }[] } }) =>
      v.voicing.notes.map((n) => `${n.string}:${n.fret}`).join(',')
    const mineKeys = new Set(mine.map(key))
    const standardKeys = new Set(standard.map(key))

    // Overlapping but not identical - which is the entire argument for
    // generating a dictionary instead of filtering a printed one.
    expect([...mineKeys].some((k) => !standardKeys.has(k))).toBe(true)
  })
})

describe('finding an alternative', () => {
  // A wide Cmaj7 that wants four fingers across four frets.
  const AWKWARD = () => voicing(FENDER, [[5, 3], [4, 5], [3, 4], [2, 5]])

  it('keeps the melody note when asked, because that is the tune', () => {
    const target = AWKWARD()
    const topPc = ((target.topMidi % 12) + 12) % 12

    const alternatives = findAlternatives(FENDER, Cmaj7, target, MY_HAND, {
      keepTopNote: true,
      limit: 10,
    })
    expect(alternatives.length).toBeGreaterThan(0)
    for (const option of alternatives) {
      expect(((option.voicing.topMidi % 12) + 12) % 12).toBe(topPc)
    }
  })

  it('never returns the shape you were already trying to play', () => {
    const target = AWKWARD()
    const signature = target.notes.map((n) => `${n.string}:${n.fret}`).join(',')
    for (const option of findAlternatives(FENDER, Cmaj7, target, MY_HAND, { limit: 20 })) {
      expect(option.voicing.notes.map((n) => `${n.string}:${n.fret}`).join(',')).not.toBe(
        signature,
      )
    }
  })

  it('explains itself in chord theory, which is the point', () => {
    const target = AWKWARD()
    const [best] = findAlternatives(FENDER, Cmaj7, target, MY_HAND, { limit: 5 })
    const reasons = explain(best!, target)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join(' ')).toMatch(/drops|rootless|thumb|barre|open|melody|fret|string/)
  })
})

describe('voicing quality, not just playability', () => {
  it('flags a 3rd voiced low as muddy', () => {
    // E2 and G#2 - a major 3rd right at the bottom of the guitar.
    const muddy = voicing(FENDER, [[6, 0], [5, 0], [4, 0]])
    const clean = voicing(FENDER, [[4, 10], [3, 9], [2, 8]])
    expect(spacingOf(muddy).penalty).toBeGreaterThan(spacingOf(clean).penalty)
    expect(spacingOf(clean).penalty).toBe(0)
  })

  it('does not penalise a wide gap above the bass note', () => {
    // Root way down low with the upper structure well above it is normal.
    const spread = voicing(FENDER, [[6, 8], [3, 9], [2, 8], [1, 8]])
    expect(spacingOf(spread).penalty).toBe(0)
  })

  it('keeps hand cost and musical cost separate', () => {
    const entries = chordDictionary(FENDER, Cmaj7, MY_HAND, { limit: 20 })
    for (const entry of entries) {
      expect(entry.cost).toBeCloseTo(entry.handCost + entry.spacingPenalty, 3)
    }
  })
})

describe('moveable shapes', () => {
  it('excludes open strings so the shape transposes', () => {
    const entries = chordDictionary(FENDER, Cmaj7, MY_HAND, {
      moveableOnly: true,
      limit: 20,
    })
    expect(entries.length).toBeGreaterThan(5)
    for (const entry of entries) {
      expect(entry.moveable).toBe(true)
      expect(entry.voicing.notes.every((n) => n.fret > 0)).toBe(true)
    }
  })

  it('stops open strings from burying every moveable shape', () => {
    const withOpen = chordDictionary(FENDER, Cmaj7, MY_HAND, {
      fretRange: [0, 9],
      limit: 6,
    })
    // Without the filter the cheapest results are all-open shapes costing
    // nothing, which is true and useless - that is what moveableOnly is for.
    expect(withOpen.some((e) => !e.moveable)).toBe(true)

    const moveable = chordDictionary(FENDER, Cmaj7, MY_HAND, {
      fretRange: [0, 9],
      moveableOnly: true,
      limit: 6,
    })
    expect(moveable.every((e) => e.moveable)).toBe(true)
  })

  it('gives this hand a cheaper top shape than a standard one, via the thumb', () => {
    const options = {
      fretRange: [0, 9] as [number, number],
      moveableOnly: true,
      limit: 1,
    }
    const mine = chordDictionary(FENDER, Cmaj7, MY_HAND, options)[0]!
    const standard = chordDictionary(FENDER, Cmaj7, STANDARD_HAND, options)[0]!

    // Thumb-over is everyday technique here and a stretch for most players,
    // so the same C-B-E shell is cheaper for him than for a conventional hand.
    expect(mine.fingering.strategies).toContain('thumb-bass')
    expect(mine.cost).toBeLessThan(standard.cost)
  })
})

describe('explanations stay honest', () => {
  it('does not sell a lower position as an advantage', () => {
    const target = voicing(FENDER, [[5, 10], [4, 12], [3, 11], [2, 12]])
    for (const option of findAlternatives(FENDER, Cmaj7, target, MY_HAND, {
      fretRange: [0, 14],
      limit: 15,
    })) {
      const text = explain(option, target).join(' ')
      expect(text).not.toContain('stretch is wider')
      if (option.voicing.lowestFret < target.lowestFret) {
        expect(text).not.toContain('frets higher')
      }
    }
  })

  it('does not claim a free pinky on a chord that uses no fingers', () => {
    const target = voicing(FENDER, [[5, 3], [4, 5], [3, 4], [2, 5]])
    for (const option of findAlternatives(FENDER, Cmaj7, target, MY_HAND, { limit: 20 })) {
      const usesFingers = option.fingering.assignments.some((a) => a.finger !== 0)
      if (!usesFingers) {
        expect(explain(option, target).join(' ')).not.toContain('pinky')
      }
    }
  })
})

describe('explanations count what they see', () => {
  it('says how many voices a barre actually covers', () => {
    const entries = chordDictionary(FENDER, Cmaj7, MY_HAND, {
      stringSets: [[2, 3, 4, 5]],
      topDegree: 3,
      moveableOnly: true,
      fretRange: [0, 12],
      limit: 10,
    })
    for (const entry of entries) {
      for (const assignment of entry.fingering.assignments) {
        if (!assignment.barreSpan) continue
        const said = explain(entry).find((r) => r.includes('barre'))!
        const word = { 2: 'two', 3: 'three', 4: '4' }[assignment.notes.length]
        if (word) expect(said).toContain(word)
      }
    }
  })
})
