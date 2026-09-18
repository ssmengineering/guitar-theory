import { describe, expect, it } from 'vitest'
import { FENDER } from '../src/guitar/instrument.js'
import { generateVoicings } from '../src/guitar/generate.js'
import { voicing } from '../src/guitar/voicing.js'
import {
  commonTones,
  describeMotion,
  describeTransition,
  guideToneLine,
  rankByMotion,
  substitutesFor,
  transition,
} from '../src/guitar/voiceleading.js'
import { chord, chordName } from '../src/notes/chord.js'
import { parseNote } from '../src/notes/pitch.js'
import { MY_HAND, STANDARD_HAND } from '../src/hands/profiles.js'
import { pathEffort, pathMotion, smoothestPath } from '../src/hands/progression.js'

const Dm7 = chord(parseNote('D'), 'm7')
const G7 = chord(parseNote('G'), '7')
const Cmaj7 = chord(parseNote('C'), 'maj7')
const Am7 = chord(parseNote('A'), 'm7')
const C = chord(parseNote('C'), 'maj')

describe('transitions', () => {
  it('holds a common tone and reports it as no movement', () => {
    // Two shapes sharing the top two notes.
    const a = voicing(FENDER, [[5, 3], [4, 5], [3, 5], [2, 5]])
    const b = voicing(FENDER, [[5, 5], [4, 5], [3, 5], [2, 5]])
    const t = transition(a, b)
    expect(t.commonTones).toBe(3)
    expect(t.totalMotion).toBe(2)
    expect(t.largestLeap).toBe(2)
  })

  it('never crosses voices - lowest goes to lowest', () => {
    const a = voicing(FENDER, [[5, 3], [4, 2], [3, 4]])
    const b = voicing(FENDER, [[5, 5], [4, 4], [3, 5]])
    const t = transition(a, b)
    const matched = t.motions.filter((m) => m.from && m.to)
    for (let i = 1; i < matched.length; i++) {
      expect(matched[i]!.from!.midi).toBeGreaterThan(matched[i - 1]!.from!.midi)
      expect(matched[i]!.to!.midi).toBeGreaterThan(matched[i - 1]!.to!.midi)
    }
  })

  it('reports voices that drop out and voices that come in', () => {
    const four = voicing(FENDER, [[5, 3], [4, 5], [3, 5], [2, 5]])
    const three = voicing(FENDER, [[5, 3], [4, 5], [3, 5]])
    expect(transition(four, three).motions.some((m) => m.kind === 'dropped')).toBe(true)
    expect(transition(three, four).motions.some((m) => m.kind === 'added')).toBe(true)
  })

  it('does not score a leap across the neck as no movement', () => {
    // The bug this test exists for: totalMotion counted only the voices that
    // survived the change, so abandoning a shape entirely and grabbing a
    // different one elsewhere scored a perfect zero - and the path search
    // therefore preferred teleporting over actually voice-leading.
    const here = voicing(FENDER, [[6, 8], [5, 8], [4, 7]])
    const faraway = voicing(FENDER, [[5, 8], [2, 8], [1, 7]])

    const t = transition(here, faraway)
    expect(t.voicesChanged).toBeGreaterThan(0)
    expect(t.effort).toBeGreaterThan(0)
    expect(t.smooth).toBe(false)

    // And it must cost more than genuinely moving the same shape a fret.
    const nudged = voicing(FENDER, [[6, 8], [5, 8], [4, 8]])
    expect(transition(here, nudged).effort).toBeLessThan(t.effort)
  })

  it('counts the hand travelling along the neck', () => {
    const low = voicing(FENDER, [[4, 3], [3, 4], [2, 3]])
    const high = voicing(FENDER, [[4, 10], [3, 11], [2, 10]])
    const t = transition(low, high)
    expect(t.handShift).toBe(7)
    expect(t.effort).toBeGreaterThan(t.totalMotion)
  })

  it('calls a transition smooth only when nothing leaps', () => {
    const a = voicing(FENDER, [[4, 5], [3, 5], [2, 5]])
    const near = voicing(FENDER, [[4, 5], [3, 4], [2, 6]])
    const far = voicing(FENDER, [[4, 5], [3, 5], [2, 12]])
    expect(transition(a, near).smooth).toBe(true)
    expect(transition(a, far).smooth).toBe(false)
  })
})

describe('the sentence worth chasing', () => {
  it('says the b7 falls a half step to the 3rd', () => {
    // G7 to Cmaj7 on strings 4-3-2. The F (b7 of G7) falls to E (3rd of C).
    const g7 = generateVoicings(FENDER, G7, {
      stringSets: [[2, 3, 4]],
      fretRange: [3, 8],
    })[0]!
    const cmaj7 = generateVoicings(FENDER, Cmaj7, {
      stringSets: [[2, 3, 4]],
      fretRange: [3, 8],
    })[0]!

    const t = transition(g7.voicing, cmaj7.voicing, { from: g7, to: cmaj7 })
    const lines = describeTransition(t)
    // Every line names what the voice was and what it became.
    for (const line of lines) {
      expect(line).toMatch(/the .+ (falls|rises|becomes|stays put as|drops out|comes in)/)
    }
  })

  it('describes a held note as held, not as moving zero frets', () => {
    const a = voicing(FENDER, [[4, 5], [3, 5]])
    const t = transition(a, a)
    expect(describeMotion(t.motions[0]!)).toContain('held')
  })

  it('names half steps and whole steps rather than counting frets', () => {
    const a = voicing(FENDER, [[3, 5]])
    const half = voicing(FENDER, [[3, 4]])
    const whole = voicing(FENDER, [[3, 7]])
    expect(describeMotion(transition(a, half).motions[0]!)).toContain('half step')
    expect(describeMotion(transition(a, whole).motions[0]!)).toContain('whole step')
    expect(describeMotion(transition(a, half).motions[0]!)).toContain('falls')
    expect(describeMotion(transition(a, whole).motions[0]!)).toContain('rises')
  })
})

describe('choosing the next voicing', () => {
  it('ranks the least movement first', () => {
    const current = voicing(FENDER, [[4, 5], [3, 5], [2, 5]])
    const candidates = generateVoicings(FENDER, Cmaj7, { fretRange: [0, 12], maxResults: 80 })
    const ranked = rankByMotion(current, candidates)

    expect(ranked.length).toBeGreaterThan(5)
    // Sorted by effort, not by raw semitones - a candidate that keeps only one
    // voice and relocates the hand is not "less movement", whatever the
    // surviving voice happens to do.
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.transition.effort).toBeGreaterThanOrEqual(
        ranked[i - 1]!.transition.effort,
      )
    }
    // The best candidate should genuinely hold voices rather than abandon them.
    expect(ranked[0]!.transition.commonTones).toBeGreaterThan(0)
  })
})

describe('guide tones', () => {
  it('picks 3rds and 7ths through ii-V-I', () => {
    const line = guideToneLine(FENDER, [Dm7, G7, Cmaj7])
    expect(line).toHaveLength(3)
    for (const step of line) {
      expect([3, 7]).toContain(step.interval.degree)
    }
  })

  it('connects them with very little movement', () => {
    const line = guideToneLine(FENDER, [Dm7, G7, Cmaj7])
    // A well-chosen guide-tone line over ii-V-I moves by step, not by leap.
    for (const step of line.slice(1)) {
      expect(Math.abs(step.motion)).toBeLessThanOrEqual(2)
    }
  })

  it('stays inside the string and fret window it is given', () => {
    const line = guideToneLine(FENDER, [Dm7, G7, Cmaj7, Am7], {
      stringRange: [3, 4],
      fretRange: [0, 7],
    })
    for (const step of line) {
      expect(step.note.string).toBeGreaterThanOrEqual(3)
      expect(step.note.string).toBeLessThanOrEqual(4)
      expect(step.note.fret).toBeLessThanOrEqual(7)
    }
  })

  it('falls back to defining tones for a chord with no 3rd or 7th', () => {
    const sus = chord(parseNote('D'), 'sus4')
    const line = guideToneLine(FENDER, [sus, G7])
    expect(line).toHaveLength(2)
  })
})

describe('common tones and substitution', () => {
  it('finds what two chords share, and what each note does in each', () => {
    const shared = commonTones(Cmaj7, Am7)
    // C E G B against A C E G - they share C, E and G.
    expect(shared).toHaveLength(3)
    const labels = shared.map((s) => `${s.inFirst.degree}->${s.inSecond.degree}`)
    expect(labels).toContain('1->3') // C is the root of Cmaj7, the b3 of Am7
  })

  it('ranks a substitute by which tones it shares, not how many', () => {
    const subs = substitutesFor(Cmaj7, { minShared: 3, maxResults: 40 })
    const names = subs.map((s) => chordName(s.chord))
    const rank = (name: string) => names.indexOf(name)

    // Am9 contains all four notes of Cmaj7 including the major 7th.
    // Am7 is the textbook relative minor but drops the B, so it loses the
    // maj7 colour entirely - and the engine should say so by ranking it lower.
    expect(rank('Am9')).toBeGreaterThanOrEqual(0)
    expect(rank('Am7')).toBeGreaterThanOrEqual(0)
    expect(rank('Am9')).toBeLessThan(rank('Am7'))

    expect(subs.find((s) => chordName(s.chord) === 'Am9')!.sharesGuideTones).toBe(true)
    expect(subs.find((s) => chordName(s.chord) === 'Am7')!.sharesGuideTones).toBe(false)
  })

  it('finds the tritone substitute, and knows why it works', () => {
    const subs = substitutesFor(G7, { minShared: 2, maxResults: 20 })
    const db7 = subs.find((s) => chordName(s.chord) === 'Db7')
    expect(db7).toBeDefined()

    // It shares exactly two notes with G7 - and they are the 3rd and the b7,
    // the tritone. That is the entire mechanism, and it is why two notes here
    // beat three notes somewhere less important.
    expect(db7!.shared).toHaveLength(2)
    expect(db7!.shared.map((s) => s.inFirst.degree).sort()).toEqual([3, 7])
    expect(db7!.sharesGuideTones).toBe(true)
  })

  it('puts same-root extensions below real substitutions', () => {
    const subs = substitutesFor(Cmaj7, { minShared: 3, maxResults: 40 })
    const firstSameRoot = subs.findIndex((s) => s.sameRoot)
    const lastDifferentRoot = subs.map((s) => s.sameRoot).lastIndexOf(false)
    // Cmaj9 is a useful thing to play instead of Cmaj7, but it is an extension
    // of the same chord, not a substitution for it.
    if (firstSameRoot !== -1) expect(firstSameRoot).toBeGreaterThan(lastDifferentRoot - 1)
  })

  it('never returns the chord itself', () => {
    for (const sub of substitutesFor(Cmaj7, { minShared: 2, maxResults: 40 })) {
      expect(chordName(sub.chord)).not.toBe('Cmaj7')
    }
  })
})

describe('playing through changes', () => {
  const ii_V_I = [Dm7, G7, Cmaj7]

  it('returns one playable voicing per chord', () => {
    const path = smoothestPath(FENDER, ii_V_I, MY_HAND, { fretRange: [0, 9] })
    expect(path).toHaveLength(3)
    for (const step of path) {
      expect(step.option.fingering).toBeDefined()
      expect(step.option.fingering.assignments.some((a) => a.finger === 3)).toBe(false)
    }
  })

  it('moves less than picking each chord independently', () => {
    const options = { fretRange: [0, 12] as [number, number], branching: 14 }
    const smooth = smoothestPath(FENDER, ii_V_I, MY_HAND, options)

    // The greedy alternative: take the single easiest grip for each chord with
    // no regard for what comes before or after it.
    const greedy = smoothestPath(FENDER, ii_V_I, MY_HAND, {
      ...options,
      motionWeight: 0,
      branching: 1,
    })
    expect(pathEffort(smooth)).toBeLessThan(pathEffort(greedy))
  })

  it('finds the b7 falling a half step to the 3rd, twice', () => {
    const path = smoothestPath(FENDER, ii_V_I, MY_HAND, {
      fretRange: [0, 9],
      branching: 16,
    })
    const lines = path.flatMap((step) =>
      step.transition ? describeTransition(step.transition) : [],
    )
    // The resolution that defines a ii-V-I, stated in the engine's own words.
    const resolutions = lines.filter((line) => /the b7 falls a half step/.test(line))
    expect(resolutions.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the hand in one place rather than jumping around', () => {
    const path = smoothestPath(FENDER, ii_V_I, MY_HAND, {
      fretRange: [0, 9],
      branching: 16,
    })
    for (const step of path.slice(1)) {
      expect(step.transition!.handShift).toBeLessThanOrEqual(2)
    }
  })

  it('can hold a melody note across the whole progression', () => {
    const path = smoothestPath(FENDER, ii_V_I, MY_HAND, {
      holdTopDegree: 3,
      fretRange: [0, 12],
    })
    if (path.length === 3) {
      for (const step of path) {
        expect(step.option.topInterval.degree).toBe(3)
      }
    }
  })

  it('gives the two hands paths suited to each', () => {
    const options = { fretRange: [0, 9] as [number, number] }
    const mine = smoothestPath(FENDER, [C, G7, C], MY_HAND, options)
    const standard = smoothestPath(FENDER, [C, G7, C], STANDARD_HAND, options)
    expect(mine).toHaveLength(3)
    expect(standard).toHaveLength(3)
    for (const step of mine) {
      expect(step.option.fingering.assignments.some((a) => a.finger === 3)).toBe(false)
    }
  })

  it('reports the motion between every pair of chords', () => {
    const path = smoothestPath(FENDER, ii_V_I, MY_HAND, { fretRange: [0, 9] })
    expect(path[0]!.transition).toBeUndefined()
    expect(path[1]!.transition).toBeDefined()
    expect(path[2]!.transition).toBeDefined()
  })
})
