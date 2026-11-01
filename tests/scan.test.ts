import { describe, expect, it } from 'vitest'
import type { ScanPage } from '../src/song/model.js'
import {
  addBox,
  boxesForBar,
  lastMarkedBar,
  mergeWithNext,
  readingOrder,
  removeBox,
  renumberFrom,
  splitBox,
  toggleBarNumber,
} from '../src/song/scan.js'

/** Two rows on page one, one row on page two, numbered 1 to 7 by the detector. */
const pages = (): ScanPage[] => [
  {
    image: 'scan/p1.png',
    boxes: [
      { bars: [1], x: 0, y: 0, w: 100, h: 50 },
      { bars: [2], x: 100, y: 0, w: 100, h: 50 },
      { bars: [3], x: 200, y: 0, w: 100, h: 50 },
      { bars: [4], x: 0, y: 100, w: 150, h: 50 },
      { bars: [5], x: 150, y: 100, w: 150, h: 50 },
    ],
  },
  {
    image: 'scan/p2.png',
    boxes: [
      { bars: [6], x: 0, y: 0, w: 100, h: 50 },
      { bars: [7], x: 100, y: 0, w: 100, h: 50 },
    ],
  },
]

const numbers = (ps: ScanPage[]) => ps.flatMap((p) => p.boxes.map((b) => b.bars.join('+')))

describe('reading order', () => {
  it('goes row by row, left to right, whatever order the boxes are stored in', () => {
    const shuffled: ScanPage[] = [
      {
        image: 'p',
        boxes: [
          { bars: [], x: 100, y: 100, w: 50, h: 40 },
          { bars: [], x: 50, y: 0, w: 50, h: 40 },
          { bars: [], x: 0, y: 103, w: 50, h: 40 },
          { bars: [], x: 0, y: 0, w: 50, h: 40 },
        ],
      },
    ]
    expect(readingOrder(shuffled).map((r) => r.index)).toEqual([3, 1, 2, 0])
  })

  it('finds the boxes for a bar, including a repeat marked on one box', () => {
    const ps = toggleBarNumber(pages(), { page: 0, index: 1 }, 9)
    expect(boxesForBar(ps, 2)).toEqual([{ page: 0, index: 1 }])
    expect(boxesForBar(ps, 9)).toEqual([{ page: 0, index: 1 }])
    expect(ps[0]!.boxes[1]!.bars).toEqual([2, 9])
    expect(toggleBarNumber(ps, { page: 0, index: 1 }, 9)[0]!.boxes[1]!.bars).toEqual([2])
    expect(lastMarkedBar(ps)).toBe(9)
  })
})

describe('editing', () => {
  it('renumbers from a box onward, across the page break, leaving earlier boxes alone', () => {
    const ps = renumberFrom(pages(), { page: 0, index: 3 }, 10)
    expect(numbers(ps)).toEqual(['1', '2', '3', '10', '11', '12', '13'])
  })

  it('splits a box into equal parts and numbers on from there', () => {
    const ps = splitBox(pages(), { page: 0, index: 1 }, 2)
    expect(ps[0]!.boxes).toHaveLength(6)
    expect(ps[0]!.boxes[1]).toEqual({ bars: [2], x: 100, y: 0, w: 50, h: 50 })
    expect(ps[0]!.boxes[2]).toEqual({ bars: [3], x: 150, y: 0, w: 50, h: 50 })
    expect(numbers(ps)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('merges a box with the next on its row and closes the numbering', () => {
    const ps = mergeWithNext(pages(), { page: 0, index: 0 })
    expect(ps[0]!.boxes[0]).toEqual({ bars: [1], x: 0, y: 0, w: 200, h: 50 })
    expect(numbers(ps)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('will not merge across rows', () => {
    const ps = mergeWithNext(pages(), { page: 0, index: 2 })
    expect(numbers(ps)).toEqual(numbers(pages()))
  })

  it('removes a box and the rest close up', () => {
    const ps = removeBox(pages(), { page: 0, index: 1 })
    expect(ps[0]!.boxes).toHaveLength(4)
    expect(numbers(ps)).toEqual(['1', '2', '3', '4', '5', '6'])
    const last = removeBox(pages(), { page: 1, index: 1 })
    expect(numbers(last)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('adds a drawn box in reading order and numbers it from its neighbour', () => {
    // A box the detector missed between bars 4 and 5, drawn on the second row,
    // starting a little before bar 5's left edge.
    const ps = addBox(pages(), 0, { x: 140, y: 100, w: 20, h: 50 })
    const drawn = ps[0]!.boxes[5]!
    expect(drawn.bars).toEqual([5])
    expect(numbers(ps).sort((a, b) => Number(a) - Number(b))).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8',
    ])
    expect(ps[1]!.boxes.map((b) => b.bars[0])).toEqual([7, 8])
  })
})
