/**
 * The calibration session.
 *
 * Play the grip, say how it went. That is the whole interaction, and it is the
 * right one: the alternative is asking you to estimate your own hand in inches,
 * which nobody can do.
 *
 * Answers live in localStorage so a session can be abandoned and picked up
 * later — it is worth doing properly with a guitar in your hands rather than
 * rushed in one sitting.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { FENDER, GIBSON, SCALE_LENGTHS, guitar } from '../guitar/instrument.js'
import { MY_HAND } from '../hands/profiles.js'
import {
  buildProbes,
  fitHand,
  profileSource,
  type ProbeResult,
  type Verdict,
} from '../hands/calibration.js'
import { Fretboard, type FretboardDot } from './Fretboard.js'

const GUITARS = [
  { name: 'Fender scale (25.5")', instrument: FENDER },
  { name: 'Gibson scale (24.75")', instrument: GIBSON },
  { name: 'Gretsch scale (24.6")', instrument: guitar('Gretsch', SCALE_LENGTHS.gretsch) },
]

const STORAGE_KEY = 'guitar-theory.calibration.v1'

const VERDICTS: { id: Verdict; label: string; hint: string }[] = [
  { id: 'comfortable', label: 'Comfortable', hint: 'I could play this all night' },
  { id: 'awkward', label: 'Awkward', hint: 'I can do it, but I would avoid it' },
  { id: 'impossible', label: "Can't do it", hint: 'Not happening' },
]

/** localStorage can throw or come back empty, so every access is guarded. */
function loadResults(): ProbeResult[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ProbeResult[]) : []
  } catch {
    return []
  }
}

function saveResults(results: ProbeResult[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(results))
  } catch {
    // A session that cannot be saved still works; it just will not resume.
  }
}

export default function Calibration() {
  const [guitarIndex, setGuitarIndex] = useState(0)
  const [results, setResults] = useState<ProbeResult[]>(loadResults)
  const [index, setIndex] = useState(0)

  const instrument = GUITARS[guitarIndex]!.instrument
  const groups = useMemo(() => buildProbes(instrument), [instrument])
  const probes = useMemo(() => groups.flatMap((g) => g.probes), [groups])

  useEffect(() => saveResults(results), [results])

  // Twenty-one probes is a long way to scroll. Bring each new one up to the
  // top so answering never leaves you looking at empty page.
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => {
    headRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [index])

  const probe = probes[index]
  const group = probe ? groups.find((g) => g.probes.includes(probe))! : null
  const verdicts = useMemo(
    () => new Map(results.map((r) => [r.probeId, r.verdict])),
    [results],
  )

  const fit = useMemo(
    () => fitHand(MY_HAND, results, instrument),
    [results, instrument],
  )

  function answer(verdict: Verdict) {
    if (!probe) return
    setResults((current) => [
      ...current.filter((r) => r.probeId !== probe.id),
      { probeId: probe.id, verdict },
    ])
    setIndex((i) => Math.min(i + 1, probes.length))
  }

  const dots: FretboardDot[] = probe
    ? probe.positions.map(([string, fret]) => ({ string, fret, role: 'plain' as const }))
    : []

  const lowestFret = probe ? Math.min(...probe.positions.map(([, f]) => f)) : 0
  const highestFret = probe ? Math.max(...probe.positions.map(([, f]) => f)) : 12
  const fretRange: [number, number] = [
    Math.max(0, lowestFret - 2),
    Math.min(instrument.fretCount, highestFret + 2),
  ]

  const done = index >= probes.length

  return (
    <>
      <p className="lede">
        Play each grip and say how it went. Nothing here is a test — "can't do it"
        is as useful an answer as any other, and more useful than a guess.
      </p>

      <section className="controls">
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
        <button
          type="button"
          onClick={() => {
            setResults([])
            setIndex(0)
          }}
          disabled={results.length === 0}
        >
          Start over
        </button>
      </section>

      <div className="progress">
        <div className="progress-bar">
          <span style={{ width: `${(results.length / probes.length) * 100}%` }} />
        </div>
        <span className="progress-count">
          {results.length} of {probes.length} answered
        </span>
      </div>

      {probe && group ? (
        <>
          <section className="probe-head" ref={headRef}>
            <h2>{group.title}</h2>
            <p className="why">{group.why}</p>
          </section>

          <section className="board">
            <Fretboard
              instrument={instrument}
              fretRange={fretRange}
              dots={dots}
              width={640}
            />
          </section>

          <section className="probe-body">
            <p className="asks">{probe.asks}</p>
            <p className="suggestion">{probe.suggestion}</p>

            <div className="verdicts">
              {VERDICTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={
                    verdicts.get(probe.id) === v.id ? `verdict ${v.id} chosen` : `verdict ${v.id}`
                  }
                  onClick={() => answer(v.id)}
                >
                  <strong>{v.label}</strong>
                  <em>{v.hint}</em>
                </button>
              ))}
            </div>

            <div className="probe-nav">
              <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
                Back
              </button>
              <span className="meta">
                {index + 1} of {probes.length}
              </span>
              <button type="button" onClick={() => setIndex((i) => i + 1)}>
                Skip
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="panel done">
          <h2>{done ? 'Session complete' : 'Nothing to show'}</h2>
          <p>
            {fit.answered} of {fit.total} probes answered.
          </p>
          <button type="button" onClick={() => setIndex(0)}>
            Go through them again
          </button>
        </section>
      )}

      {fit.changes.length > 0 ? (
        <section className="panel fitted">
          <h2>What your answers changed</h2>
          <ul className="changes">
            {fit.changes.map((change) => (
              <li key={change.parameter}>
                <span className="change-label">{change.label}</span>
                <span className="change-values">
                  <s>{change.before}</s> → <strong>{change.after}</strong>
                </span>
                <span className="meta">{change.note}</span>
              </li>
            ))}
          </ul>
          <details>
            <summary>The fitted profile</summary>
            <pre>{profileSource(fit.hand)}</pre>
            <p className="meta">
              Paste these into <code>MY_HAND</code> in <code>src/hands/profiles.ts</code> to
              make them permanent. Every value marked CALIBRATE there is one of these.
            </p>
          </details>
        </section>
      ) : null}
    </>
  )
}
