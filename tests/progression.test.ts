import { describe, expect, it } from 'vitest'
import { chord, chordName, parseChord } from '../src/notes/chord.js'
import { noteName, parseNote } from '../src/notes/pitch.js'
import {
  degreeOf,
  degreeRoot,
  diatonicQualities,
  key,
  keyNotes,
} from '../src/notes/key.js'
import {
  analyze,
  findCadences,
  nashville,
  parseChart,
  parseNashvilleChart,
  renderChart,
  romanNumeral,
  transposeTo,
} from '../src/notes/progression.js'

const C = key(parseNote('C'))
const Eb = key(parseNote('Eb'))
const Am = key(parseNote('A'), 'minor')

describe('parsing written chords', () => {
  it('reads the usual spellings', () => {
    expect(chordName(parseChord('Cmaj7'))).toBe('Cmaj7')
    expect(chordName(parseChord('F#m7b5'))).toBe('F#m7b5')
    expect(chordName(parseChord('Bb13'))).toBe('Bb13')
    expect(chordName(parseChord('G'))).toBe('G')
    expect(chordName(parseChord('Am'))).toBe('Am')
  })

  it('accepts the shorthands people actually write', () => {
    expect(chordName(parseChord('C-7'))).toBe('Cm7')
    expect(chordName(parseChord('CM7'))).toBe('Cmaj7')
    expect(chordName(parseChord('Co7'))).toBe('Cdim7')
    expect(chordName(parseChord('C+'))).toBe('Caug')
  })

  it('tells a slash bass from a slash quality', () => {
    const overG = parseChord('D7/A')
    expect(overG.bass).toBeDefined()
    expect(noteName(overG.bass!)).toBe('A')

    // The slash in 6/9 is part of the chord's name, not a bass note.
    const sixNine = parseChord('C6/9')
    expect(sixNine.bass).toBeUndefined()
    expect(sixNine.quality).toBe('6/9')
  })

  it('refuses nonsense rather than guessing', () => {
    expect(() => parseChord('Hmaj7')).toThrow()
    expect(() => parseChord('Cwobble')).toThrow()
  })
})

describe('keys and degrees', () => {
  it('spells the scale the way the key spells it', () => {
    expect(keyNotes(C).map((n) => noteName(n))).toEqual([
      'C', 'D', 'E', 'F', 'G', 'A', 'B',
    ])
    expect(keyNotes(Eb).map((n) => noteName(n))).toEqual([
      'Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D',
    ])
  })

  it('numbers by letter, so Bb is the flat seven and A# is the sharp six', () => {
    expect(degreeOf(C, parseNote('Bb'))).toEqual({ degree: 7, alteration: -1 })
    expect(degreeOf(C, parseNote('A#'))).toEqual({ degree: 6, alteration: 1 })
  })

  it('round-trips a degree back to its root', () => {
    for (let degree = 1; degree <= 7; degree++) {
      for (const alteration of [-1, 0, 1]) {
        const root = degreeRoot(Eb, degree, alteration)
        expect(degreeOf(Eb, root)).toEqual({ degree, alteration })
      }
    }
  })

  it('derives diatonic qualities rather than listing them', () => {
    expect(diatonicQualities(C, false)).toEqual([
      'maj', 'min', 'min', 'maj', 'maj', 'min', 'dim',
    ])
    expect(diatonicQualities(C, true)).toEqual([
      'maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5',
    ])
  })

  it('stays right in a mode without a second table', () => {
    const G = key(parseNote('G'), 'mixolydian')
    // Mixolydian has a flat seven, so the tonic seventh chord is dominant.
    expect(diatonicQualities(G, true)[0]).toBe('7')
  })
})

describe('numbers', () => {
  it('writes Nashville numbers the way a chart does', () => {
    expect(nashville(parseChord('C'), C)).toBe('1')
    expect(nashville(parseChord('Am'), C)).toBe('6m')
    expect(nashville(parseChord('Dm7'), C)).toBe('2m7')
    expect(nashville(parseChord('Fmaj7'), C)).toBe('4maj7')
    expect(nashville(parseChord('Bb'), C)).toBe('b7')
  })

  it('brackets a quality that starts with a digit', () => {
    // "57" would read as a number rather than the five chord with a seventh.
    expect(nashville(parseChord('G7'), C)).toBe('5(7)')
    expect(nashville(parseChord('C6'), C)).toBe('1(6)')
  })

  it('writes Roman numerals with case carrying the quality', () => {
    expect(romanNumeral(parseChord('C'), C)).toBe('I')
    expect(romanNumeral(parseChord('Dm7'), C)).toBe('ii7')
    expect(romanNumeral(parseChord('G7'), C)).toBe('V7')
    expect(romanNumeral(parseChord('Bm7b5'), C)).toBe('viiø7')
    expect(romanNumeral(parseChord('Bb'), C)).toBe('bVII')
  })
})

describe('analysis', () => {
  it('calls the diatonic chords diatonic', () => {
    const p = parseChart(C, '| Cmaj7 | Dm7 | G7 | Am7 |')
    for (const item of analyze(p)) {
      expect(item.role).toBe('diatonic')
    }
  })

  it('spots a secondary dominant and says what it points at', () => {
    const p = parseChart(C, '| Cmaj7 | A7 | Dm7 | G7 |')
    const a7 = analyze(p)[1]!
    expect(a7.role).toBe('secondary-dominant')
    expect(a7.targets).toBe(2)
    // Cased by what it is aimed at: Dm is minor, so "V of ii".
    expect(a7.explanation).toContain('V of ii')
    expect(a7.roman).toBe('VI7')
  })

  it('spots the tritone substitute', () => {
    const p = parseChart(C, '| Dm7 | Db7 | Cmaj7 |')
    const sub = analyze(p)[1]!
    expect(sub.role).toBe('tritone-sub')
    expect(sub.targets).toBe(1)
    expect(sub.explanation).toContain('tritone substitute')
  })

  it('spots a borrowed chord and names where it came from', () => {
    const p = parseChart(C, '| C | Bb | F | C |')
    const bb = analyze(p)[1]!
    expect(bb.role).toBe('borrowed')
    expect(bb.nashville).toBe('b7')
    expect(bb.explanation).toContain('flat seven')
  })

  it('calls the minor four what it is', () => {
    const p = parseChart(C, '| C | Fm | C |')
    const fm = analyze(p)[1]!
    expect(fm.role).toBe('borrowed')
    expect(fm.roman).toBe('iv')
  })

  it('admits when something is just chromatic', () => {
    const p = parseChart(C, '| C | F#m7 | C |')
    expect(analyze(p)[1]!.role).toBe('chromatic')
  })
})

describe('cadences', () => {
  it('finds ii-V-I', () => {
    const cadences = findCadences(analyze(parseChart(C, '| Dm7 | G7 | Cmaj7 |')))
    expect(cadences).toHaveLength(1)
    expect(cadences[0]!.kind).toBe('ii-V-I')
    expect(cadences[0]!.at).toEqual([0, 1, 2])
  })

  it('finds a ii-V that does not resolve', () => {
    const cadences = findCadences(analyze(parseChart(C, '| Dm7 | G7 | Eb7 |')))
    expect(cadences[0]!.kind).toBe('ii-V')
  })

  it('finds the deceptive cadence', () => {
    const cadences = findCadences(analyze(parseChart(C, '| G7 | Am7 |')))
    expect(cadences[0]!.kind).toBe('deceptive')
  })

  it('finds the plagal cadence', () => {
    const cadences = findCadences(analyze(parseChart(C, '| F | C |')))
    expect(cadences[0]!.kind).toBe('IV-I')
  })
})

describe('transposition', () => {
  it('moves a progression and keeps the spelling the new key would use', () => {
    const inC = parseChart(C, '| Cmaj7 | Am7 | Dm7 | G7 |')
    const inEb = transposeTo(inC, Eb)
    expect(renderChart(inEb, 'letters')).toBe('| Ebmaj7 | Cm7 | Fm7 | Bb7 |')
  })

  it('leaves the numbers unchanged, which is the point', () => {
    const inC = parseChart(C, '| Cmaj7 | A7 | Dm7 | G7 |')
    const inEb = transposeTo(inC, Eb)
    expect(renderChart(inEb, 'nashville')).toBe(renderChart(inC, 'nashville'))
  })

  it('keeps the analysis identical in any key', () => {
    const inC = parseChart(C, '| Cmaj7 | A7 | Dm7 | Db7 |')
    const roles = (p: typeof inC) => analyze(p).map((x) => x.role)
    expect(roles(transposeTo(inC, Eb))).toEqual(roles(inC))
    expect(roles(transposeTo(inC, key(parseNote('F#'))))).toEqual(roles(inC))
  })

  it('handles a minor key', () => {
    const inAm = parseChart(Am, '| Am | Dm | E7 | Am |')
    expect(analyze(inAm)[0]!.nashville).toBe('1m')
    expect(analyze(inAm)[0]!.roman).toBe('i')
  })
})

describe('charts in numbers', () => {
  it('reads a number chart and puts it in a key', () => {
    const p = parseNashvilleChart(C, '| 1maj7 | 6m7 | 2m7 | 5(7) |')
    expect(renderChart(p, 'letters')).toBe('| Cmaj7 | Am7 | Dm7 | G7 |')
  })

  it('round-trips letters to numbers and back', () => {
    const original = parseChart(C, '| Cmaj7 | Am7 | Dm7 | G7 |')
    const numbers = renderChart(original, 'nashville')
    const rebuilt = parseNashvilleChart(C, numbers)
    expect(renderChart(rebuilt, 'letters')).toBe(renderChart(original, 'letters'))
  })

  it('puts the same number chart in a different key', () => {
    const numbers = '| 1maj7 | 6m7 | 2m7 | 5(7) |'
    expect(renderChart(parseNashvilleChart(Eb, numbers), 'letters')).toBe(
      '| Ebmaj7 | Cm7 | Fm7 | Bb7 |',
    )
  })

  it('splits a bar evenly between the chords in it', () => {
    const p = parseChart(C, '| Cmaj7 | Dm7 G7 |')
    expect(p.bars[0]!.chords[0]!.beats).toBe(4)
    expect(p.bars[1]!.chords[0]!.beats).toBe(2)
    expect(p.bars[1]!.chords[1]!.beats).toBe(2)
  })

  it('prints letters and numbers together, which is the useful view', () => {
    const p = parseChart(C, '| Cmaj7 | G7 |')
    expect(renderChart(p, 'both')).toBe('| Cmaj7 (1maj7) | G7 (5(7)) |')
  })
})
