/**
 * The bars: tapping the downbeats in, and fixing the ones that landed late.
 *
 * Play the record and press B on each one. A second tap on the same downbeat
 * replaces it, a tap near one of the import tool's beat guesses snaps to it,
 * and once a few bars are in, the tempo you tapped can be carried to the end
 * of the song in one click. Everything else here is a small correction.
 */

import { useEffect, useRef, useState } from 'react'
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
} from '../song/barmap.js'
import { beatInterval, formatTime, type SongPackage } from '../song/model.js'
import type { Timeline } from '../song/timeline.js'

interface Props {
  pkg: SongPackage
  timeline: Timeline
  position: number
  duration: number
  /** The player's own clock, read at the instant of a tap. */
  readPosition: () => number
  onChange: (update: (pkg: SongPackage) => SongPackage) => void
  onSeek: (time: number) => void
}

const WINDOW = 5

export default function SongBars({
  pkg,
  timeline,
  position,
  duration,
  readPosition,
  onChange,
  onSeek,
}: Props) {
  const [snap, setSnap] = useState(true)
  const history = useRef<number[][]>([])

  const bars = pkg.bars
  const setBars = (next: number[]) => {
    history.current.push(bars)
    if (history.current.length > 50) history.current.shift()
    onChange((p) => ({ ...p, bars: next }))
  }

  const tap = () => {
    const t = readPosition()
    setBars(addBar(bars, t, snap ? { snapTo: pkg.beatCandidates } : {}))
  }

  const undo = () => {
    const previous = history.current.pop()
    if (previous) onChange((p) => ({ ...p, bars: previous }))
  }

  const fromBeats = () => {
    const first = nearestBeatIndex(pkg.beatCandidates, readPosition())
    if (first === null) return
    const t = pkg.beatCandidates[first]!
    const kept = bars.filter((b) => b < t - 0.1)
    setBars([...kept, ...barsFromBeats(pkg.beatCandidates, pkg.beatsPerBar, first)])
  }

  const clearAll = () => {
    if (bars.length === 0) return
    if (!window.confirm(`Clear all ${bars.length} bars? Undo brings them back until you leave the song.`)) return
    setBars([])
  }

  // B taps a bar, unless you are typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'b' && event.key !== 'B') return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      tap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const median = medianBarDuration(bars)
  const beat = beatInterval(pkg)
  const suggested = median !== null && beat !== null ? detectBeatsPerBar(median, beat) : null
  const currentIndex = barIndexAt(bars, position)
  const from = Math.max(0, (currentIndex ?? 0) - WINDOW)
  const to = Math.min(bars.length, (currentIndex ?? 0) + WINDOW + 1)

  return (
    <div className="editor-body">
      <p className="hint">
        {bars.length === 0
          ? 'No bars yet. Play the record and press B on each downbeat, or start from the beat guesses.'
          : [
              `${bars.length} bar${bars.length === 1 ? '' : 's'}`,
              median !== null ? `typical bar ${median.toFixed(2)} s` : null,
              median !== null ? `about ${Math.round((60 * pkg.beatsPerBar) / median)} bpm` : null,
              timeline.barsNeeded > bars.length ? `the form needs ${timeline.barsNeeded}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
        {suggested !== null && suggested !== pkg.beatsPerBar
          ? ` The tapped bars look like ${suggested} beats each, not ${pkg.beatsPerBar}.`
          : ''}
      </p>

      <div className="transport bars-actions">
        <button type="button" className="play" onClick={tap}>
          Tap bar (B)
        </button>
        <button type="button" onClick={undo} disabled={history.current.length === 0}>
          Undo
        </button>
        <button
          type="button"
          onClick={fromBeats}
          disabled={pkg.beatCandidates.length === 0}
          title="Every bar from the beat guess nearest the playhead to the end of the song"
        >
          Bars from the beat guesses
        </button>
        <button
          type="button"
          onClick={() => setBars(extendBars(bars, duration))}
          disabled={median === null}
          title="Carry the tapped tempo on to the end of the song"
        >
          Extend to the end
        </button>
        <button type="button" onClick={clearAll} disabled={bars.length === 0}>
          Clear all
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={snap}
            disabled={pkg.beatCandidates.length === 0}
            onChange={(e) => setSnap(e.target.checked)}
          />
          snap taps to beat guesses
        </label>
      </div>

      {bars.length > 0 ? (
        <ol className="bars-list" start={from + 1}>
          {bars.slice(from, to).map((time, k) => {
            const i = from + k
            return (
              <li key={i} className={i === currentIndex ? 'bar-row current' : 'bar-row'}>
                <button type="button" className="bar-time" onClick={() => onSeek(time)} title="Jump here">
                  {formatTime(time)}
                </button>
                <span className="bar-nudge">
                  {[-0.05, -0.01, 0.01, 0.05].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => setBars(nudgeBar(bars, i, delta))}
                      title={`${delta > 0 ? 'later' : 'earlier'} by ${Math.abs(delta * 1000)} ms`}
                    >
                      {delta > 0 ? '+' : '−'}
                      {Math.abs(delta * 1000)}
                    </button>
                  ))}
                </span>
                <span className="bar-tools">
                  <button
                    type="button"
                    onClick={() => setBars(shiftBarsFrom(bars, i, -0.05))}
                    title="This bar and every later one, 50 ms earlier"
                  >
                    ⇤ tail
                  </button>
                  <button
                    type="button"
                    onClick={() => setBars(shiftBarsFrom(bars, i, 0.05))}
                    title="This bar and every later one, 50 ms later"
                  >
                    tail ⇥
                  </button>
                  <button
                    type="button"
                    onClick={() => setBars(insertMidpoint(bars, i))}
                    disabled={i >= bars.length - 1}
                    title="Insert a bar between this one and the next"
                  >
                    split
                  </button>
                  <button type="button" className="song-remove" onClick={() => setBars(removeBar(bars, i))} title="Remove this bar">
                    ×
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
