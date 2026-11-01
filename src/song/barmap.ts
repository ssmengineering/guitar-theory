/**
 * The bar map: downbeat times, and the small moves that make them right.
 *
 * A bar map is a sorted list of seconds, one per downbeat. It is built by
 * listening - tap on the one, nudge what landed late, let the rest follow at
 * the tempo you tapped - so every operation here takes a list and returns a
 * new one, and none of them can leave the list out of order.
 */

/** Two downbeats closer than this are the same downbeat tapped twice. */
export const RETAP_WINDOW = 0.25

/** No bar may be shorter than this, whatever you drag. */
const MIN_GAP = 0.05

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)

/** Index of the bar containing `t` (the last downbeat at or before it), or null before the first. */
export function barIndexAt(bars: readonly number[], t: number): number | null {
  if (bars.length === 0 || t < bars[0]!) return null
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface AddBarOptions {
  /** Beat guesses to snap to, if any are close. */
  snapTo?: readonly number[]
  /** How close is close, in seconds. */
  tolerance?: number
}

/** Nearest of `times` within `tolerance`, else `t` itself. */
export function snapTime(t: number, times: readonly number[], tolerance = 0.12): number {
  let best = t
  let bestDistance = tolerance
  for (const c of times) {
    const d = Math.abs(c - t)
    if (d <= bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/**
 * Record a downbeat. Snaps to a beat guess when one is close, replaces a bar
 * tapped within the re-tap window (so hitting the key twice fixes rather than
 * doubles), otherwise inserts in order.
 */
export function addBar(bars: readonly number[], t: number, options: AddBarOptions = {}): number[] {
  const time = options.snapTo ? snapTime(t, options.snapTo, options.tolerance) : t
  const kept = bars.filter((b) => Math.abs(b - time) >= RETAP_WINDOW)
  return sorted([...kept, Math.max(0, time)])
}

export function removeBar(bars: readonly number[], index: number): number[] {
  return bars.filter((_, i) => i !== index)
}

/** Move one downbeat by `delta` seconds, never past its neighbours. */
export function nudgeBar(bars: readonly number[], index: number, delta: number): number[] {
  const current = bars[index]
  if (current === undefined) return [...bars]
  const lo = index > 0 ? bars[index - 1]! + MIN_GAP : 0
  const hi = index < bars.length - 1 ? bars[index + 1]! - MIN_GAP : Number.POSITIVE_INFINITY
  const moved = Math.min(hi, Math.max(lo, current + delta))
  return bars.map((b, i) => (i === index ? moved : b))
}

/** Move this downbeat and every later one together - the whole tail was early or late. */
export function shiftBarsFrom(bars: readonly number[], index: number, delta: number): number[] {
  const current = bars[index]
  if (current === undefined) return [...bars]
  const lo = index > 0 ? bars[index - 1]! + MIN_GAP : 0
  const applied = Math.max(delta, lo - current)
  return bars.map((b, i) => (i >= index ? b + applied : b))
}

/** The typical bar length, which one odd bar cannot pull around. */
export function medianBarDuration(bars: readonly number[]): number | null {
  if (bars.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < bars.length; i++) gaps.push(bars[i]! - bars[i - 1]!)
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
}

/**
 * Carry the tapped tempo on to the end of the song: append bars at
 * `barDuration` (the median by default) while a whole one still fits.
 */
export function extendBars(
  bars: readonly number[],
  untilTime: number,
  barDuration = medianBarDuration(bars) ?? Number.NaN,
): number[] {
  if (bars.length === 0 || !Number.isFinite(barDuration) || barDuration <= MIN_GAP) return [...bars]
  const out = [...bars]
  let next = out[out.length - 1]! + barDuration
  while (next + barDuration * 0.5 <= untilTime) {
    out.push(next)
    next += barDuration
  }
  return out
}

/** Split the gap after `index` in two - a bar you missed between two you hit. */
export function insertMidpoint(bars: readonly number[], index: number): number[] {
  const a = bars[index]
  const b = bars[index + 1]
  if (a === undefined || b === undefined) return [...bars]
  return sorted([...bars, (a + b) / 2])
}

/**
 * The bar map most songs want: every `beatsPerBar`-th beat guess, starting
 * from the guess at `firstBeatIndex`. Tap one downbeat, pick the nearest guess,
 * and the rest of the song follows.
 */
export function barsFromBeats(
  beats: readonly number[],
  beatsPerBar: number,
  firstBeatIndex = 0,
): number[] {
  const out: number[] = []
  for (let i = firstBeatIndex; i < beats.length; i += beatsPerBar) out.push(beats[i]!)
  return out
}

/** Index of the beat guess nearest `t`, or null when there are none. */
export function nearestBeatIndex(beats: readonly number[], t: number): number | null {
  if (beats.length === 0) return null
  let best = 0
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs(beats[i]! - t) < Math.abs(beats[best]! - t)) best = i
  }
  return best
}

/** How many beats fit in a bar, when the ratio is clean enough to trust. */
export function detectBeatsPerBar(barDuration: number, beatInterval: number): number | null {
  if (barDuration <= 0 || beatInterval <= 0) return null
  const ratio = barDuration / beatInterval
  for (const n of [2, 3, 4, 6]) {
    if (Math.abs(ratio - n) / n <= 0.12) return n
  }
  return null
}
