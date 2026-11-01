/**
 * The scanned page's boxes: one per bar, numbered in reading order.
 *
 * The import tool draws the first draft of these by finding the bar lines.
 * This module is everything the player then does to them by hand - renumber
 * from a box, split a box the detector missed a line in, merge two it split,
 * remove a sliver, draw one it never saw, mark a box as a second bar under a
 * repeat - and it keeps the numbering straight through the pages after every
 * change. Pure functions over the package's scan pages; nothing here touches
 * the screen.
 */

import type { ScanBox, ScanPage } from './model.js'

export interface BoxRef {
  page: number
  index: number
}

const sameRef = (a: BoxRef, b: BoxRef) => a.page === b.page && a.index === b.index

/** Two boxes share a row when their vertical extents mostly overlap. */
function sameRow(a: ScanBox, b: ScanBox): boolean {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlap >= 0.5 * Math.min(a.h, b.h)
}

/** Every box on the pages, as you would read them: page by page, row by row, left to right. */
export function readingOrder(pages: readonly ScanPage[]): BoxRef[] {
  const out: BoxRef[] = []
  pages.forEach((page, pageIndex) => {
    const refs = page.boxes.map((_, index) => ({ page: pageIndex, index }))
    // Rows first: a box belongs to the row of the first box it overlaps.
    const rows: BoxRef[][] = []
    for (const ref of refs) {
      const box = page.boxes[ref.index]!
      const row = rows.find((r) => sameRow(page.boxes[r[0]!.index]!, box))
      if (row) row.push(ref)
      else rows.push([ref])
    }
    rows.sort((a, b) => page.boxes[a[0]!.index]!.y - page.boxes[b[0]!.index]!.y)
    for (const row of rows) {
      row.sort((a, b) => page.boxes[a.index]!.x - page.boxes[b.index]!.x)
      out.push(...row)
    }
  })
  return out
}

/** The boxes that stand for a bar - usually one, more under a repeat. */
export function boxesForBar(pages: readonly ScanPage[], bar: number): BoxRef[] {
  const out: BoxRef[] = []
  pages.forEach((page, pageIndex) => {
    page.boxes.forEach((box, index) => {
      if (box.bars.includes(bar)) out.push({ page: pageIndex, index })
    })
  })
  return out
}

const clonePages = (pages: readonly ScanPage[]): ScanPage[] =>
  pages.map((p) => ({ image: p.image, boxes: p.boxes.map((b) => ({ ...b, bars: [...b.bars] })) }))

/**
 * Call `from` bar `bar`, and every box after it in reading order the next
 * number along. Boxes before it are left alone, so renumbering the start of
 * the second chorus does not disturb the first.
 */
export function renumberFrom(pages: readonly ScanPage[], from: BoxRef, bar: number): ScanPage[] {
  const next = clonePages(pages)
  const order = readingOrder(next)
  const start = order.findIndex((r) => sameRef(r, from))
  if (start < 0) return next
  let n = bar
  for (const ref of order.slice(start)) {
    next[ref.page]!.boxes[ref.index]!.bars = [n]
    n += 1
  }
  return next
}

/** The number a box would get from the box before it, or 1 at the very start. */
function numberAfterPrevious(pages: readonly ScanPage[], ref: BoxRef): number {
  const order = readingOrder(pages)
  const at = order.findIndex((r) => sameRef(r, ref))
  const previous = at > 0 ? order[at - 1] : undefined
  if (!previous) return 1
  const bars = pages[previous.page]!.boxes[previous.index]!.bars
  return (bars.length > 0 ? Math.max(...bars) : 0) + 1
}

/** Split a box into `parts` equal boxes and renumber from the first of them. */
export function splitBox(pages: readonly ScanPage[], ref: BoxRef, parts = 2): ScanPage[] {
  if (parts < 2) return clonePages(pages)
  const next = clonePages(pages)
  const page = next[ref.page]
  const box = page?.boxes[ref.index]
  if (!page || !box) return next
  const first = box.bars[0] ?? numberAfterPrevious(pages, ref)
  const width = box.w / parts
  const pieces: ScanBox[] = Array.from({ length: parts }, (_, i) => ({
    bars: [],
    x: Math.round(box.x + i * width),
    y: box.y,
    w: Math.round(width),
    h: box.h,
  }))
  page.boxes.splice(ref.index, 1, ...pieces)
  return renumberFrom(next, ref, first)
}

/** Merge a box with the next one on its row, keeping the first's number, and renumber on. */
export function mergeWithNext(pages: readonly ScanPage[], ref: BoxRef): ScanPage[] {
  const next = clonePages(pages)
  const order = readingOrder(next)
  const at = order.findIndex((r) => sameRef(r, ref))
  const after = order[at + 1]
  if (at < 0 || !after || after.page !== ref.page) return next
  const page = next[ref.page]!
  const a = page.boxes[ref.index]!
  const b = page.boxes[after.index]!
  if (!sameRow(a, b)) return next
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const merged: ScanBox = {
    bars: [...a.bars],
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
  const first = a.bars[0] ?? numberAfterPrevious(pages, ref)
  page.boxes[ref.index] = merged
  page.boxes.splice(after.index, 1)
  const mergedRef = { page: ref.page, index: after.index < ref.index ? ref.index - 1 : ref.index }
  return renumberFrom(next, mergedRef, first)
}

/** Remove a box; the boxes after it close the gap in the numbering. */
export function removeBox(pages: readonly ScanPage[], ref: BoxRef): ScanPage[] {
  const next = clonePages(pages)
  const order = readingOrder(next)
  const at = order.findIndex((r) => sameRef(r, ref))
  if (at < 0) return next
  const removed = next[ref.page]!.boxes[ref.index]!
  const first = removed.bars[0]
  next[ref.page]!.boxes.splice(ref.index, 1)
  const after = order[at + 1]
  if (!after || first === undefined) return next
  const shifted = after.page === ref.page && after.index > ref.index ? after.index - 1 : after.index
  return renumberFrom(next, { page: after.page, index: shifted }, first)
}

/** Add a box drawn by hand; it takes its place in reading order and the numbering follows. */
export function addBox(
  pages: readonly ScanPage[],
  pageIndex: number,
  rect: { x: number; y: number; w: number; h: number },
): ScanPage[] {
  const next = clonePages(pages)
  const page = next[pageIndex]
  if (!page) return next
  const box: ScanBox = { bars: [], ...rect }
  page.boxes.push(box)
  const ref = { page: pageIndex, index: page.boxes.length - 1 }
  return renumberFrom(next, ref, numberAfterPrevious(next, ref))
}

/** Give a box a second bar number (a repeat plays the same ink twice), or take one away. */
export function toggleBarNumber(pages: readonly ScanPage[], ref: BoxRef, bar: number): ScanPage[] {
  const next = clonePages(pages)
  const box = next[ref.page]?.boxes[ref.index]
  if (!box) return next
  box.bars = box.bars.includes(bar)
    ? box.bars.filter((b) => b !== bar)
    : [...box.bars, bar].sort((a, b) => a - b)
  return next
}

/** The highest bar number marked on any page. */
export function lastMarkedBar(pages: readonly ScanPage[]): number {
  let last = 0
  for (const page of pages) for (const box of page.boxes) for (const b of box.bars) last = Math.max(last, b)
  return last
}
