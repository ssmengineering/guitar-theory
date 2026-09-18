import { describe, expect, it } from 'vitest'
import { FENDER, GIBSON } from '../src/guitar/instrument.js'
import {
  boxStartFor,
  chordBoxLayout,
  FRET_NUMBER_OFFSET,
  hitTest,
  layoutFretboard,
} from '../src/ui/layout.js'

const layout = (fretRange: [number, number] = [0, 12], width = 860) =>
  layoutFretboard({ instrument: FENDER, fretRange, width })

describe('fretboard geometry', () => {
  it('draws frets in true proportion, crowding up the neck', () => {
    const l = layout()
    const gapAt = (fret: number) => l.wireX.get(fret)! - l.wireX.get(fret - 1)!

    // The same picture the hand model describes: the 1st fret is wide, the 12th
    // is narrow, and the shape that looks like a stretch at the nut stops
    // looking like one further up.
    expect(gapAt(1)).toBeGreaterThan(gapAt(12))
    expect(gapAt(12) / gapAt(1)).toBeLessThan(0.65)

    for (let fret = 2; fret <= 12; fret++) {
      expect(gapAt(fret)).toBeLessThan(gapAt(fret - 1))
    }
  })

  it('puts a shorter scale through the same proportions', () => {
    const fender = layout()
    const gibson = layoutFretboard({ instrument: GIBSON, fretRange: [0, 12], width: 860 })
    // Both are normalised into the same width, so the RATIO is what matters and
    // it should be near identical - fret spacing is a property of the ratio,
    // not of the scale length.
    const ratio = (l: typeof fender) =>
      (l.wireX.get(12)! - l.wireX.get(11)!) / (l.wireX.get(1)! - l.wireX.get(0)!)
    expect(ratio(gibson)).toBeCloseTo(ratio(fender), 5)
  })

  it('gives open strings their own column left of the nut', () => {
    const l = layout([0, 12])
    expect(l.hasOpenColumn).toBe(true)
    expect(l.dotX.get(0)!).toBeLessThan(l.nutX)
    expect(l.dotX.get(1)!).toBeGreaterThan(l.nutX)
  })

  it('drops the open column when the view starts up the neck', () => {
    const l = layout([5, 12])
    expect(l.hasOpenColumn).toBe(false)
    expect(l.dotX.has(0)).toBe(false)
    expect(l.dotX.has(5)).toBe(true)
  })

  it('sits each dot between its two fret wires', () => {
    const l = layout()
    for (let fret = 1; fret <= 12; fret++) {
      const dot = l.dotX.get(fret)!
      expect(dot).toBeGreaterThan(l.wireX.get(fret - 1)!)
      expect(dot).toBeLessThan(l.wireX.get(fret)!)
    }
  })

  it('puts string 1 on top, the way tab is written', () => {
    const l = layout()
    expect(l.stringY.get(1)!).toBeLessThan(l.stringY.get(6)!)
    for (let s = 2; s <= 6; s++) {
      expect(l.stringY.get(s as 2)!).toBeGreaterThan(l.stringY.get((s - 1) as 1)!)
    }
  })

  it('stays inside the box it was given', () => {
    const l = layout([0, 12], 700)
    for (const x of l.wireX.values()) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(700)
    }
    for (const y of l.stringY.values()) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(l.height)
    }
  })
})

describe('clicking the neck', () => {
  it('finds the string and fret under a point', () => {
    const l = layout()
    const target = { string: 4 as const, fret: 7 }
    const x = l.dotX.get(target.fret)!
    const y = l.stringY.get(target.string)!
    expect(hitTest(l, x, y)).toEqual(target)
  })

  it('round-trips every position on the board', () => {
    const l = layout()
    for (let string = 1; string <= 6; string++) {
      for (let fret = 0; fret <= 12; fret++) {
        const hit = hitTest(l, l.dotX.get(fret)!, l.stringY.get(string as 1)!)
        expect(hit).toEqual({ string, fret })
      }
    }
  })

  it('misses when the click is nowhere near a string', () => {
    const l = layout()
    expect(hitTest(l, l.dotX.get(5)!, l.boardBottom + 60)).toBeNull()
  })
})

describe('chord boxes', () => {
  it('spaces frets evenly, the way every chord book does', () => {
    const box = chordBoxLayout({ firstFret: 1 })
    const gaps = box.fretY.slice(1).map((y, i) => y - box.fretY[i]!)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6)
  })

  it('puts the low E on the left, the way a chord chart is drawn', () => {
    const box = chordBoxLayout({ firstFret: 1 })
    expect(box.stringX.get(6)!).toBeLessThan(box.stringX.get(1)!)
  })

  it('draws a nut only when the box starts at the nut', () => {
    expect(chordBoxLayout({ firstFret: 1 }).showNut).toBe(true)
    expect(chordBoxLayout({ firstFret: 8 }).showNut).toBe(false)
  })

  it('keys dots by absolute fret, so the box can start anywhere', () => {
    const box = chordBoxLayout({ firstFret: 8, fretCount: 5 })
    expect([...box.dotY.keys()]).toEqual([8, 9, 10, 11, 12])
    expect(box.dotY.has(7)).toBe(false)
  })

  it('starts the box at the shape, the way a chord book does', () => {
    // Anything reachable from the nut is drawn from the nut.
    expect(boxStartFor([0, 2, 3, 2])).toBe(1)
    // Otherwise the shape sits at the top of the box, not the bottom.
    expect(boxStartFor([8, 9, 9])).toBe(8)
    expect(boxStartFor([10, 12, 11, 12])).toBe(10)
    expect(boxStartFor([12, 12, 12])).toBe(12)
  })

  it('widens downward only when the shape is too tall for the box', () => {
    // A 6-fret spread cannot start at its lowest note and still fit in 5 rows.
    expect(boxStartFor([7, 12], 5)).toBe(8)
  })

  it('does not let an open string drag the window down to the nut', () => {
    // A shape at the 9th fret with one open string still needs to be drawn
    // up at the 9th fret, not squashed into a box starting at 1.
    expect(boxStartFor([0, 9, 10, 9])).toBeGreaterThan(1)
  })

  it('always produces a window the fretted notes fit inside', () => {
    for (const frets of [[1, 3, 3], [5, 7, 7, 5], [9, 11, 10], [12, 12, 14]]) {
      const start = boxStartFor(frets, 5)
      const box = chordBoxLayout({ firstFret: start, fretCount: 5 })
      for (const fret of frets.filter((f) => f > 0)) {
        expect(box.dotY.has(fret)).toBe(true)
      }
    }
  })
})

describe('fret numbers', () => {
  it('leaves room for a dot sitting on the lowest string', () => {
    const l = layout()
    const dotRadius = 11
    const numberBaseline = l.boardBottom + FRET_NUMBER_OFFSET
    // The number has to clear the bottom of a dot on string 6, or a full board
    // hides every fret number behind one.
    expect(numberBaseline).toBeGreaterThan(l.boardBottom + dotRadius + 4)
    // ...and still sit inside the SVG.
    expect(numberBaseline).toBeLessThanOrEqual(l.height)
  })
})
