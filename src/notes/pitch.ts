/**
 * Note arithmetic. The plumbing under the fretboard.
 *
 * This is the only part of the library not expressed in strings and frets, and
 * that is on purpose: it is the adding machine, not the theory. The theory you
 * learn lives in src/guitar, where intervals are shapes and chords are grips.
 *
 * What matters here is that a note is a LETTER plus an ACCIDENTAL plus an
 * OCTAVE, never a bare fret count. The 6th fret of the A string sounds like one
 * thing but means two: it is the #5 of an A chord and the b6 of a C#m. Same dot
 * on the neck, different job in the chord, different name. Collapsing them into
 * "6 frets up" loses the distinction every chord name downstream depends on.
 *
 * Conversion runs one way only. A spelled note can always tell you which fret
 * to press; a fret can never tell you what the note means, because that answer
 * comes from the chord you are playing.
 */

/** 0..6 = C D E F G A B */
export type Letter = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** -2 = double flat .. +2 = double sharp */
export type Alter = -2 | -1 | 0 | 1 | 2

export interface SpelledNote {
  letter: Letter
  alter: Alter
  /** Scientific pitch notation: middle C is C4. */
  octave: number
}

/** Semitones above C for each natural letter. */
export const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const
export const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

const ACCIDENTAL_NAMES: Record<Alter, string> = {
  [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##',
}
const ACCIDENTAL_GLYPHS: Record<Alter, string> = {
  [-2]: '\u266D\u266D', [-1]: '\u266D', 0: '', 1: '\u266F', 2: '\u266F\u266F',
}

export function note(letter: Letter, alter: Alter = 0, octave = 4): SpelledNote {
  return { letter, alter, octave }
}

/**
 * MIDI number. Middle C (C4) is 60.
 *
 * Note the octave belongs to the LETTER, not the sounding pitch, which is the
 * MusicXML convention: Cb4 is MIDI 59, a semitone below C4, even though it is
 * still spelled in octave 4.
 */
export function toMidi(n: SpelledNote): number {
  return (n.octave + 1) * 12 + LETTER_SEMITONES[n.letter] + n.alter
}

/** 0..11, where 0 is C. Octave and spelling are both discarded. */
export function toPitchClass(n: SpelledNote): number {
  return (((LETTER_SEMITONES[n.letter] + n.alter) % 12) + 12) % 12
}

export interface NameOptions {
  /** Use the real flat/sharp glyphs instead of ASCII 'b' and '#'. */
  glyphs?: boolean
  /** Append the octave number. */
  octave?: boolean
}

export function noteName(n: SpelledNote, opts: NameOptions = {}): string {
  const acc = opts.glyphs ? ACCIDENTAL_GLYPHS[n.alter] : ACCIDENTAL_NAMES[n.alter]
  return LETTER_NAMES[n.letter] + acc + (opts.octave ? String(n.octave) : '')
}

/** Same letter and same accidental. */
export function isSameNote(a: SpelledNote, b: SpelledNote): boolean {
  return a.letter === b.letter && a.alter === b.alter && a.octave === b.octave
}

/** Same sound, possibly different spelling: F# and Gb are enharmonic. */
export function isEnharmonic(a: SpelledNote, b: SpelledNote): boolean {
  return toMidi(a) === toMidi(b)
}

const PARSE_RE = /^([A-Ga-g])(bb|b|##|#|x|)(-?\d+)?$/

/** Parse "Bb4", "F#", "C-1", "Ax3". Octave defaults to 4. */
export function parseNote(text: string): SpelledNote {
  const m = PARSE_RE.exec(text.trim())
  if (!m) throw new Error(`Cannot parse note: ${JSON.stringify(text)}`)
  const [, letterText, accText, octaveText] = m
  const letter = LETTER_NAMES.indexOf(
    letterText!.toUpperCase() as (typeof LETTER_NAMES)[number],
  ) as Letter
  const alter = ({ bb: -2, b: -1, '': 0, '#': 1, '##': 2, x: 2 } as const)[
    accText as 'bb' | 'b' | '' | '#' | '##' | 'x'
  ]
  return { letter, alter, octave: octaveText === undefined ? 4 : Number(octaveText) }
}

/** Shorthand for tests and fixtures: n`Bb3` */
export function n(strings: TemplateStringsArray, ...values: unknown[]): SpelledNote {
  return parseNote(String.raw({ raw: strings }, ...values))
}
