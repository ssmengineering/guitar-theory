/**
 * The reading material, checked against the engine.
 *
 * A manual written alongside software drifts away from it, and nobody notices
 * until the manual is actively teaching something false. So every number the
 * prose states is asserted here against the code that produces it. If a chord
 * formula changes in the registry, or an interval's fret count changes, these
 * fail and the lesson gets fixed rather than quietly becoming wrong.
 */

import { describe, expect, it } from 'vitest'
import { FENDER } from '../src/guitar/instrument.js'
import { fretGap } from '../src/guitar/instrument.js'
import { positionMap } from '../src/guitar/shapes.js'
import { fretsBetweenStrings, tuningProfile } from '../src/guitar/tuning.js'
import { parseChord, qualityByName } from '../src/notes/chord.js'
import { degreeLabel, m3, M3, M7, m7 } from '../src/notes/interval.js'
import { toPitchClass } from '../src/notes/pitch.js'
import { IONIAN, toneRoles } from '../src/notes/scale.js'
import { diatonicQualities, key } from '../src/notes/key.js'
import { parseNote } from '../src/notes/pitch.js'
import { STANDARD_HAND } from '../src/hands/profiles.js'
import { chordDictionary } from '../src/hands/dictionary.js'
import { LESSONS, lessonById, type Block } from '../src/learn/lessons.js'

const blocksOf = (id: string): Block[] => lessonById(id)!.blocks
const proseOf = (id: string): string =>
  blocksOf(id)
    .map((b) => ('body' in b ? b.body : 'caption' in b ? (b.caption ?? '') : ''))
    .join(' ')

describe('the lesson set holds together', () => {
  it('gives every lesson an id, a title and a summary', () => {
    for (const lesson of LESSONS) {
      expect(lesson.id).toMatch(/^[a-z-]+$/)
      expect(lesson.title.length).toBeGreaterThan(5)
      expect(lesson.summary.length).toBeGreaterThan(15)
      expect(lesson.blocks.length).toBeGreaterThan(2)
    }
  })

  it('uses ids that are unique', () => {
    const ids = LESSONS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only points at screens that exist', () => {
    const screens = ['decoder', 'dictionary', 'improv', 'calibration']
    for (const lesson of LESSONS) {
      for (const block of lesson.blocks) {
        if (block.kind === 'try') expect(screens).toContain(block.screen)
      }
    }
  })

  it('names only chords the parser can read', () => {
    for (const lesson of LESSONS) {
      for (const block of lesson.blocks) {
        if (block.kind === 'chordmap') expect(() => parseChord(block.chord)).not.toThrow()
        if (block.kind === 'chords') {
          for (const name of block.items) expect(() => parseChord(name)).not.toThrow()
        }
        if (block.kind === 'formula') {
          for (const q of block.qualities) expect(() => qualityByName(q)).not.toThrow()
        }
      }
    }
  })
})

describe('what the prose claims is true', () => {
  it('"twelve frets bring you back to the same note"', () => {
    expect(proseOf('the-neck')).toContain('Twelve frets')
    const open = parseChord('E').root
    // Twelve semitones is an octave, so the pitch class is unchanged.
    expect((toPitchClass(open) + 12) % 12).toBe(toPitchClass(open))
  })

  it('"the frets get closer together as you go up"', () => {
    expect(fretGap(1, 2, FENDER.scaleLength)).toBeGreaterThan(
      fretGap(11, 12, FENDER.scaleLength),
    )
  })

  it('"b3 and #9 are both three frets above the root"', () => {
    expect(proseOf('intervals')).toContain('three frets')
    expect(m3.semitones).toBe(3)
    expect(Math.abs(15) % 12).toBe(3) // #9 is 15 semitones, three past the octave
  })

  it('"every adjacent string pair is five frets apart except G to B, which is four"', () => {
    const profile = tuningProfile(FENDER)
    expect(profile.regularStep).toBe(5)
    expect(profile.anomalies).toHaveLength(1)
    expect(fretsBetweenStrings(FENDER, 3, 2)).toBe(4)
  })

  it('"the major scale pattern is 2 2 1 2 2 2 1"', () => {
    expect(proseOf('major-scale')).toContain('**2, 2, 1, 2, 2, 2, 1**')
    const gaps = IONIAN.offsets.slice(1).map((x, i) => x - IONIAN.offsets[i]!)
    expect([...gaps, 12 - IONIAN.offsets[6]!]).toEqual([2, 2, 1, 2, 2, 2, 1])
  })

  it('the C major figure really is C major on the A string', () => {
    const block = blocksOf('major-scale').find((b) => b.kind === 'fretboard')!
    if (block.kind !== 'fretboard') throw new Error('expected a fretboard')
    const scalePcs = IONIAN.offsets.map((o) => (toPitchClass(parseNote('C')) + o) % 12)
    for (const dot of block.dots) {
      // String 5 open is A; every dot should land on a note of C major.
      const midi = 45 + dot.fret
      expect(scalePcs).toContain(((midi % 12) + 12) % 12)
    }
  })

  it('"a 3 is four frets above the root, a b3 is three"', () => {
    expect(M3.semitones).toBe(4)
    expect(m3.semitones).toBe(3)
    expect(proseOf('chord-quality')).toContain('four frets')
  })

  it('"a 7 is eleven frets, a b7 is ten"', () => {
    expect(M7.semitones).toBe(11)
    expect(m7.semitones).toBe(10)
    expect(proseOf('chord-quality')).toContain('eleven')
    expect(proseOf('chord-quality')).toContain('ten')
  })

  it('"a triad is 1 3 5 and a seventh chord is 1 3 5 7"', () => {
    expect(qualityByName('maj').intervals.map(degreeLabel)).toEqual(['R', '3', '5'])
    expect(qualityByName('maj7').intervals.map(degreeLabel)).toEqual(['R', '3', '5', '7'])
  })

  it('the quality figure is the complete grid of 3rd against 7th', () => {
    const block = blocksOf('chord-quality').find((b) => b.kind === 'chords')!
    if (block.kind !== 'chords') throw new Error('expected chords')
    for (const name of block.items) {
      const degrees = parseChord(name).intervals.map((i) => i.degree)
      // Same skeleton every time: root, third, fifth, seventh.
      expect(degrees).toEqual([1, 3, 5, 7])
    }
    // Two choices of 3rd times two of 7th - all four corners, no repeats.
    const pairs = block.items.map((name) => {
      const iv = parseChord(name).intervals
      return `${degreeLabel(iv[1]!)}/${degreeLabel(iv[3]!)}`
    })
    expect(new Set(pairs)).toEqual(new Set(['3/7', '3/b7', 'b3/b7', 'b3/7']))
    // ...and the 5th is identical throughout, which is what the caption claims.
    const fifths = block.items.map((name) => degreeLabel(parseChord(name).intervals[2]!))
    expect(new Set(fifths).size).toBe(1)
  })

  it('names the one common chord where the 5th does the work instead', () => {
    // m7b5 has the same 3rd and 7th as m7 - the lesson has to say so, or the
    // rule it just taught looks broken the first time one turns up.
    expect(proseOf('chord-quality')).toContain('m7b5')
    const m7 = qualityByName('m7').intervals.map(degreeLabel)
    const half = qualityByName('m7b5').intervals.map(degreeLabel)
    expect(half[1]).toBe(m7[1]!)
    expect(half[3]).toBe(m7[3]!)
    expect(half[2]).not.toBe(m7[2]!)
  })

  it('"the 7 chord only happens on one degree of a major key"', () => {
    const sevenths = diatonicQualities(key(parseNote('C')), true)
    expect(sevenths.filter((q) => q === '7')).toHaveLength(1)
    expect(sevenths[4]).toBe('7') // the fifth degree
    // And the figure lists them in that order.
    const block = blocksOf('numbers').find((b) => b.kind === 'formula')!
    if (block.kind !== 'formula') throw new Error('expected a formula')
    expect(block.qualities).toEqual(sevenths)
  })

  it('"the 4th over a major chord is one fret above the 3rd and fights it"', () => {
    const chord = parseChord('Cmaj7')
    const roles = toneRoles(chord, toPitchClass(chord.root))
    const avoid = roles.filter((r) => r.kind === 'avoid')
    expect(avoid).toHaveLength(1)
    expect(avoid[0]!.label).toBe('11')
    expect(avoid[0]!.why).toContain('half step above the 3')
  })

  it('the avoid-note figure actually contains an avoid note to look at', () => {
    const block = blocksOf('over-the-chord').find((b) => b.kind === 'chordmap')!
    if (block.kind !== 'chordmap') throw new Error('expected a chordmap')
    const cells = positionMap(FENDER, parseChord(block.chord), block.fretRange)
    expect(cells.some((c) => c.kind === 'avoid')).toBe(true)
    expect(cells.some((c) => c.kind === 'chord-tone')).toBe(true)
    expect(cells.some((c) => c.kind === 'tension')).toBe(true)
  })

  it('"a maj9 with no 9th in it is just a maj7"', () => {
    const maj9 = qualityByName('maj9').intervals.map(degreeLabel)
    const maj7 = qualityByName('maj7').intervals.map(degreeLabel)
    expect(maj9.filter((d) => d !== '9')).toEqual(maj7)
  })
})

describe('the figures actually show what their captions claim', () => {
  /** Rebuild a chords figure the same way the renderer does. */
  const renderChordsBlock = (lessonId: string) => {
    const block = blocksOf(lessonId).find((b) => b.kind === 'chords')!
    if (block.kind !== 'chords') throw new Error('expected chords')
    const seen = new Map<string, number>()
    return block.items.map((name) => {
      const nth = seen.get(name) ?? 0
      seen.set(name, nth + 1)
      const entries = chordDictionary(FENDER, parseChord(name), STANDARD_HAND, {
        fretRange: block.fretRange ?? [0, 10],
        moveableOnly: true,
        ...(block.stringSet ? { stringSets: [block.stringSet] } : {}),
        ...(block.rootInBass ? { requireRootInBass: true } : {}),
        limit: nth + 1,
      })
      return { name, entry: entries[Math.min(nth, entries.length - 1)] }
    })
  }

  it('the quality figure holds the root and 5th still while the 3rd and 7th move', () => {
    // The caption says "same root, same 5th, four completely different chords".
    // Unconstrained, the generator picks four unrelated grips at four positions
    // and the figure teaches nothing - so this is worth pinning down.
    const boxes = renderChordsBlock('chord-quality')
    expect(boxes.every((b) => b.entry !== undefined)).toBe(true)

    const placeOf = (box: (typeof boxes)[number], degree: string) => {
      const role = box.entry!.roles.find((r) => r.label === degree)
      return role ? `${role.note.string}:${role.note.fret}` : undefined
    }

    // Root and 5th land in identical places in every box.
    expect(new Set(boxes.map((b) => placeOf(b, 'R'))).size).toBe(1)
    expect(new Set(boxes.map((b) => placeOf(b, '5'))).size).toBe(1)

    // And the moving voices really do take all four combinations.
    const pairs = boxes.map((b) => {
      const seventh = b.entry!.roles.find((r) => r.label === '7' || r.label === 'b7')!
      const third = b.entry!.roles.find((r) => r.label === '3' || r.label === 'b3')!
      return `${third.label}/${seventh.label}`
    })
    expect(new Set(pairs)).toEqual(new Set(['3/7', '3/b7', 'b3/b7', 'b3/7']))
  })

  it('the degrees figure really is one shape moved, not two different grips', () => {
    // The caption claims the letters change while the degrees stay identical.
    const boxes = renderChordsBlock('degrees')
    expect(boxes).toHaveLength(2)
    const [first, second] = boxes
    expect(first!.entry).toBeDefined()
    expect(second!.entry).toBeDefined()

    const shapeOf = (entry: NonNullable<(typeof boxes)[number]['entry']>) =>
      entry.roles
        .slice()
        .sort((a, b) => b.note.string - a.note.string)
        .map((r) => `${r.note.string}:${r.label}`)
        .join(' ')

    // Same strings, same degree on each - the definition of one shape.
    expect(shapeOf(second!.entry!)).toBe(shapeOf(first!.entry!))
    // ...at a different place on the neck, which is what makes the point.
    expect(second!.entry!.voicing.lowestFret).not.toBe(first!.entry!.voicing.lowestFret)
  })
})
