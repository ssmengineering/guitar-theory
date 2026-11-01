/**
 * The engine against real charts: the chord names written over the handwritten
 * tabs of Shadow Waltz and Dark Eyes, and the readings a player would expect.
 */

import { describe, expect, it } from 'vitest'
import { chordName, enharmonicAliases, parseChord } from '../src/notes/chord.js'
import { key } from '../src/notes/key.js'
import { parseNote } from '../src/notes/pitch.js'
import { analyze, findCadences, parseChart } from '../src/notes/progression.js'

const C = key(parseNote('C'))
const D = key(parseNote('D'))
const Em = key(parseNote('E'), 'minor')
const Am = key(parseNote('A'), 'minor')

describe('spellings from handwritten charts', () => {
  it('reads plus and minus alterations, brackets, and the old shorthands', () => {
    const reads = (text: string, name: string) => expect(chordName(parseChord(text))).toBe(name)
    reads('A9#5', 'A9#5')
    reads('A95+', 'A9#5')
    reads('A9+5', 'A9#5')
    reads('A9(#5)', 'A9#5')
    reads('F#11', 'F#11')
    reads('C7(b9)', 'C7b9')
    reads('Am7-5', 'Am7b5')
    reads('E7+', 'E7#5')
    reads('E+7', 'E7#5')
    reads('C2', 'Cadd9')
    reads('Dmadd9', 'Dmadd9')
    reads('G69', 'G6/9')
    reads('CM9', 'Cmaj9')
    reads('Em(maj7)', 'EmMaj7')
    reads('C7alt', 'C7alt')
    reads('G9sus4', 'G9sus4')
    reads('Bb7b5', 'Bb7b5')
  })

  it('still refuses nonsense', () => {
    expect(() => parseChord('Cxyz')).toThrow()
  })
})

describe('other names for the same notes', () => {
  it('knows C6 is Am7 and Abm7b5 is Bm6', () => {
    expect(enharmonicAliases(parseChord('C6')).map(chordName)).toEqual(['Am7'])
    expect(enharmonicAliases(parseChord('Abm7b5')).map(chordName)).toEqual(['Bm6'])
    expect(enharmonicAliases(parseChord('Bdim7')).map(chordName)).toEqual(['Ddim7', 'Fdim7', 'Abdim7'])
    expect(enharmonicAliases(parseChord('C'))).toEqual([])
  })
})

describe('Shadow Waltz, as the tab writes it, in D', () => {
  const chart =
    '| D | A9#5 | G | A7 | Em | C7 | B7 | Em | A7 | D | G7 | A7 | D | D7 | G6 | Gm | D6/9 | A#dim | A9 | Abm7b5 | G6 | Dadd9 | F#11 |'
  const items = analyze(parseChart(D, chart, 3))
  const at = (name: string) => items.find((i) => chordName(i.symbol) === name)!

  it('reads the colour chords as in the key', () => {
    expect(at('G6').role).toBe('diatonic')
    expect(at('G6').explanation).toContain('6th added')
    expect(at('D6/9').role).toBe('diatonic')
    expect(at('D6/9').explanation).toContain('6th and the 9th')
    expect(at('Dadd9').role).toBe('diatonic')
    expect(at('Dadd9').explanation).toContain('9th added')
    expect(at('A9').role).toBe('diatonic')
    expect(at('A9').roman).toBe('V9')
    expect(at('A9').explanation).toContain('9th on top')
  })

  it('keeps an altered dominant a dominant', () => {
    const a = at('A9#5')
    expect(a.role).toBe('borrowed')
    expect(a.explanation).toContain('still the dominant')
    expect(a.explanation).toContain('D minor')
  })

  it('hears the bass walk down through Abm7b5, and names it as Bm6', () => {
    const p = at('Abm7b5')
    expect(p.role).toBe('passing')
    expect(p.explanation).toContain('A to Ab to G')
    expect(p.explanation).toContain('Bm6')
  })

  it('says where a dominant goes, and whether the chart went there', () => {
    expect(at('D7').role).toBe('secondary-dominant')
    expect(at('D7').explanation).toContain('goes there next')
    expect(at('C7').role).toBe('tritone-sub')
    expect(at('C7').explanation).toContain('goes there next')
    expect(at('F#11').role).toBe('secondary-dominant')
    expect(at('F#11').targets).toBe(6)
  })

  it('calls the IV7 the blues colour it is', () => {
    expect(at('G7').role).toBe('borrowed')
    expect(at('G7').explanation).toContain('blues')
    expect(at('G7').explanation).toContain('F')
  })

  it('sees a chord leaning into the next one from a half step above', () => {
    expect(at('A#dim').role).toBe('chromatic')
    expect(at('A#dim').explanation).toContain('A9')
    expect(at('A#dim').explanation).toContain('half step above')
  })
})

describe('Dark Eyes, in E minor', () => {
  const items = analyze(parseChart(Em, '| Em | B7 | Em | Am | C7 B7 | Em |'))

  it('treats the V7 of a minor key as its dominant, not a borrowing', () => {
    const b7 = items[1]!
    expect(b7.role).toBe('diatonic')
    expect(b7.explanation).toContain('raised')
    expect(b7.explanation).toContain('D#')
  })

  it('reads C7 to B7 as the tritone substitute landing', () => {
    const c7 = items[4]!
    expect(c7.role).toBe('tritone-sub')
    expect(c7.targets).toBe(5)
    expect(c7.explanation).toContain('goes there next')
  })
})

describe('passing chords and sidesteps', () => {
  it('finds the passing diminished walking up', () => {
    const items = analyze(parseChart(C, '| C | C#dim7 | Dm7 | G7 |'))
    expect(items[1]!.role).toBe('passing')
    expect(items[1]!.explanation).toContain('walks up')
    expect(items[1]!.explanation).not.toContain('same notes')
  })

  it('notices when a secondary dominant is sidestepped', () => {
    const items = analyze(parseChart(C, '| C | A7 | F | G7 |'))
    expect(items[1]!.explanation).toContain('instead')
  })

  it('treats E7 in A minor as home ground', () => {
    const items = analyze(parseChart(Am, '| Am | E7 | Am |'))
    expect(items[1]!.role).toBe('diatonic')
  })

  it('still calls a plain foreign chord chromatic, and gives its other name', () => {
    const items = analyze(parseChart(C, '| C | F#m7 | C |'))
    expect(items[1]!.role).toBe('chromatic')
    expect(items[1]!.explanation).toContain('A6')
  })

  it('reads a suspended chord as the key chord with its 3rd held', () => {
    const items = analyze(parseChart(D, '| Dsus4 | D |'))
    expect(items[0]!.role).toBe('diatonic')
    expect(items[0]!.explanation).toContain('held up to the 4th')
  })
})

describe('slash chords and bass lines', () => {
  it('names the inversion under a slash chord', () => {
    const items = analyze(parseChart(D, '| D | D/F# | G | G/B |'))
    expect(items[1]!.role).toBe('diatonic')
    expect(items[1]!.explanation).toContain('3rd in the bass')
    expect(items[1]!.explanation).toContain('first inversion')
  })

  it('says when the bass note is not in the chord', () => {
    const items = analyze(parseChart(D, '| D | Em/D |'))
    expect(items[1]!.explanation).toContain('not in the chord')
  })

  it('hears a bass line walking down through inversions', () => {
    const items = analyze(parseChart(D, '| D | D/C# | Bm | D/A | G | D/F# | Em | A7 |'))
    expect(items[0]!.explanation).toContain('walking down')
    expect(items[0]!.explanation).toContain('D, C#, B, A, G, F#, E')
    expect(items[6]!.explanation).toContain('walking down')
    expect(items[7]!.explanation).not.toContain('walking')
  })
})

describe('more cadences', () => {
  it('finds the turnaround, plain and ragtime', () => {
    const plain = findCadences(analyze(parseChart(C, '| C | Am | Dm7 | G7 |')))
    expect(plain[0]!.kind).toBe('turnaround')
    expect(plain[0]!.explanation).toContain('I-vi-ii-V')
    const ragtime = findCadences(analyze(parseChart(C, '| C | A7 | D7 | G7 |')))
    expect(ragtime[0]!.kind).toBe('turnaround')
    expect(ragtime[0]!.explanation).toContain('ragtime')
  })

  it('finds the backdoor, the minor plagal, and a half cadence', () => {
    const cadences = findCadences(analyze(parseChart(C, '| Bb7 | C | Fm | C | G7 |')))
    expect(cadences.map((c) => c.kind)).toEqual(['backdoor', 'minor-plagal', 'half'])
  })
})
