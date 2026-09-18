/**
 * Fretboard geometry.
 *
 * Pure arithmetic, no React, no SVG - so it can be tested like everything else
 * in this project, and so the drawing code stays about drawing.
 *
 * The fret positions come from `fretFromNut`, the same function the hand model
 * uses to work out how far your fingers have to reach. The picture on screen is
 * therefore in true proportion: the frets crowd together going up the neck
 * exactly as much as they do on the instrument, and the shape that looks like a
 * stretch down at the nut visibly stops looking like one at the ninth fret.
 */

import { fretFromNut, type Instrument, type StringNumber } from '../guitar/instrument.js'

export interface LayoutOptions {
  instrument: Instrument
  /** Inclusive. [0, n] includes the open-string column. */
  fretRange: [number, number]
  width: number
  /** Distance between adjacent strings, in pixels. */
  stringGap?: number
  padding?: Partial<Padding>
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface FretboardLayout {
  width: number
  height: number
  padding: Padding
  fretRange: [number, number]
  /** x of each fret wire, keyed by fret number. */
  wireX: Map<number, number>
  /** x of the middle of each fret space - where a dot sits. */
  dotX: Map<number, number>
  /** y of each string, keyed by string number (1 = high E). */
  stringY: Map<StringNumber, number>
  /** x of the nut, or of the left edge when the view starts up the neck. */
  nutX: number
  /** True when fret 0 is visible and open strings get their own column. */
  hasOpenColumn: boolean
  boardTop: number
  boardBottom: number
}

// The bottom needs room for the fret numbers to clear a dot sitting on the
// lowest string - with a full board every number is otherwise covered.
const DEFAULT_PADDING: Padding = { top: 26, right: 18, bottom: 34, left: 18 }

/** Baseline offset of the fret numbers below the lowest string. */
export const FRET_NUMBER_OFFSET = 26

/** Width given to the open-string column, left of the nut. */
const OPEN_COLUMN = 34

export function layoutFretboard(options: LayoutOptions): FretboardLayout {
  const { instrument, fretRange, width, stringGap = 30 } = options
  const padding = { ...DEFAULT_PADDING, ...options.padding }

  const [low, high] = fretRange
  const hasOpenColumn = low === 0
  const firstWire = hasOpenColumn ? 0 : low - 1

  const stringCount = instrument.tuning.length
  const boardTop = padding.top
  const boardBottom = boardTop + (stringCount - 1) * stringGap
  const height = boardBottom + padding.bottom

  // String 1 on top, string 6 at the bottom - the way tab is written.
  const stringY = new Map<StringNumber, number>()
  for (let s = 1; s <= stringCount; s++) {
    stringY.set((s as StringNumber), boardTop + (s - 1) * stringGap)
  }

  const nutX = padding.left + (hasOpenColumn ? OPEN_COLUMN : 0)
  const boardRight = width - padding.right
  const usable = boardRight - nutX

  // Real distances along the neck, normalised into the space we have.
  const scale = instrument.scaleLength
  const start = fretFromNut(firstWire, scale)
  const end = fretFromNut(high, scale)
  const span = end - start
  const project = (fret: number) =>
    span <= 0 ? nutX : nutX + ((fretFromNut(fret, scale) - start) / span) * usable

  const wireX = new Map<number, number>()
  for (let fret = firstWire; fret <= high; fret++) wireX.set(fret, project(fret))

  const dotX = new Map<number, number>()
  if (hasOpenColumn) dotX.set(0, padding.left + OPEN_COLUMN / 2)
  for (let fret = Math.max(1, low); fret <= high; fret++) {
    const before = wireX.get(fret - 1)!
    const after = wireX.get(fret)!
    dotX.set(fret, (before + after) / 2)
  }

  return {
    width,
    height,
    padding,
    fretRange,
    wireX,
    dotX,
    stringY,
    nutX,
    hasOpenColumn,
    boardTop,
    boardBottom,
  }
}

/** Frets that carry an inlay. Twelve gets two. */
export const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21]
export const DOUBLE_INLAY_FRETS = [12, 24]

/** Which string and fret a click landed on, or null if it missed. */
export function hitTest(
  layout: FretboardLayout,
  x: number,
  y: number,
  stringGap = 30,
): { string: StringNumber; fret: number } | null {
  let nearest: StringNumber | null = null
  let nearestDistance = Infinity
  for (const [string, sy] of layout.stringY) {
    const distance = Math.abs(sy - y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = string
    }
  }
  if (nearest === null || nearestDistance > stringGap * 0.6) return null

  let fret: number | null = null
  let best = Infinity
  for (const [candidate, cx] of layout.dotX) {
    const distance = Math.abs(cx - x)
    if (distance < best) {
      best = distance
      fret = candidate
    }
  }
  if (fret === null) return null

  // Reject clicks well outside the board.
  const [low, high] = layout.fretRange
  if (fret < low || fret > high) return null
  return { string: nearest, fret }
}

/* Chord boxes -------------------------------------------------------------- */

/**
 * The small vertical diagram, for browsing many voicings at once.
 *
 * Note the deliberate difference from the neck view above: chord boxes are
 * EVENLY spaced. Over the four or five frets a box covers, true proportion buys
 * you almost nothing and costs legibility, and every chord book ever printed
 * uses even spacing, so a box that did otherwise would just look wrong.
 *
 * Strings run left to right as 6 through 1 — low E on the left, the way a chord
 * chart has always been drawn.
 */
export interface ChordBoxLayout {
  width: number
  height: number
  /** x of each string, 6 on the left. */
  stringX: Map<StringNumber, number>
  /** y of each fret wire, from the top of the box down. */
  fretY: number[]
  /** y of the middle of each fret space, keyed by absolute fret number. */
  dotY: Map<number, number>
  firstFret: number
  fretCount: number
  /** True when the box starts at the nut and should draw one. */
  showNut: boolean
  top: number
  left: number
  right: number
  bottom: number
}

export interface ChordBoxOptions {
  /** Absolute fret at the top of the box. 1 means the box starts at the nut. */
  firstFret: number
  fretCount?: number
  width?: number
  stringCount?: number
}

export function chordBoxLayout(options: ChordBoxOptions): ChordBoxLayout {
  const { firstFret, fretCount = 5, width = 132, stringCount = 6 } = options

  const left = 26
  const right = width - 14
  const top = 26
  const rowHeight = 22
  const bottom = top + fretCount * rowHeight
  const stringGap = (right - left) / (stringCount - 1)

  const stringX = new Map<StringNumber, number>()
  for (let i = 0; i < stringCount; i++) {
    // i = 0 is string 6, on the left.
    stringX.set(((stringCount - i) as StringNumber), left + i * stringGap)
  }

  const fretY: number[] = []
  for (let i = 0; i <= fretCount; i++) fretY.push(top + i * rowHeight)

  const dotY = new Map<number, number>()
  for (let i = 0; i < fretCount; i++) {
    dotY.set(firstFret + i, top + i * rowHeight + rowHeight / 2)
  }

  return {
    width,
    height: bottom + 16,
    stringX,
    fretY,
    dotY,
    firstFret,
    fretCount,
    showNut: firstFret === 1,
    top,
    left,
    right,
    bottom,
  }
}

/**
 * Where a box should start so a voicing sits inside it.
 *
 * A shape up the neck starts at its own lowest fretted note, which is how every
 * chord book draws one - the shape sits at the top of the box with the position
 * marked beside it. Backing the window off below that just pushes the dots to
 * the bottom of an otherwise empty grid.
 *
 * Open strings never drag the window down to the nut; they are drawn as circles
 * above the box instead.
 */
export function boxStartFor(frets: number[], fretCount = 5): number {
  const fretted = frets.filter((f) => f > 0)
  if (fretted.length === 0) return 1
  const lowest = Math.min(...fretted)
  const highest = Math.max(...fretted)
  // Anything reachable from the nut is drawn from the nut.
  if (highest <= fretCount) return 1
  // Only widen downward if the shape is too tall for the box to hold.
  if (highest - lowest + 1 > fretCount) return Math.max(1, highest - fretCount + 1)
  return lowest
}
