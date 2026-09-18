/**
 * The fretboard.
 *
 * Every other screen in this app is a view on this one component: the decoder
 * puts your shape on it, the dictionary puts a generated voicing on it, the
 * improv HUD puts a whole chord's worth of tones on it, and the calibration
 * session puts grips on it for you to mark. So it takes dots and labels and
 * nothing else - it knows about strings and frets, and not about chords.
 *
 * Dots are coloured by FUNCTION, not by note name. That is the one editorial
 * decision baked into the drawing, and it is the same one the whole library
 * makes: the degree is what tells you how a note behaves.
 */

import { useMemo } from 'react'
import type { StringNumber } from '../guitar/instrument.js'
import type { Instrument } from '../guitar/instrument.js'
import {
  DOUBLE_INLAY_FRETS,
  FRET_NUMBER_OFFSET,
  INLAY_FRETS,
  hitTest,
  layoutFretboard,
} from './layout.js'

export type DotRole =
  | 'root'
  | 'third'
  | 'fifth'
  | 'seventh'
  | 'tension'
  /** A scale tone leaning on a chord tone a half step below it. */
  | 'avoid'
  | 'plain'
  | 'ghost'

export interface FretboardDot {
  string: StringNumber
  fret: number
  label?: string
  role?: DotRole
  /** Drawn hollow - a suggestion rather than something you are holding. */
  outline?: boolean
}

export interface FretboardProps {
  instrument: Instrument
  fretRange?: [number, number]
  dots?: FretboardDot[]
  /** Strings crossed out above the nut. */
  muted?: StringNumber[]
  width?: number
  stringGap?: number
  onPick?: (string: StringNumber, fret: number) => void
}

/** Work out a dot's colour family from its degree label. */
export function roleForLabel(label: string | undefined): DotRole {
  if (!label) return 'plain'
  const bare = label.replace(/[b#]/g, '')
  if (bare === 'R' || bare === '1') return 'root'
  if (bare === '3') return 'third'
  if (bare === '5') return 'fifth'
  if (bare === '7') return 'seventh'
  if (bare === '9' || bare === '11' || bare === '13' || bare === '6') return 'tension'
  return 'plain'
}

export function Fretboard({
  instrument,
  fretRange = [0, 12],
  dots = [],
  muted = [],
  width = 860,
  stringGap = 30,
  onPick,
}: FretboardProps) {
  const layout = useMemo(
    () => layoutFretboard({ instrument, fretRange, width, stringGap }),
    [instrument, fretRange[0], fretRange[1], width, stringGap],
  )

  const [low, high] = fretRange
  const strings = [...layout.stringY.entries()]

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * layout.width
    const y = ((event.clientY - rect.top) / rect.height) * layout.height
    const hit = hitTest(layout, x, y, stringGap)
    if (hit) onPick(hit.string, hit.fret)
  }

  return (
    <svg
      className="fretboard"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label="Guitar fretboard"
      onClick={handleClick}
      style={{ cursor: onPick ? 'pointer' : 'default' }}
    >
      {/* Inlays sit behind everything else. */}
      {[...layout.dotX.entries()]
        .filter(([fret]) => fret >= Math.max(1, low))
        .map(([fret, x]) => {
          const middle = (layout.boardTop + layout.boardBottom) / 2
          if (DOUBLE_INLAY_FRETS.includes(fret)) {
            return (
              <g key={`inlay-${fret}`} className="inlay">
                <circle cx={x} cy={middle - stringGap} r={5} />
                <circle cx={x} cy={middle + stringGap} r={5} />
              </g>
            )
          }
          if (INLAY_FRETS.includes(fret)) {
            return <circle key={`inlay-${fret}`} className="inlay" cx={x} cy={middle} r={5} />
          }
          return null
        })}

      {/* Fret wires. */}
      {[...layout.wireX.entries()].map(([fret, x]) => (
        <line
          key={`wire-${fret}`}
          className={fret === 0 && layout.hasOpenColumn ? 'nut' : 'fret-wire'}
          x1={x}
          x2={x}
          y1={layout.boardTop}
          y2={layout.boardBottom}
        />
      ))}

      {/* Strings, thicker as they get lower. */}
      {strings.map(([string, y]) => (
        <line
          key={`string-${string}`}
          className="string"
          x1={layout.hasOpenColumn ? layout.nutX : layout.padding.left}
          x2={layout.width - layout.padding.right}
          y1={y}
          y2={y}
          strokeWidth={0.8 + string * 0.22}
        />
      ))}

      {/* Fret numbers under the board. */}
      {[...layout.dotX.entries()]
        .filter(([fret]) => fret >= Math.max(1, low) && fret <= high)
        .map(([fret, x]) => (
          <text
            key={`num-${fret}`}
            className="fret-number"
            x={x}
            y={layout.boardBottom + FRET_NUMBER_OFFSET}
            textAnchor="middle"
          >
            {fret}
          </text>
        ))}

      {/* Muted strings. */}
      {muted.map((string) => {
        const y = layout.stringY.get(string)
        if (y === undefined) return null
        const x = layout.hasOpenColumn ? layout.padding.left + 12 : layout.padding.left + 6
        return (
          <text key={`mute-${string}`} className="muted-mark" x={x} y={y + 4} textAnchor="middle">
            ×
          </text>
        )
      })}

      {/* Dots. */}
      {dots.map((dot) => {
        const cx = layout.dotX.get(dot.fret)
        const cy = layout.stringY.get(dot.string)
        if (cx === undefined || cy === undefined) return null
        const role = dot.role ?? roleForLabel(dot.label)
        return (
          <g key={`dot-${dot.string}-${dot.fret}`} className={`dot role-${role}`}>
            <circle
              cx={cx}
              cy={cy}
              r={11}
              className={dot.outline ? 'dot-shape outline' : 'dot-shape'}
            />
            {dot.label ? (
              <text x={cx} y={cy + 4} textAnchor="middle" className="dot-label">
                {dot.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
