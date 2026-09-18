/**
 * A chord box.
 *
 * The small vertical diagram every chord book uses, drawn from the engine's own
 * output rather than from a stored picture — so a barre appears because the
 * fingering solver put one there, and the degree labels are the ones the
 * identifier worked out.
 *
 * Dots carry their degree, coloured by function, for the same reason they do on
 * the neck view: browsing a page of voicings is far more useful when you can see
 * at a glance which one puts the third on top.
 */

import { useMemo } from 'react'
import type { StringNumber } from '../guitar/instrument.js'
import type { Voicing } from '../guitar/voicing.js'
import type { Fingering } from '../hands/fingering.js'
import { boxStartFor, chordBoxLayout } from './layout.js'
import { roleForLabel, type DotRole } from './Fretboard.js'

export interface ChordDiagramProps {
  voicing: Voicing
  fingering?: Fingering
  /** Degree label per string, e.g. { 6: 'R', 4: '7' }. */
  labels?: Map<StringNumber, string>
  /** 'degree' shows R/3/7, 'finger' shows which digit, T for thumb. */
  labelWith?: 'degree' | 'finger' | 'none'
  width?: number
  stringCount?: number
}

const FINGER_NAMES: Record<number, string> = { 0: 'T', 1: '1', 2: '2', 3: '3', 4: '4' }

export function ChordDiagram({
  voicing,
  fingering,
  labels,
  labelWith = 'degree',
  width = 132,
  stringCount = 6,
}: ChordDiagramProps) {
  const frets = voicing.notes.map((n) => n.fret)
  const firstFret = boxStartFor(frets)
  const layout = useMemo(
    () => chordBoxLayout({ firstFret, width, stringCount }),
    [firstFret, width, stringCount],
  )

  const sounding = new Set(voicing.notes.map((n) => n.string))
  const fingerOf = new Map<string, number>()
  for (const assignment of fingering?.assignments ?? []) {
    for (const note of assignment.notes) {
      fingerOf.set(`${note.string}:${note.fret}`, assignment.finger)
    }
  }

  const barres = (fingering?.assignments ?? []).filter((a) => a.barreSpan)

  const labelFor = (string: StringNumber, fret: number): string => {
    if (labelWith === 'none') return ''
    if (labelWith === 'finger') {
      const finger = fingerOf.get(`${string}:${fret}`)
      return finger === undefined ? '' : FINGER_NAMES[finger] ?? ''
    }
    return labels?.get(string) ?? ''
  }

  return (
    <svg
      className="chord-box"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={width}
      role="img"
      aria-label="Chord diagram"
    >
      {/* Position marker, when the box starts up the neck. */}
      {!layout.showNut ? (
        <text className="box-position" x={10} y={layout.top + 15} textAnchor="middle">
          {layout.firstFret}
        </text>
      ) : null}

      {/* Frets. */}
      {layout.fretY.map((y, index) => (
        <line
          key={`fret-${index}`}
          className={index === 0 && layout.showNut ? 'box-nut' : 'box-fret'}
          x1={layout.left}
          x2={layout.right}
          y1={y}
          y2={y}
        />
      ))}

      {/* Strings. */}
      {[...layout.stringX.entries()].map(([string, x]) => (
        <line
          key={`string-${string}`}
          className="box-string"
          x1={x}
          x2={x}
          y1={layout.top}
          y2={layout.bottom}
        />
      ))}

      {/* Open and muted markers above the box. */}
      {Array.from({ length: stringCount }, (_, i) => (i + 1) as StringNumber).map((string) => {
        const x = layout.stringX.get(string)!
        const note = voicing.notes.find((n) => n.string === string)
        if (!sounding.has(string)) {
          return (
            <text key={`mark-${string}`} className="box-mute" x={x} y={layout.top - 6} textAnchor="middle">
              ×
            </text>
          )
        }
        if (note && note.fret === 0) {
          return (
            <circle key={`mark-${string}`} className="box-open" cx={x} cy={layout.top - 10} r={4} />
          )
        }
        return null
      })}

      {/* Barres, drawn under the dots. */}
      {barres.map((assignment, index) => {
        const y = layout.dotY.get(assignment.fret)
        if (y === undefined) return null
        const [low, high] = assignment.barreSpan!
        const x1 = layout.stringX.get(low)!
        const x2 = layout.stringX.get(high)!
        return (
          <line
            key={`barre-${index}`}
            className="box-barre"
            x1={Math.min(x1, x2)}
            x2={Math.max(x1, x2)}
            y1={y}
            y2={y}
          />
        )
      })}

      {/* Dots. */}
      {voicing.notes
        .filter((note) => note.fret > 0)
        .map((note) => {
          const cx = layout.stringX.get(note.string)
          const cy = layout.dotY.get(note.fret)
          if (cx === undefined || cy === undefined) return null
          const degree = labels?.get(note.string) ?? ''
          const role: DotRole = roleForLabel(degree)
          const text = labelFor(note.string, note.fret)
          return (
            <g key={`dot-${note.string}`} className={`box-dot role-${role}`}>
              <circle cx={cx} cy={cy} r={8.5} className="dot-shape" />
              {text ? (
                <text x={cx} y={cy + 3} textAnchor="middle" className="box-dot-label">
                  {text}
                </text>
              ) : null}
            </g>
          )
        })}
    </svg>
  )
}
