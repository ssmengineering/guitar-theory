/**
 * The timeline: where every chord of the song falls in seconds.
 *
 * A package carries three things that are each simple on their own - the
 * form (sections, each a run of bars), the charts (text per section, in the
 * engine's chart syntax), and the bar map (a downbeat time per bar). This
 * module joins them: each bar of a section takes its chords from the section's
 * chart (cycling if the section is longer, as a chorus played twice is), each
 * chord takes its time from the bar map, and each chord is handed to the
 * engine for its number, numeral, role and explanation.
 *
 * Nothing here is stored. The timeline is rebuilt from the package whenever
 * the package changes, so the chart on screen can never disagree with the
 * chart in the file.
 */

import { key as makeKey, type Key, type Mode } from '../notes/key.js'
import { parseNote } from '../notes/pitch.js'
import { analyze, parseChart, type ChordAnalysis } from '../notes/progression.js'
import { barIndexAt, medianBarDuration } from './barmap.js'
import type { SongPackage } from './model.js'

const MODE_WORDS: Record<string, Mode> = {
  '': 'major',
  maj: 'major',
  major: 'major',
  m: 'minor',
  '-': 'minor',
  min: 'minor',
  minor: 'minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
}

/** "D", "Dm", "F#m", "Bb major", "E dorian". */
export function parseKeyText(text: string): Key {
  const m = /^\s*([A-Ga-g])\s*([#b]?)\s*(.*?)\s*$/.exec(text)
  if (!m) throw new Error(`Cannot read the key "${text}"`)
  const tonic = parseNote(m[1]!.toUpperCase() + m[2]!)
  const mode = MODE_WORDS[m[3]!.toLowerCase()]
  if (mode === undefined) throw new Error(`"${m[3]}" is not a mode this app knows`)
  return makeKey(tonic, mode)
}

export interface ChordEvent {
  /** Song seconds. */
  time: number
  endTime: number
  /** Absolute bar number, 1-based. */
  bar: number
  /** Beat within the bar, 1-based; fractional when a bar is split unevenly. */
  beat: number
  beats: number
  sectionIndex: number
  chartName: string
  /** Index into the section's analysed chart items - the same order the chart reads in. */
  chordIndex: number
  analysis: ChordAnalysis
}

export interface SectionSpan {
  index: number
  name: string
  firstBar: number
  lastBar: number
  chartName: string | undefined
  /** When the section starts, if its first bar has a time. */
  startTime: number | null
  chartBars: number
  items: ChordAnalysis[]
}

export interface TimelineProblem {
  where: string
  message: string
}

export interface Timeline {
  key: Key
  beatsPerBar: number
  events: ChordEvent[]
  sections: SectionSpan[]
  problems: TimelineProblem[]
  /** The highest bar number any section reaches. */
  barsNeeded: number
  barsMapped: number
}

export function buildTimeline(pkg: SongPackage, songDuration?: number): Timeline {
  const problems: TimelineProblem[] = []
  let key: Key
  try {
    key = parseKeyText(pkg.key ?? 'C')
  } catch (error) {
    problems.push({ where: 'key', message: (error as Error).message })
    key = makeKey(parseNote('C'))
  }

  const bars = pkg.bars
  const median = medianBarDuration(bars)
  const sections: SectionSpan[] = []
  const events: ChordEvent[] = []
  let barsNeeded = 0

  const byStart = pkg.sections.map((s, i) => ({ s, i })).sort((a, b) => a.s.bars[0] - b.s.bars[0])
  for (let j = 1; j < byStart.length; j++) {
    const prev = byStart[j - 1]!.s
    const here = byStart[j]!.s
    if (here.bars[0] <= prev.bars[1]) {
      problems.push({
        where: here.name,
        message: `starts at bar ${here.bars[0]}, inside "${prev.name}" (bars ${prev.bars[0]} to ${prev.bars[1]})`,
      })
    }
  }

  pkg.sections.forEach((section, sectionIndex) => {
    const [first, last] = section.bars
    barsNeeded = Math.max(barsNeeded, last)
    const chartName = section.chart
    const text = chartName === undefined ? undefined : pkg.charts[chartName]
    const span: SectionSpan = {
      index: sectionIndex,
      name: section.name,
      firstBar: first,
      lastBar: last,
      chartName,
      startTime: bars[first - 1] ?? null,
      chartBars: 0,
      items: [],
    }
    sections.push(span)

    if (text === undefined || text.trim() === '') {
      problems.push({ where: section.name, message: 'has no chart yet' })
      return
    }
    let items: ChordAnalysis[]
    let chartBars: number
    try {
      const progression = parseChart(key, text, pkg.beatsPerBar)
      items = analyze(progression)
      chartBars = progression.bars.length
    } catch (error) {
      problems.push({ where: section.name, message: (error as Error).message })
      return
    }
    if (chartBars === 0) {
      problems.push({ where: section.name, message: 'its chart has no bars' })
      return
    }
    span.chartBars = chartBars
    span.items = items
    const spanLength = last - first + 1
    if (chartBars > spanLength) {
      problems.push({
        where: section.name,
        message: `its chart has ${chartBars} bars but the section is only ${spanLength} long`,
      })
    }

    let missingFrom: number | null = null
    for (let bar = first; bar <= last; bar++) {
      const start = bars[bar - 1]
      if (start === undefined) {
        if (missingFrom === null) missingFrom = bar
        continue
      }
      const next = bars[bar]
      const duration =
        next !== undefined
          ? next - start
          : (median ?? (songDuration !== undefined ? Math.max(0.5, songDuration - start) : 2))
      const chartBar = (bar - first) % chartBars
      let beatsBefore = 0
      items.forEach((item, chordIndex) => {
        if (item.bar !== chartBar) return
        const time = start + (beatsBefore / pkg.beatsPerBar) * duration
        const endTime = time + (item.beats / pkg.beatsPerBar) * duration
        events.push({
          time,
          endTime,
          bar,
          beat: beatsBefore + 1,
          beats: item.beats,
          sectionIndex,
          chartName: chartName!,
          chordIndex,
          analysis: item,
        })
        beatsBefore += item.beats
      })
    }
    if (missingFrom !== null) {
      problems.push({
        where: section.name,
        message:
          missingFrom === last
            ? `bar ${last} has no time yet; tap it in`
            : `bars ${missingFrom} to ${last} have no times yet; tap them in`,
      })
    }
  })

  events.sort((a, b) => a.time - b.time)
  return {
    key,
    beatsPerBar: pkg.beatsPerBar,
    events,
    sections,
    problems,
    barsNeeded,
    barsMapped: bars.length,
  }
}

/** Index of the chord sounding at `t`, or -1 before the first one. */
export function eventIndexAt(timeline: Timeline, t: number): number {
  const events = timeline.events
  if (events.length === 0 || t < events[0]!.time) return -1
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid]!.time <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface BarPosition {
  /** 1-based. */
  bar: number
  /** 1-based, fractional. */
  beat: number
}

/** Which bar and beat `t` falls in, from the bar map alone. */
export function barPositionAt(
  bars: readonly number[],
  beatsPerBar: number,
  t: number,
  songDuration?: number,
): BarPosition | null {
  const index = barIndexAt(bars, t)
  if (index === null) return null
  const start = bars[index]!
  const next = bars[index + 1]
  const duration =
    next !== undefined
      ? next - start
      : (medianBarDuration(bars) ?? (songDuration !== undefined ? songDuration - start : 2))
  const fraction = duration > 0 ? Math.min(0.999, (t - start) / duration) : 0
  return { bar: index + 1, beat: 1 + fraction * beatsPerBar }
}

/** The section a bar number belongs to, if any. */
export function sectionForBar(timeline: Timeline, bar: number): SectionSpan | null {
  return timeline.sections.find((s) => bar >= s.firstBar && bar <= s.lastBar) ?? null
}
