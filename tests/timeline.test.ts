import { describe, expect, it } from 'vitest'
import { keyName } from '../src/notes/key.js'
import { chordName } from '../src/notes/chord.js'
import {
  addBar,
  barIndexAt,
  barsFromBeats,
  detectBeatsPerBar,
  extendBars,
  insertMidpoint,
  medianBarDuration,
  nearestBeatIndex,
  nudgeBar,
  removeBar,
  shiftBarsFrom,
} from '../src/song/barmap.js'
import { parseSongPackage } from '../src/song/model.js'
import {
  barPositionAt,
  buildTimeline,
  eventIndexAt,
  parseKeyText,
  sectionForBar,
} from '../src/song/timeline.js'

/* The bar map ------------------------------------------------------------ */

describe('bar map', () => {
  const bars = [0, 2, 4, 6]

  it('finds the bar containing a time', () => {
    expect(barIndexAt(bars, -1)).toBeNull()
    expect(barIndexAt(bars, 0)).toBe(0)
    expect(barIndexAt(bars, 2.5)).toBe(1)
    expect(barIndexAt(bars, 99)).toBe(3)
    expect(barIndexAt([], 1)).toBeNull()
  })

  it('adds a tap in order, snapped to a beat guess when one is close', () => {
    expect(addBar(bars, 3.1)).toEqual([0, 2, 3.1, 4, 6])
    expect(addBar(bars, 3.1, { snapTo: [3.0, 3.5] })).toEqual([0, 2, 3, 4, 6])
    expect(addBar(bars, 3.3, { snapTo: [3.0, 3.5] })).toEqual([0, 2, 3.3, 4, 6])
  })

  it('treats a second tap on the same downbeat as a correction', () => {
    expect(addBar(bars, 2.1)).toEqual([0, 2.1, 4, 6])
  })

  it('removes, nudges within the neighbours, and shifts a tail', () => {
    expect(removeBar(bars, 1)).toEqual([0, 4, 6])
    expect(nudgeBar(bars, 1, 0.3)).toEqual([0, 2.3, 4, 6])
    expect(nudgeBar(bars, 1, 5)[1]).toBeCloseTo(3.95)
    expect(nudgeBar(bars, 0, -5)[0]).toBe(0)
    expect(shiftBarsFrom(bars, 2, 0.5)).toEqual([0, 2, 4.5, 6.5])
    expect(shiftBarsFrom(bars, 2, -5)[2]).toBeCloseTo(2.05)
  })

  it('knows the typical bar and carries it to the end of the song', () => {
    expect(medianBarDuration([0, 2, 4, 9])).toBe(2)
    expect(medianBarDuration([0])).toBeNull()
    // A last bar is added only when at least half of it fits before the end.
    expect(extendBars([0, 2], 9)).toEqual([0, 2, 4, 6, 8])
    expect(extendBars([0, 2], 9.4)).toEqual([0, 2, 4, 6, 8])
    expect(extendBars([0, 2], 8.9)).toEqual([0, 2, 4, 6])
    expect(extendBars([5], 10)).toEqual([5])
    expect(extendBars([5], 10, 1)).toEqual([5, 6, 7, 8, 9])
  })

  it('splits a missed bar and builds a map from beat guesses', () => {
    expect(insertMidpoint([0, 4], 0)).toEqual([0, 2, 4])
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
    expect(barsFromBeats(beats, 4)).toEqual([0, 2, 4])
    expect(barsFromBeats(beats, 4, 1)).toEqual([0.5, 2.5])
    expect(barsFromBeats(beats, 3, 2)).toEqual([1, 2.5, 4])
    expect(nearestBeatIndex(beats, 1.7)).toBe(3)
    expect(nearestBeatIndex([], 1)).toBeNull()
  })

  it('reads the meter off the tapped bar length', () => {
    expect(detectBeatsPerBar(2.0, 0.5)).toBe(4)
    expect(detectBeatsPerBar(1.55, 0.5)).toBe(3)
    expect(detectBeatsPerBar(1.75, 0.5)).toBeNull()
    expect(detectBeatsPerBar(0, 0.5)).toBeNull()
  })
})

/* Keys ------------------------------------------------------------------- */

describe('parseKeyText', () => {
  it('reads the ways a key gets written', () => {
    expect(keyName(parseKeyText('D'))).toBe('D')
    expect(keyName(parseKeyText('Dm'))).toBe('D minor')
    expect(keyName(parseKeyText('F#m'))).toBe('F# minor')
    expect(keyName(parseKeyText('Bb major'))).toBe('Bb')
    expect(keyName(parseKeyText('e dorian'))).toBe('E dorian')
    expect(keyName(parseKeyText(' A - '))).toBe('A minor')
  })

  it('refuses what it cannot read', () => {
    expect(() => parseKeyText('H')).toThrow('Cannot read')
    expect(() => parseKeyText('D sharp')).toThrow('not a mode')
  })
})

/* The timeline ----------------------------------------------------------- */

const waltz = () =>
  parseSongPackage({
    format: 1,
    title: 'Waltz',
    stems: [{ id: 'guitar', file: 'g.mp3' }],
    key: 'D',
    beatsPerBar: 3,
    bars: [0, 1.5, 3, 4.5, 6, 7.5],
    sections: [{ name: 'A', bars: [1, 4], chart: 'a' }],
    charts: { a: '| D | A7 G | D | D |' },
  })

describe('buildTimeline', () => {
  it('places every chord of a 3/4 chart on the bar map', () => {
    const t = buildTimeline(waltz())
    expect(t.problems).toEqual([])
    expect(t.events.map((e) => [chordName(e.analysis.symbol), e.bar, e.beat, e.time])).toEqual([
      ['D', 1, 1, 0],
      ['A7', 2, 1, 1.5],
      ['G', 2, 2.5, 2.25],
      ['D', 3, 1, 3],
      ['D', 4, 1, 4.5],
    ])
    const a7 = t.events[1]!
    expect(a7.analysis.nashville).toBe('5(7)')
    expect(a7.analysis.roman).toBe('V7')
    expect(a7.endTime).toBeCloseTo(2.25)
    expect(t.barsNeeded).toBe(4)
    expect(t.barsMapped).toBe(6)
  })

  it('cycles a short chart through a long section, like a chorus played twice', () => {
    const pkg = waltz()
    pkg.sections = [{ name: 'A', bars: [1, 6], chart: 'two' }]
    pkg.charts = { two: '| D | A7 |' }
    const t = buildTimeline(pkg)
    expect(t.events.map((e) => chordName(e.analysis.symbol))).toEqual([
      'D', 'A7', 'D', 'A7', 'D', 'A7',
    ])
    expect(t.events[4]!.chordIndex).toBe(0)
    expect(t.events[4]!.bar).toBe(5)
    expect(t.problems).toEqual([])
  })

  it('reports the bars that have no times yet and still places the rest', () => {
    const pkg = waltz()
    pkg.bars = [0, 1.5]
    const t = buildTimeline(pkg)
    expect(t.events.map((e) => e.bar)).toEqual([1, 2, 2])
    expect(t.problems).toEqual([
      { where: 'A', message: 'bars 3 to 4 have no times yet; tap them in' },
    ])
  })

  it('uses the typical bar length for the last mapped bar', () => {
    const pkg = waltz()
    pkg.bars = [0, 1.5, 3, 4.5]
    const t = buildTimeline(pkg)
    const last = t.events[t.events.length - 1]!
    expect(last.bar).toBe(4)
    expect(last.endTime).toBeCloseTo(6)
  })

  it('turns a chart it cannot read into a problem, not a crash', () => {
    const pkg = waltz()
    pkg.charts = { a: '| D | Zz7 |' }
    const t = buildTimeline(pkg)
    expect(t.events).toEqual([])
    expect(t.problems[0]!.where).toBe('A')
    expect(t.problems[0]!.message).toMatch(/Zz|parse|note/i)
  })

  it('flags an unreadable key, an empty chart, and overlapping sections', () => {
    const pkg = waltz()
    pkg.key = 'Hm'
    pkg.sections = [
      { name: 'A', bars: [1, 4], chart: 'a' },
      { name: 'B', bars: [3, 6] },
    ]
    const t = buildTimeline(pkg)
    const where = t.problems.map((p) => p.where)
    expect(where).toContain('key')
    expect(where.filter((w) => w === 'B')).toHaveLength(2)
    expect(t.problems.find((p) => p.message.includes('inside "A"'))).toBeDefined()
    expect(t.problems.find((p) => p.message === 'has no chart yet')).toBeDefined()
    expect(keyName(t.key)).toBe('C')
  })

  it('finds the chord sounding at a time, and the bar and beat', () => {
    const t = buildTimeline(waltz())
    expect(eventIndexAt(t, -0.5)).toBe(-1)
    expect(eventIndexAt(t, 0)).toBe(0)
    expect(eventIndexAt(t, 2.0)).toBe(1)
    expect(eventIndexAt(t, 2.3)).toBe(2)
    expect(eventIndexAt(t, 100)).toBe(4)
    expect(barPositionAt([0, 1.5, 3], 3, 2.0)).toEqual({ bar: 2, beat: 2 })
    expect(barPositionAt([0, 1.5, 3], 3, 3.5)!.bar).toBe(3)
    expect(barPositionAt([0, 1.5, 3], 3, -1)).toBeNull()
    expect(sectionForBar(t, 3)!.name).toBe('A')
    expect(sectionForBar(t, 9)).toBeNull()
  })
})
