/**
 * The improvisation HUD.
 *
 * Lock your hand to one position and watch the same five frets recolour as the
 * harmony moves underneath it. That is the whole idea, and it teaches playing
 * the changes better than any chapter can, because the thing you need to
 * internalise is not a set of scales — it is that one note under your finger
 * keeps changing its job.
 *
 * String 4, fret 7 is A. Over Dm7 it is the 5th and you can lean on it; two bars
 * later over G7 it is the 9th and it wants to move. Same finger, same fret.
 */

import { useEffect, useMemo, useState } from 'react'
import { positionMap } from '../guitar/shapes.js'
import { guideToneLine } from '../guitar/voiceleading.js'
import { chordName } from '../notes/chord.js'
import { degreeLabel } from '../notes/interval.js'
import { key as makeKey, keyName } from '../notes/key.js'
import { parseNote } from '../notes/pitch.js'
import { analyze, parseChart } from '../notes/progression.js'
import { scaleForChord, toneRoles } from '../notes/scale.js'
import { toPitchClass } from '../notes/pitch.js'
import { eventIndexAt, parseKeyText } from '../song/timeline.js'
import { Fretboard, roleForLabel, type FretboardDot } from './Fretboard.js'
import { GUITARS, POSITIONS } from './options.js'
import { peekPlayer, useSongSession } from './songSession.js'

type Mode = 'all' | 'chord-tones' | 'guide' | 'target'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'chord tones, colour, and the notes that lean' },
  { id: 'chord-tones', label: 'Chord tones only', hint: 'nothing here can sound wrong' },
  { id: 'guide', label: 'Guide tones', hint: '3rds and 7ths — the changes in two notes' },
  { id: 'target', label: 'Target practice', hint: 'land on one degree every chord' },
]

export default function Improv() {
  const [chartText, setChartText] = useState('| Dm7 | G7 | Cmaj7 | Cmaj7 |')
  const [keyText, setKeyText] = useState('C')
  const [guitarIndex, setGuitarIndex] = useState(0)
  const [positionIndex, setPositionIndex] = useState(2)
  const [mode, setMode] = useState<Mode>('all')
  const [target, setTarget] = useState(3)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [bpm, setBpm] = useState(70)

  const instrument = GUITARS[guitarIndex]!.instrument
  const fretRange = POSITIONS[positionIndex]!.range

  // Following the Song screen: the chart, the key and the current chord come
  // from the record that is playing, and the transport drives it.
  const session = useSongSession()
  const [follow, setFollow] = useState(false)
  const songTimeline =
    session.timeline && session.timeline.events.length > 0 ? session.timeline : null
  const following = follow && songTimeline !== null
  const [songPosition, setSongPosition] = useState(0)
  const [songPlaying, setSongPlaying] = useState(false)

  useEffect(() => {
    const p = peekPlayer()
    if (!following || !p) return
    setSongPosition(p.position)
    setSongPlaying(p.playing)
    return p.onTick(() => {
      setSongPosition(p.position)
      setSongPlaying(p.playing)
    })
  }, [following])

  const eventIndex = following ? eventIndexAt(songTimeline, songPosition) : -1
  const songEvent = following
    ? (songTimeline.events[eventIndex] ?? songTimeline.events[0] ?? null)
    : null
  const songSection = songEvent ? (songTimeline!.sections[songEvent.sectionIndex] ?? null) : null
  const effectiveChart =
    songSection && session.pkg ? (session.pkg.charts[songSection.chartName ?? ''] ?? '') : chartText
  const effectiveKey = following ? keyName(songTimeline.key) : keyText
  const beatsPerBar = following && session.pkg ? session.pkg.beatsPerBar : 4

  const parsed = useMemo(() => {
    try {
      const k = parseKeyText(effectiveKey.trim() || 'C')
      const progression = parseChart(k, effectiveChart, beatsPerBar)
      const items = analyze(progression)
      if (items.length === 0) throw new Error('No chords in that chart')
      return { items, key: progression.key, error: null as string | null }
    } catch (error) {
      return { items: [], key: makeKey(parseNote('C')), error: (error as Error).message }
    }
  }, [effectiveChart, effectiveKey, beatsPerBar])

  const items = parsed.items
  const activeIndex = songEvent ? songEvent.chordIndex : index
  const current = items[Math.min(activeIndex, Math.max(0, items.length - 1))]

  const seekEvent = (i: number) => {
    const event = songTimeline?.events[i]
    if (event) void peekPlayer()?.seek(event.time)
  }
  const prev = () =>
    following
      ? seekEvent(Math.max(0, eventIndex - 1))
      : setIndex((i) => (i - 1 + items.length) % items.length)
  const next = () =>
    following
      ? seekEvent(Math.min(songTimeline.events.length - 1, eventIndex + 1))
      : setIndex((i) => (i + 1) % items.length)
  const togglePlay = () => {
    if (!following) {
      setPlaying((p) => !p)
      return
    }
    const p = peekPlayer()
    if (p) void (p.playing ? p.pause() : p.play())
  }
  const isPlaying = following ? songPlaying : playing

  /** Click a chord in the strip: jump the record to it in the cycle we are in, or just show it. */
  const jumpTo = (i: number) => {
    if (!following || !songEvent || !songSection) {
      setIndex(i)
      return
    }
    const cycleStart =
      songSection.firstBar +
      Math.floor((songEvent.bar - songSection.firstBar) / songSection.chartBars) *
        songSection.chartBars
    const target = songTimeline.events.find(
      (e) =>
        e.sectionIndex === songSection.index &&
        e.chordIndex === i &&
        e.bar >= cycleStart &&
        e.bar < cycleStart + songSection.chartBars,
    )
    if (target) void peekPlayer()?.seek(target.time)
  }

  // Auto-advance. Each chord holds for its own beats at the chosen tempo, so
  // a bar of two chords goes past twice as fast, the way it would in the tune.
  // When following the song, the record is the clock.
  useEffect(() => {
    if (following || !playing || items.length === 0 || !current) return
    const ms = (current.beats * 60_000) / bpm
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % items.length), ms)
    return () => window.clearTimeout(timer)
  }, [playing, index, bpm, items.length, current])

  useEffect(() => {
    if (index >= items.length) setIndex(0)
  }, [items.length, index])

  const guideLine = useMemo(
    () => (items.length > 0 ? guideToneLine(instrument, items.map((x) => x.symbol)) : []),
    [items, instrument],
  )

  const cells = useMemo(
    () => (current ? positionMap(instrument, current.symbol, fretRange) : []),
    [current, instrument, fretRange],
  )

  const roles = useMemo(
    () => (current ? toneRoles(current.symbol, toPitchClass(current.symbol.root)) : []),
    [current],
  )

  const dots: FretboardDot[] = useMemo(() => {
    if (!current) return []
    const guideStep = guideLine[activeIndex]

    return cells
      .filter((cell) => {
        if (mode === 'chord-tones') return cell.kind === 'chord-tone'
        if (mode === 'guide') {
          const bare = cell.label.replace(/[b#]/g, '')
          return cell.kind === 'chord-tone' && (bare === '3' || bare === '7')
        }
        return true
      })
      .map((cell) => {
        const isGuideNote =
          mode === 'guide' &&
          guideStep !== undefined &&
          guideStep.note.string === cell.string &&
          guideStep.note.fret === cell.fret

        if (mode === 'target') {
          const bare = cell.label.replace(/[b#]/g, '')
          const hit = bare === String(target)
          return {
            string: cell.string,
            fret: cell.fret,
            label: hit ? cell.label : '',
            role: hit ? roleForLabel(cell.label) : ('ghost' as const),
            outline: !hit,
          }
        }

        return {
          string: cell.string,
          fret: cell.fret,
          label: cell.label,
          role:
            cell.kind === 'chord-tone'
              ? roleForLabel(cell.label)
              : cell.kind === 'avoid'
                ? ('avoid' as const)
                : ('tension' as const),
          outline: cell.kind !== 'chord-tone' && !isGuideNote,
        }
      })
  }, [cells, mode, target, current, guideLine, activeIndex])

  const scale = current ? scaleForChord(current.symbol) : null
  const avoidNotes = roles.filter((r) => r.kind === 'avoid')

  return (
    <>
      <p className="lede">
        Lock your hand to one position and watch the same frets change meaning as the
        chords go by.
      </p>

      <section className="controls">
        {songTimeline && session.pkg ? (
          <label className="checkbox">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            follow {session.pkg.title}
          </label>
        ) : null}
        <label className="chart-input">
          Changes
          <input
            value={effectiveChart}
            onChange={(e) => setChartText(e.target.value)}
            spellCheck={false}
            disabled={following}
            title={following ? 'The chart comes from the song while following it' : undefined}
          />
        </label>
        <label>
          Key
          <input
            className="key-input"
            value={effectiveKey}
            onChange={(e) => setKeyText(e.target.value)}
            spellCheck={false}
            disabled={following}
          />
        </label>
        <label>
          Position
          <select value={positionIndex} onChange={(e) => setPositionIndex(Number(e.target.value))}>
            {POSITIONS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {mode === 'target' ? (
          <label>
            Land on
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {[1, 3, 5, 7, 9].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? 'the root' : `the ${d}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Guitar
          <select value={guitarIndex} onChange={(e) => setGuitarIndex(Number(e.target.value))}>
            {GUITARS.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {parsed.error ? (
        <p className="no">{parsed.error}</p>
      ) : (
        <>
          <section className="changes-strip">
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                className={i === activeIndex ? 'change current' : 'change'}
                onClick={() => jumpTo(i)}
              >
                <strong>{chordName(item.symbol)}</strong>
                <em>{item.nashville}</em>
              </button>
            ))}
          </section>

          <section className="board">
            <Fretboard instrument={instrument} fretRange={fretRange} dots={dots} />
          </section>

          <section className="transport">
            <button type="button" onClick={prev}>
              ‹ Prev
            </button>
            <button type="button" className="play" onClick={togglePlay}>
              {isPlaying ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button type="button" onClick={next}>
              Next ›
            </button>
            {following ? (
              <span className="tempo">
                {songEvent ? `bar ${songEvent.bar}` : 'waiting for bar 1'} · tempo is on the Song
                screen
              </span>
            ) : (
              <label className="tempo">
                {bpm} bpm
                <input
                  type="range"
                  min={40}
                  max={160}
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                />
              </label>
            )}
          </section>

          {current ? (
            <section className="panel now">
              <h2>
                {chordName(current.symbol)} · {current.nashville} in {keyName(parsed.key)}
              </h2>
              <p className="scale-name">
                {scale?.name} · {MODES.find((m) => m.id === mode)!.hint}
              </p>

              <ul className="tone-key">
                {roles.map((role) => (
                  <li key={role.pitchClass} className={`tone ${role.kind}`}>
                    <span className={`deg deg-${role.label.replace(/[b#]/g, '')}`}>
                      {role.label}
                    </span>
                    <span className="meta">{role.why}</span>
                  </li>
                ))}
              </ul>

              {avoidNotes.length === 0 ? (
                <p className="meta">
                  Nothing in this scale leans on a chord tone — every note is fair game.
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
