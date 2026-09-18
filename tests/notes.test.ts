import { describe, expect, it } from 'vitest'
import {
  isEnharmonic,
  noteName,
  parseNote,
  toMidi,
  toPitchClass,
} from '../src/notes/pitch.js'
import {
  M3,
  P5,
  degreeLabel,
  intervalBetween,
  intervalName,
  m3,
  s9,
  transpose,
} from '../src/notes/interval.js'
import {
  chord,
  chordName,
  describeCandidate,
  identifyChord,
} from '../src/notes/chord.js'

describe('spelled pitch', () => {
  it('places middle C at MIDI 60', () => {
    expect(toMidi(parseNote('C4'))).toBe(60)
    expect(toMidi(parseNote('A4'))).toBe(69)
  })

  it('keeps the octave with the letter, so Cb4 sounds below C4', () => {
    expect(toMidi(parseNote('Cb4'))).toBe(59)
    expect(toMidi(parseNote('B3'))).toBe(59)
  })

  it('treats enharmonics as the same sound but not the same note', () => {
    const sharp = parseNote('G#3')
    const flat = parseNote('Ab3')
    expect(isEnharmonic(sharp, flat)).toBe(true)
    expect(noteName(sharp)).toBe('G#')
    expect(noteName(flat)).toBe('Ab')
    expect(toPitchClass(sharp)).toBe(toPitchClass(flat))
  })
})

describe('intervals', () => {
  it('separates b3 from #9 even though they sound alike', () => {
    expect(m3.semitones).toBe(3)
    expect(s9.semitones % 12).toBe(3)
    expect(degreeLabel(m3)).toBe('b3')
    expect(degreeLabel(s9)).toBe('#9')
  })

  it('spells transposition by degree first, accidental second', () => {
    expect(noteName(transpose(parseNote('C4'), M3))).toBe('E')
    expect(noteName(transpose(parseNote('C4'), m3))).toBe('Eb')
    // The payoff: C + #9 is D#, not Eb, because the degree is a ninth.
    expect(noteName(transpose(parseNote('C4'), s9))).toBe('D#')
    expect(transpose(parseNote('C4'), s9).octave).toBe(5)
  })

  it('round-trips through intervalBetween', () => {
    const from = parseNote('A3')
    const to = transpose(from, P5)
    expect(noteName(to)).toBe('E')
    const back = intervalBetween(from, to)
    expect(back.degree).toBe(5)
    expect(back.semitones).toBe(7)
  })

  it('names intervals by quality', () => {
    expect(intervalName(M3)).toBe('M3')
    expect(intervalName(m3)).toBe('m3')
    expect(intervalName(P5)).toBe('P5')
    expect(intervalName(s9)).toBe('A9')
  })
})

describe('chords', () => {
  it('names chords from the registry', () => {
    expect(chordName(chord(parseNote('C'), 'maj7'))).toBe('Cmaj7')
    expect(chordName(chord(parseNote('F'), 'm7b5'))).toBe('Fm7b5')
    expect(chordName(chord(parseNote('D'), '7', parseNote('A')))).toBe('D7/A')
  })

  it('identifies a plain triad', () => {
    const [best] = identifyChord([0, 4, 7], { bassPitchClass: 0 })
    expect(chordName(best!.symbol)).toBe('C')
    expect(best!.completeness).toBe('complete')
  })

  it('reads a rootless voicing as the chord it implies', () => {
    // E G B D - no C anywhere, but it is a Cmaj9 upper structure.
    const candidates = identifyChord([4, 7, 11, 2])
    const cmaj9 = candidates.find((c) => chordName(c.symbol) === 'Cmaj9')
    expect(cmaj9).toBeDefined()
    expect(cmaj9!.completeness).toBe('rootless')
    // ...and it is equally Em7 add 11 territory, which is the whole point.
    expect(candidates.length).toBeGreaterThan(1)
  })

  it('treats one grip as several chords - the Chord Chemistry premise', () => {
    // C E G B: Cmaj7, or Em with an added b6, or Am9 without its root.
    const readings = identifyChord([0, 4, 7, 11], { bassPitchClass: 0 })
    expect(chordName(readings[0]!.symbol)).toBe('Cmaj7')
    const names = readings.map((r) => chordName(r.symbol))
    expect(names.length).toBeGreaterThan(1)
  })

  it('prefers a reading with the root in the bass', () => {
    const overC = identifyChord([0, 4, 7, 11], { bassPitchClass: 0 })[0]!
    const overE = identifyChord([0, 4, 7, 11], { bassPitchClass: 4 })[0]!
    expect(chordName(overC.symbol)).toBe('Cmaj7')
    expect(overE.symbol.bass).toBeDefined()
  })

  it('never invents a note that is not sounding', () => {
    for (const candidate of identifyChord([0, 4, 7])) {
      const pcs = new Set(candidate.roles.map((r) => r.pitchClass))
      expect([...pcs].sort()).toEqual([0, 4, 7])
    }
  })

  it('refuses readings that omit the tone the name depends on', () => {
    // C E G is a C. It is not "Cadd9 with no 9" or "C6 with no 6".
    const names = identifyChord([0, 4, 7], { bassPitchClass: 0 }).map((c) =>
      chordName(c.symbol),
    )
    expect(names).toContain('C')
    expect(names).not.toContain('Cadd9')
    expect(names).not.toContain('C6')
    expect(names).not.toContain('C7')
  })

  it('still allows intermediate extensions to be dropped', () => {
    // R 3 b7 13 with no 9th is an everyday 13th voicing on guitar.
    const names = identifyChord([0, 4, 10, 9], { bassPitchClass: 0 }).map((c) =>
      chordName(c.symbol),
    )
    expect(names).toContain('C13')
  })

  it('describes a voicing in degrees, not letters', () => {
    const [best] = identifyChord([0, 4, 10], { bassPitchClass: 0 })
    expect(describeCandidate(best!)).toContain('no 5')
  })
})
