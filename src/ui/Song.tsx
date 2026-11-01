/**
 * The Song screen: a record, its stems on faders, a tempo that bends.
 *
 * A song package is the record split into stems by the import tool. Here the
 * stems play together through one stretcher, so you can pull Chet out of the
 * mix, slow what is left to a tempo you can play at, loop the eight bars that
 * are giving you trouble, and come back up a few percent at a time. The chart
 * and the theory arrive in the next stage; this screen is the instrument they
 * will sit on.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { SongPlayer, type StemState } from '../audio/engine.js'
import {
  deleteStoredSong,
  directoryPickerAvailable,
  importFromDirectory,
  importFromFileList,
  listDevSongs,
  listStoredSongs,
  openSong,
  opfsAvailable,
  pickDirectory,
  type SongSource,
  type SongSummary,
} from '../audio/store.js'
import { beatInterval, formatTime, snapToBeat, stemLabel } from '../song/model.js'

const RATE_MIN = 50
const RATE_MAX = 110

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** A level in 0..1 as a meter width: -60 dB is empty, 0 dB is full. */
const meterWidth = (rms: number): string => {
  if (rms <= 0) return '0%'
  const db = 20 * Math.log10(rms)
  return `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100)).toFixed(0)}%`
}

export default function Song() {
  const playerRef = useRef<SongPlayer | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [library, setLibrary] = useState<SongSummary[]>([])
  const [source, setSource] = useState<SongSource | null>(null)
  const [stems, setStems] = useState<StemState[]>([])
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(100)
  const [loopA, setLoopA] = useState<number | null>(null)
  const [loopB, setLoopB] = useState<number | null>(null)
  const [countIn, setCountIn] = useState(true)
  const [snap, setSnap] = useState(true)

  const player = () => {
    if (!playerRef.current) {
      playerRef.current = new SongPlayer()
      // A handle for poking at the graph from the console while developing.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __songPlayer?: SongPlayer }).__songPlayer = playerRef.current
      }
    }
    return playerRef.current
  }

  const refreshLibrary = useCallback(async () => {
    const [stored, dev] = await Promise.all([listStoredSongs(), listDevSongs()])
    setLibrary([...stored, ...dev])
  }, [])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  useEffect(() => () => playerRef.current?.dispose(), [])

  // Follow the player's clock, and read the meters a few times a second.
  useEffect(() => {
    const p = playerRef.current
    if (!p || !source) return
    const off = p.onTick(() => {
      setPosition(p.position)
      setPlaying(p.playing)
    })
    const meter = window.setInterval(() => setLevels(p.levels()), 66)
    return () => {
      off()
      window.clearInterval(meter)
    }
  }, [source])

  const open = async (summary: SongSummary) => {
    setBusy(`Loading ${summary.title}…`)
    setNotice(null)
    try {
      const src = await openSong(summary)
      const inputs = await Promise.all(
        src.pkg.stems.map(async (s) => ({
          id: s.id,
          label: stemLabel(s),
          bytes: await src.read(s.file),
        })),
      )
      const p = player()
      await p.load(inputs)
      await p.setRate(rate / 100)
      setSource(src)
      setStems(p.stemStates())
      setDuration(p.duration)
      setPosition(0)
      setPlaying(false)
      setLoopA(null)
      setLoopB(null)
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(null)
    }
  }

  const finishImport = async (job: Promise<SongSummary>) => {
    setBusy('Copying the package in…')
    setNotice(null)
    try {
      const summary = await job
      await refreshLibrary()
      await open(summary)
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(null)
    }
  }

  const importFolder = async () => {
    if (!directoryPickerAvailable()) {
      fileInput.current?.click()
      return
    }
    try {
      const dir = await pickDirectory()
      await finishImport(importFromDirectory(dir))
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') setNotice(message(error))
    }
  }

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) void finishImport(importFromFileList(files))
    event.target.value = ''
  }

  const remove = async (summary: SongSummary) => {
    if (
      !window.confirm(
        `Remove "${summary.title}" from this browser? The folder on disk is untouched.`,
      )
    ) {
      return
    }
    await deleteStoredSong(summary.slug)
    if (source?.summary.origin === 'opfs' && source.summary.slug === summary.slug) {
      player().unload()
      setSource(null)
      setStems([])
    }
    await refreshLibrary()
  }

  const pkg = source?.pkg ?? null
  const interval = pkg ? beatInterval(pkg) : null

  const togglePlay = async () => {
    const p = playerRef.current
    if (!p || !pkg) return
    if (p.playing) await p.pause()
    else if (countIn && interval) await p.countIn(pkg.beatsPerBar, interval / (rate / 100))
    else await p.play()
  }

  const scrub = (event: ChangeEvent<HTMLInputElement>) => {
    const t = Number(event.target.value)
    setPosition(t)
    void playerRef.current?.seek(t)
  }

  const changeRate = (event: ChangeEvent<HTMLInputElement>) => {
    const r = Number(event.target.value)
    setRate(r)
    void playerRef.current?.setRate(r / 100)
  }

  const maybeSnap = (t: number) => (snap && pkg ? snapToBeat(t, pkg.beatCandidates) : t)

  const applyLoop = (a: number | null, b: number | null) => {
    void playerRef.current?.setLoop(a !== null && b !== null && b > a ? { start: a, end: b } : null)
  }

  const markA = () => {
    const a = maybeSnap(position)
    setLoopA(a)
    applyLoop(a, loopB)
  }

  const markB = () => {
    const b = maybeSnap(position)
    setLoopB(b)
    applyLoop(loopA, b)
  }

  const clearLoop = () => {
    setLoopA(null)
    setLoopB(null)
    applyLoop(null, null)
  }

  const toggleMute = (id: string) => {
    const p = playerRef.current
    const stem = stems.find((s) => s.id === id)
    if (!p || !stem) return
    p.setMuted(id, !stem.muted)
    setStems(p.stemStates())
  }

  const setGain = (id: string, value: number) => {
    const p = playerRef.current
    if (!p) return
    p.setGain(id, value)
    setStems(p.stemStates())
  }

  // Space plays and pauses, unless you are in a control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !source) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
      event.preventDefault()
      void togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const loopBroken = loopA !== null && loopB !== null && loopB <= loopA

  return (
    <>
      <p className="lede">
        The record, split into its players. Take the part out, slow the rest down to where
        you can play it, loop the hard bars, and creep the tempo back up.
      </p>

      <div className="song-layout">
        <aside className="panel library">
          <h2>Songs</h2>
          {library.length === 0 ? (
            <p className="empty-panel">
              Nothing here yet. Import a package folder: the one the import tool wrote, with
              its song.json and stems.
            </p>
          ) : (
            <ul>
              {library.map((s) => (
                <li key={`${s.origin}:${s.slug}`}>
                  <button
                    type="button"
                    className={
                      source && source.summary.slug === s.slug && source.summary.origin === s.origin
                        ? 'song-pick current'
                        : 'song-pick'
                    }
                    onClick={() => void open(s)}
                    disabled={busy !== null}
                  >
                    {s.title}
                    <small>
                      {[s.artist, s.origin === 'dev' ? 'dev folder' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </button>
                  {s.origin === 'opfs' ? (
                    <button
                      type="button"
                      className="song-remove"
                      onClick={() => void remove(s)}
                      title="Remove from this browser"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="controls">
            <button
              type="button"
              onClick={() => void importFolder()}
              disabled={!opfsAvailable() || busy !== null}
            >
              Import a song folder
            </button>
          </div>
          {!opfsAvailable() ? (
            <p className="empty-panel">This browser cannot keep songs. Chrome or Edge can.</p>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={importFiles}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
        </aside>

        <section className="panel song-main">
          {!pkg ? (
            <p className="empty-panel">{busy ?? 'Pick a song.'}</p>
          ) : (
            <>
              <div className="song-head">
                <h2>{pkg.title}</h2>
                <p className="song-meta">
                  {[
                    pkg.artist,
                    pkg.year,
                    pkg.key ? `key of ${pkg.key}` : null,
                    pkg.tempoBpm ? `about ${Math.round(pkg.tempoBpm)} bpm` : null,
                    formatTime(duration),
                  ]
                    .filter((x) => x !== null && x !== undefined)
                    .join(' · ')}
                </p>
              </div>

              <input
                className="scrub"
                type="range"
                min={0}
                max={duration || 1}
                step={0.01}
                value={position}
                onChange={scrub}
                aria-label="Position"
              />

              <div className="transport">
                <button type="button" className="play" onClick={() => void togglePlay()}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button type="button" onClick={() => void playerRef.current?.stop()}>
                  Stop
                </button>
                <span className="time">
                  {formatTime(position)} / {formatTime(duration)}
                </span>
                <label className="tempo">
                  tempo {rate}%
                  <input
                    type="range"
                    min={RATE_MIN}
                    max={RATE_MAX}
                    step={1}
                    value={rate}
                    onChange={changeRate}
                    aria-label="Tempo percent"
                  />
                </label>
              </div>

              <div className="controls">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={countIn}
                    disabled={!interval}
                    onChange={(e) => setCountIn(e.target.checked)}
                  />
                  count-in{' '}
                  {interval ? `(${pkg.beatsPerBar} clicks)` : '(this package has no tempo)'}
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snap}
                    disabled={pkg.beatCandidates.length === 0}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                  snap loop points to beats
                </label>
              </div>

              <div className="loop">
                <button type="button" onClick={markA}>
                  A = here
                </button>
                <button type="button" onClick={markB}>
                  B = here
                </button>
                <button
                  type="button"
                  onClick={clearLoop}
                  disabled={loopA === null && loopB === null}
                >
                  Clear loop
                </button>
                <span className="time">
                  {loopA !== null ? formatTime(loopA) : '–'} to{' '}
                  {loopB !== null ? formatTime(loopB) : '–'}
                  {loopBroken ? ' (B has to come after A)' : ''}
                </span>
              </div>

              <h2>Stems</h2>
              <ul className="mixer">
                {stems.map((s) => {
                  const spec = pkg.stems.find((x) => x.id === s.id)
                  const lead = spec?.role === 'lead'
                  return (
                    <li key={s.id} className={s.muted ? 'mixer-row muted' : 'mixer-row'}>
                      <button
                        type="button"
                        className={lead ? 'mute lead' : 'mute'}
                        aria-pressed={s.muted}
                        onClick={() => toggleMute(s.id)}
                      >
                        {s.muted ? 'Muted' : 'On'}
                      </button>
                      <span className="stem-name">
                        {s.label}
                        {lead ? <small> · the part</small> : null}
                      </span>
                      <input
                        className="fader"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(s.gain * 100)}
                        onChange={(e) => setGain(s.id, Number(e.target.value) / 100)}
                        aria-label={`${s.label} level`}
                      />
                      <span className="meter" aria-hidden="true">
                        <span
                          className="meter-fill"
                          style={{ width: meterWidth(levels[s.id] ?? 0) }}
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {busy && pkg ? <p className="empty-panel">{busy}</p> : null}
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </div>
    </>
  )
}
