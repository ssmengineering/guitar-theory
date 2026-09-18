/**
 * The decoder.
 *
 * Put a shape on the neck and the app tells you what it is - in degrees, with
 * every reading it will support, and whether your hands can actually hold it.
 * This was the first tool on the list because it runs the theory backwards:
 * instead of explaining a chord and hoping you find it, it takes what your
 * fingers already do and gives it a name.
 */

import { useMemo, useState } from 'react'
import {
  FENDER,
  GIBSON,
  SCALE_LENGTHS,
  guitar,
  type StringNumber,
} from '../guitar/instrument.js'
import { identifyVoicing, voicing, voicingSpanInches } from '../guitar/voicing.js'
import { spacingOf } from '../guitar/generate.js'
import { chordName, spellPitchClass, type ChordCandidate } from '../notes/chord.js'
import { degreeLabel } from '../notes/interval.js'
import { noteName } from '../notes/pitch.js'
import { MY_HAND, STANDARD_HAND } from '../hands/profiles.js'
import { describeFingering, solveFingerings } from '../hands/fingering.js'
import { Fretboard, roleForLabel, type FretboardDot } from './Fretboard.js'

const GUITARS = [
  { name: 'Fender scale (25.5")', instrument: FENDER },
  { name: 'Gibson scale (24.75")', instrument: GIBSON },
  { name: 'Gretsch scale (24.6")', instrument: guitar('Gretsch', SCALE_LENGTHS.gretsch) },
]

const HANDS = [MY_HAND, STANDARD_HAND]

type Picked = { string: StringNumber; fret: number }
type LabelMode = 'degrees' | 'notes'

/**
 * One phrase for what the voicing leaves out. The completeness tag and the
 * omitted list say the same thing twice if you print both.
 */
function describeCompleteness(reading: ChordCandidate): string {
  const missing = reading.omitted.map(degreeLabel)
  const withoutRoot = missing.filter((m) => m !== 'R')
  switch (reading.completeness) {
    case 'complete':
      return 'every tone present'
    case 'shell':
      return 'shell - root, 3rd and 7th'
    case 'no5':
      return 'no 5th, which nobody misses'
    case 'rootless':
      return withoutRoot.length > 0
        ? `rootless, and no ${withoutRoot.join(', no ')}`
        : 'rootless - the bass would supply it'
    default:
      return `no ${missing.join(', no ')}`
  }
}

export default function Decoder() {
  const [picked, setPicked] = useState<Picked[]>([])
  const [guitarIndex, setGuitarIndex] = useState(0)
  const [handIndex, setHandIndex] = useState(0)
  const [fretRange, setFretRange] = useState<[number, number]>([0, 12])
  const [labels, setLabels] = useState<LabelMode>('degrees')

  const instrument = GUITARS[guitarIndex]!.instrument
  const hand = HANDS[handIndex]!

  function pick(string: StringNumber, fret: number) {
    setPicked((current) => {
      const existing = current.find((p) => p.string === string)
      // One note per string. Clicking the same spot again clears it.
      if (existing && existing.fret === fret) {
        return current.filter((p) => p.string !== string)
      }
      return [...current.filter((p) => p.string !== string), { string, fret }]
    })
  }

  const shape = useMemo(() => {
    if (picked.length === 0) return null
    return voicing(
      instrument,
      picked.map((p) => [p.string, p.fret] as [StringNumber, number]),
    )
  }, [picked, instrument])

  const readings = useMemo(() => (shape ? identifyVoicing(shape, 6) : []), [shape])
  const best = readings[0]

  // Label each picked note with what it does in the best reading.
  const dots: FretboardDot[] = useMemo(() => {
    if (!shape) return []
    const roleByPc = new Map(best?.roles.map((r) => [r.pitchClass, r.label]) ?? [])
    return shape.notes.map((note) => {
      const pc = ((note.midi % 12) + 12) % 12
      const degree = roleByPc.get(pc) ?? ''
      return {
        string: note.string,
        fret: note.fret,
        // The colour always comes from the degree, even when the dot shows a
        // letter - the function is the thing worth seeing at a glance.
        label:
          labels === 'notes' || degree === ''
            ? noteName(spellPitchClass(pc))
            : degree,
        role: roleForLabel(degree),
      }
    })
  }, [shape, best, labels])

  const fingerings = useMemo(
    () => (shape ? solveFingerings(shape, hand, instrument, { maxResults: 3 }) : []),
    [shape, hand, instrument],
  )

  const spacing = shape ? spacingOf(shape) : null

  return (
    <>
      <p className="lede">
        Put a shape on the neck. The app names every chord it could be, in degrees.
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
        <label>
          Hands
          <select value={handIndex} onChange={(e) => setHandIndex(Number(e.target.value))}>
            {HANDS.map((h, i) => (
              <option key={h.name} value={i}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Position
          <select
            value={fretRange.join('-')}
            onChange={(e) => {
              const [a, b] = e.target.value.split('-').map(Number)
              setFretRange([a!, b!])
            }}
          >
            <option value="0-12">Open to 12</option>
            <option value="0-5">Open to 5</option>
            <option value="5-12">5 to 12</option>
            <option value="7-15">7 to 15</option>
          </select>
        </label>
        <label>
          Labels
          <select value={labels} onChange={(e) => setLabels(e.target.value as LabelMode)}>
            <option value="degrees">Degrees</option>
            <option value="notes">Note names</option>
          </select>
        </label>
        <button type="button" onClick={() => setPicked([])} disabled={picked.length === 0}>
          Clear
        </button>
      </section>

      <section className="board">
        <Fretboard
          instrument={instrument}
          fretRange={fretRange}
          dots={dots}
          onPick={pick}
        />
      </section>

      {shape === null ? (
        <p className="empty">Click the neck to place notes. One per string.</p>
      ) : (
        <div className="results">
          <section className="panel">
            <h2>What it could be</h2>
            {readings.length === 0 ? (
              <p className="empty-panel">
                No chord accounts for all of these notes. That is a real answer —
                some collections are passing sounds rather than chords. Take one
                away and see what the rest become.
              </p>
            ) : null}
            <ol className="readings">
              {readings.map((reading, index) => (
                <li key={`${chordName(reading.symbol)}-${index}`}>
                  <span className="chord">{chordName(reading.symbol)}</span>
                  <span className="degrees">
                    {reading.roles.map((r) => (
                      <em key={r.pitchClass} className={`deg deg-${r.label.replace(/[b#]/g, '')}`}>
                        {r.label}
                      </em>
                    ))}
                  </span>
                  <span className="meta">{describeCompleteness(reading)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <h2>Can you hold it?</h2>
            {fingerings.length === 0 ? (
              <p className="no">
                Not with the {hand.name} profile — no assignment of these digits reaches it.
              </p>
            ) : (
              <ul className="fingerings">
                {fingerings.map((f, index) => (
                  <li key={index}>
                    <code>{describeFingering(f)}</code>
                    <span className="meta">
                      cost {f.cost.toFixed(2)}
                      {f.strategies.length > 0 ? ` · ${f.strategies.join(' ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="facts">
              <div>
                <dt>Span</dt>
                <dd>
                  {shape.fretSpan} frets · {voicingSpanInches(shape, instrument).toFixed(2)}″
                </dd>
              </div>
              <div>
                <dt>Strings</dt>
                <dd>{[...shape.stringSet].sort((a, b) => b - a).join('-')}</dd>
              </div>
              <div>
                <dt>Spacing</dt>
                <dd>
                  {spacing && spacing.notes.length > 0 ? spacing.notes[0] : 'clean'}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </>
  )
}
