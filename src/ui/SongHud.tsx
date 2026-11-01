/**
 * The chord, now: what the record is playing under your hands this bar.
 *
 * The name, the number, the numeral, and the engine's one-line reason for
 * the chord being there; then the same five frets the Improv screen shows,
 * recoloured by this chord's degrees. Click any chord in the strip to jump
 * the record to it.
 */

import { useMemo, useState } from 'react'
import { positionMap } from '../guitar/shapes.js'
import { chordName } from '../notes/chord.js'
import { keyName } from '../notes/key.js'
import type { SongPackage } from '../song/model.js'
import {
  barPositionAt,
  eventIndexAt,
  sectionForBar,
  type ChordEvent,
  type Timeline,
} from '../song/timeline.js'
import { Fretboard, roleForLabel, type FretboardDot } from './Fretboard.js'
import { GUITARS, POSITIONS } from './options.js'

const ROLE_WORDS: Record<string, string> = {
  diatonic: 'in the key',
  'secondary-dominant': 'secondary dominant',
  'tritone-sub': 'tritone substitute',
  borrowed: 'borrowed',
  chromatic: 'chromatic',
}

interface Props {
  pkg: SongPackage
  timeline: Timeline
  position: number
  duration: number
  onSeek: (time: number) => void
}

export default function SongHud({ pkg, timeline, position, duration, onSeek }: Props) {
  const [positionIndex, setPositionIndex] = useState(POSITIONS.length - 1)
  const [guitarIndex, setGuitarIndex] = useState(0)
  const instrument = GUITARS[guitarIndex]!.instrument
  const fretRange = POSITIONS[positionIndex]!.range

  const eventIndex = eventIndexAt(timeline, position)
  const current: ChordEvent | null = timeline.events[eventIndex] ?? null
  const next: ChordEvent | null = timeline.events[eventIndex + 1] ?? null
  const barPosition = barPositionAt(pkg.bars, pkg.beatsPerBar, position, duration)
  const section = current
    ? (timeline.sections[current.sectionIndex] ?? null)
    : barPosition
      ? sectionForBar(timeline, barPosition.bar)
      : null

  const dots: FretboardDot[] = useMemo(() => {
    if (!current) return []
    return positionMap(instrument, current.analysis.symbol, fretRange).map((cell) => ({
      string: cell.string,
      fret: cell.fret,
      label: cell.label,
      role:
        cell.kind === 'chord-tone'
          ? roleForLabel(cell.label)
          : cell.kind === 'avoid'
            ? ('avoid' as const)
            : ('tension' as const),
      outline: cell.kind !== 'chord-tone',
    }))
  }, [current, instrument, fretRange])

  /** Jump to the same chord in the cycle of the chart we are in now. */
  const jumpTo = (chordIndex: number) => {
    if (!current || !section) return
    const cycleStart =
      section.firstBar +
      Math.floor((current.bar - section.firstBar) / section.chartBars) * section.chartBars
    const target = timeline.events.find(
      (e) =>
        e.sectionIndex === section.index &&
        e.chordIndex === chordIndex &&
        e.bar >= cycleStart &&
        e.bar < cycleStart + section.chartBars,
    )
    if (target) onSeek(target.time)
  }

  if (timeline.events.length === 0) {
    return (
      <section className="panel hud">
        <h2>The chords</h2>
        <p className="empty-panel">
          Nothing to show yet. Open <strong>Chart and form</strong> below to type the changes,
          then <strong>Bars</strong> to tap the downbeats in while the record plays. The chords
          appear here as soon as both exist.
        </p>
      </section>
    )
  }

  return (
    <section className="panel hud">
      <div className="hud-head">
        <h2>
          {section ? section.name : 'The chords'}
          {barPosition ? (
            <span className="hud-bar">
              {' '}
              · bar {barPosition.bar} · beat {Math.floor(barPosition.beat)}
            </span>
          ) : null}
        </h2>
        <div className="hud-options">
          <select
            value={positionIndex}
            onChange={(e) => setPositionIndex(Number(e.target.value))}
            aria-label="Position"
          >
            {POSITIONS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={guitarIndex}
            onChange={(e) => setGuitarIndex(Number(e.target.value))}
            aria-label="Guitar"
          >
            {GUITARS.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {section && section.items.length > 0 ? (
        <div className="changes-strip hud-strip">
          {section.items.map((item, i) => (
            <button
              key={i}
              type="button"
              className={current && current.chordIndex === i ? 'change current' : 'change'}
              onClick={() => jumpTo(i)}
              title={`bar ${item.bar + 1} of the chart`}
            >
              <strong>{chordName(item.symbol)}</strong>
              <em>{item.nashville}</em>
            </button>
          ))}
        </div>
      ) : null}

      {current ? (
        <>
          <div className="hud-now">
            <div className="hud-chord">
              <strong>{chordName(current.analysis.symbol)}</strong>
              <span className="hud-numbers">
                {current.analysis.nashville} · {current.analysis.roman} in {keyName(timeline.key)}
              </span>
            </div>
            <p className="hud-why">
              <em>{ROLE_WORDS[current.analysis.role] ?? current.analysis.role}.</em>{' '}
              {current.analysis.explanation}
            </p>
            {next ? (
              <p className="hud-next">
                then <strong>{chordName(next.analysis.symbol)}</strong> ({next.analysis.nashville})
                at bar {next.bar}
                {next.beat > 1 ? `, beat ${Math.round(next.beat)}` : ''}
              </p>
            ) : (
              <p className="hud-next">the last chord of the chart</p>
            )}
          </div>
          <div className="board">
            <Fretboard instrument={instrument} fretRange={fretRange} dots={dots} />
          </div>
        </>
      ) : (
        <p className="empty-panel">
          Before the first bar. The chords start at {timeline.events[0]!.time.toFixed(1)} s.
        </p>
      )}
    </section>
  )
}
