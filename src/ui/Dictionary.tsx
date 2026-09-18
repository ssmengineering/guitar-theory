/**
 * The generated chord dictionary.
 *
 * Chord Chemistry is about two thousand voicings fingered for a conventional
 * hand. Filtering that book throws away most of it AND misses everything a
 * different hand can do that a conventional one cannot, so this generates
 * instead: every voicing the guitar allows, ranked by what it costs YOUR hands.
 *
 * The two filters are Ted Greene's two organising axes — which strings you are
 * on, and what is in the melody. Those are the questions you actually have when
 * harmonising a tune, and they are the reason the book is laid out the way it is.
 */

import { useMemo, useState } from 'react'
import {
  FENDER,
  GIBSON,
  SCALE_LENGTHS,
  guitar,
  type StringNumber,
} from '../guitar/instrument.js'
import { generateVoicings, stringSetKey } from '../guitar/generate.js'
import { chordName, parseChord, QUALITIES } from '../notes/chord.js'
import { degreeLabel } from '../notes/interval.js'
import { MY_HAND, STANDARD_HAND } from '../hands/profiles.js'
import { chordDictionary, explain } from '../hands/dictionary.js'
import { describeFingering } from '../hands/fingering.js'
import { ChordDiagram } from './ChordDiagram.js'

const GUITARS = [
  { name: 'Fender scale (25.5")', instrument: FENDER },
  { name: 'Gibson scale (24.75")', instrument: GIBSON },
  { name: 'Gretsch scale (24.6")', instrument: guitar('Gretsch', SCALE_LENGTHS.gretsch) },
]

const HANDS = [MY_HAND, STANDARD_HAND]

/** The sets worth offering. The last two skip a string, which fingerstyle gets free. */
const STRING_SETS: { label: string; set: StringNumber[] | null }[] = [
  { label: 'Any', set: null },
  { label: '6-5-4-3', set: [3, 4, 5, 6] },
  { label: '5-4-3-2', set: [2, 3, 4, 5] },
  { label: '4-3-2-1', set: [1, 2, 3, 4] },
  { label: '6-4-3-2', set: [2, 3, 4, 6] },
  { label: '5-4-2-1', set: [1, 2, 4, 5] },
]

const SUGGESTIONS = ['Cmaj7', 'Am7', 'G7', 'Dm9', 'F6/9', 'Bm7b5', 'C7#9']

export default function Dictionary() {
  const [text, setText] = useState('Cmaj7')
  const [guitarIndex, setGuitarIndex] = useState(0)
  const [handIndex, setHandIndex] = useState(0)
  const [stringSetIndex, setStringSetIndex] = useState(0)
  const [topDegree, setTopDegree] = useState<number | null>(null)
  const [moveableOnly, setMoveableOnly] = useState(true)
  const [labelWith, setLabelWith] = useState<'degree' | 'finger'>('degree')

  const instrument = GUITARS[guitarIndex]!.instrument
  const hand = HANDS[handIndex]!

  const parsed = useMemo(() => {
    try {
      return { chord: parseChord(text), error: null as string | null }
    } catch (error) {
      return { chord: null, error: (error as Error).message }
    }
  }, [text])

  // Only offer melody notes the chord actually has.
  const availableTops = useMemo(
    () => parsed.chord?.intervals.map((i) => ({ degree: i.degree, label: degreeLabel(i) })) ?? [],
    [parsed.chord],
  )

  const options = useMemo(
    () => ({
      fretRange: [0, 12] as [number, number],
      stringSets: STRING_SETS[stringSetIndex]!.set
        ? [STRING_SETS[stringSetIndex]!.set!]
        : undefined,
      ...(topDegree === null ? {} : { topDegree }),
      moveableOnly,
    }),
    [stringSetIndex, topDegree, moveableOnly],
  )

  /** Every voicing the guitar allows, before any hand is considered. */
  const possible = useMemo(
    () => (parsed.chord ? generateVoicings(instrument, parsed.chord, { ...options, maxResults: 3000 }) : []),
    [parsed.chord, instrument, options],
  )

  const entries = useMemo(
    () =>
      parsed.chord
        ? chordDictionary(instrument, parsed.chord, hand, { ...options, limit: 12 })
        : [],
    [parsed.chord, instrument, hand, options],
  )

  return (
    <>
      <p className="lede">
        Every voicing the guitar allows, ranked by what it costs your hands — not a
        book's hands.
      </p>

      <section className="controls">
        <label className="chord-input">
          Chord
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-invalid={parsed.error !== null}
          />
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
          String set
          <select
            value={stringSetIndex}
            onChange={(e) => setStringSetIndex(Number(e.target.value))}
          >
            {STRING_SETS.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          On top
          <select
            value={topDegree === null ? '' : String(topDegree)}
            onChange={(e) => setTopDegree(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Any</option>
            {availableTops.map((t) => (
              <option key={t.degree} value={t.degree}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Labels
          <select value={labelWith} onChange={(e) => setLabelWith(e.target.value as 'degree')}>
            <option value="degree">Degrees</option>
            <option value="finger">Fingers</option>
          </select>
        </label>
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={moveableOnly}
            onChange={(e) => setMoveableOnly(e.target.checked)}
          />
          Moveable only
        </label>
      </section>

      <section className="suggestions">
        {SUGGESTIONS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === text ? 'chip active' : 'chip'}
            onClick={() => setText(name)}
          >
            {name}
          </button>
        ))}
      </section>

      {parsed.error ? (
        <p className="no">
          {parsed.error} — try something like <code>Cmaj7</code>, <code>F#m7b5</code> or{' '}
          <code>Bb13</code>.
        </p>
      ) : (
        <>
          <p className="tally">
            <strong>{possible.length}</strong> voicings of{' '}
            <strong>{chordName(parsed.chord!)}</strong> exist on the neck under these
            filters. <strong>{entries.length === 12 ? 'The best 12' : `${entries.length}`}</strong>{' '}
            {entries.length === 1 ? 'is' : 'are'} playable by the {hand.name} profile.
          </p>

          {entries.length === 0 ? (
            <p className="no">
              Nothing here works for these hands. Widen the string set, or turn off
              "moveable only" to let open strings in.
            </p>
          ) : (
            <div className="grid">
              {entries.map((entry, index) => {
                const labels = new Map<StringNumber, string>(
                  entry.roles.map((r) => [r.note.string, r.label]),
                )
                return (
                  <figure key={index} className="voicing">
                    <ChordDiagram
                      voicing={entry.voicing}
                      fingering={entry.fingering}
                      labels={labels}
                      labelWith={labelWith}
                    />
                    <figcaption>
                      <span className="voicing-top">
                        top: {degreeLabel(entry.topInterval)}
                        <span className="voicing-set">{stringSetKey(entry.stringSet)}</span>
                      </span>
                      <code>{describeFingering(entry.fingering)}</code>
                      <ul className="reasons">
                        {explain(entry)
                          .slice(0, 2)
                          .map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                      </ul>
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          )}
        </>
      )}
    </>
  )
}

export { QUALITIES }
