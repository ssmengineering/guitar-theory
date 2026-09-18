import { describe, expect, it } from 'vitest'
import { FENDER } from '../src/guitar/instrument.js'
import { positionMap } from '../src/guitar/shapes.js'
import { parseChord } from '../src/notes/chord.js'
import { toPitchClass } from '../src/notes/pitch.js'
import { toneRoles } from '../src/notes/scale.js'

const rolesFor = (name: string) => {
  const chord = parseChord(name)
  return toneRoles(chord, toPitchClass(chord.root))
}

const find = (name: string, label: string) =>
  rolesFor(name).find((r) => r.label === label)

describe('what each note is doing over a chord', () => {
  it('calls the chord tones chord tones', () => {
    const roles = rolesFor('Cmaj7')
    for (const label of ['R', '3', '5', '7']) {
      expect(find('Cmaj7', label)!.kind).toBe('chord-tone')
    }
    expect(roles.filter((r) => r.kind === 'chord-tone')).toHaveLength(4)
  })

  it('flags the 4th over a major 7th as an avoid note', () => {
    // F sits a half step above E, the 3rd. It leans on it.
    const fourth = find('Cmaj7', '11')!
    expect(fourth.kind).toBe('avoid')
    expect(fourth.why).toContain('half step above the 3')
  })

  it('does not flag the same note over the minor chord a third below', () => {
    // The 11th of Am7 is D, and nothing in Am7 sits a semitone below it.
    const eleventh = find('Am7', '11')!
    expect(eleventh.kind).toBe('tension')
  })

  it('flags the 4th over a dominant, where it leans on the 3rd', () => {
    expect(find('G7', '11')!.kind).toBe('avoid')
  })

  it('leaves a sus chord with no avoid note, because nothing clashes', () => {
    const roles = rolesFor('G7sus4')
    expect(roles.some((r) => r.kind === 'avoid')).toBe(false)
  })

  it('reads extensions as 9, 11 and 13 once the chord has a 7th', () => {
    const labels = rolesFor('Cmaj7').map((r) => r.label)
    expect(labels).toContain('9')
    expect(labels).toContain('11')
    expect(labels).toContain('13')
    expect(labels).not.toContain('2')
  })

  it('reads them as 2, 4 and 6 on a plain triad', () => {
    const labels = rolesFor('C').map((r) => r.label)
    expect(labels).toContain('2')
    expect(labels).toContain('4')
    expect(labels).not.toContain('9')
  })

  it('explains every note, not just the awkward ones', () => {
    for (const role of rolesFor('Dm7')) {
      expect(role.why.length).toBeGreaterThan(15)
    }
  })

  it('covers the whole scale and nothing outside it', () => {
    const roles = rolesFor('G7')
    expect(roles).toHaveLength(7) // mixolydian
    expect(new Set(roles.map((r) => r.pitchClass)).size).toBe(7)
  })
})

describe('the position map', () => {
  it('fills a fret window with sorted, labelled notes', () => {
    const cells = positionMap(FENDER, parseChord('Cmaj7'), [5, 9])
    expect(cells.length).toBeGreaterThan(15)
    for (const cell of cells) {
      expect(cell.fret).toBeGreaterThanOrEqual(5)
      expect(cell.fret).toBeLessThanOrEqual(9)
      expect(['chord-tone', 'tension', 'avoid']).toContain(cell.kind)
    }
  })

  it('agrees with the tone roles it is built from', () => {
    const chord = parseChord('G7')
    const roles = new Map(
      toneRoles(chord, toPitchClass(chord.root)).map((r) => [r.pitchClass, r.kind]),
    )
    for (const cell of positionMap(FENDER, chord, [0, 12])) {
      expect(cell.kind).toBe(roles.get(((cell.midi % 12) + 12) % 12))
    }
  })

  it('recolours the same window when the chord changes under it', () => {
    // The whole point of watching it: hand stays put, meanings move.
    const window: [number, number] = [5, 9]
    const overDm7 = positionMap(FENDER, parseChord('Dm7'), window)
    const overG7 = positionMap(FENDER, parseChord('G7'), window)

    const at = (cells: typeof overDm7, string: number, fret: number) =>
      cells.find((c) => c.string === string && c.fret === fret)

    // String 4, fret 7 is A. It is the 5th of Dm7 and the 9th of G7.
    expect(at(overDm7, 4, 7)!.label).toBe('5')
    expect(at(overG7, 4, 7)!.label).toBe('9')
  })

  it('leaves notes outside the scale off the board entirely', () => {
    const chord = parseChord('Cmaj7')
    const cells = positionMap(FENDER, chord, [0, 12])
    // C# is in no reading of C major, so it should simply not appear.
    expect(cells.some((c) => ((c.midi % 12) + 12) % 12 === 1)).toBe(false)
  })
})
