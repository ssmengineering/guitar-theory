/**
 * The reading material, rendered.
 *
 * Every figure here is produced by the same engine functions the tools call —
 * `positionMap` for the tone maps, `chordDictionary` for the chord boxes,
 * `shapesFor` for the interval moves, the quality registry for the formula
 * tables. None of it is a picture of a diagram. That means the reading cannot
 * quietly disagree with the tool, which is the usual failure of a manual
 * written alongside software.
 */

import { useMemo, type ReactNode } from 'react'
import { FENDER } from '../guitar/instrument.js'
import { positionMap, shapesFor, describeShape } from '../guitar/shapes.js'
import { parseChord, qualityByName } from '../notes/chord.js'
import { degreeLabel, type Interval } from '../notes/interval.js'
import * as Intervals from '../notes/interval.js'
import { STANDARD_HAND } from '../hands/profiles.js'
import { chordDictionary } from '../hands/dictionary.js'
import { LESSONS, type Block, type Lesson, type ScreenId } from '../learn/lessons.js'
import { Fretboard, roleForLabel, type FretboardDot } from './Fretboard.js'
import { ChordDiagram } from './ChordDiagram.js'
import type { StringNumber } from '../guitar/instrument.js'

/** **bold** and `code`, which is all the prose needs. */
function formatted(body: string): ReactNode[] {
  return body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**')) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>
    }
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return <code key={index}>{piece.slice(1, -1)}</code>
    }
    return piece
  })
}

const INTERVALS: Record<string, Interval> = {
  m2: Intervals.m2, M2: Intervals.M2, m3: Intervals.m3, M3: Intervals.M3,
  P4: Intervals.P4, P5: Intervals.P5, m6: Intervals.m6, M6: Intervals.M6,
  m7: Intervals.m7, M7: Intervals.M7,
}

function Figure({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <figure className="lesson-figure">
      <div className="lesson-figure-body">{children}</div>
      {caption ? <figcaption>{formatted(caption)}</figcaption> : null}
    </figure>
  )
}

function BlockView({ block, onGo }: { block: Block; onGo: (s: ScreenId) => void }) {
  switch (block.kind) {
    case 'text':
      return <p className="lesson-text">{formatted(block.body)}</p>

    case 'note':
      return <aside className="lesson-note">{formatted(block.body)}</aside>

    case 'fretboard': {
      const dots: FretboardDot[] = block.dots.map((dot) => ({
        string: dot.string,
        fret: dot.fret,
        label: dot.label,
        role: dot.ghost ? 'ghost' : roleForLabel(dot.label),
        outline: dot.ghost,
      }))
      return (
        <Figure caption={block.caption}>
          <Fretboard instrument={FENDER} fretRange={block.fretRange} dots={dots} />
        </Figure>
      )
    }

    case 'chordmap': {
      const chord = parseChord(block.chord)
      const cells = positionMap(FENDER, chord, block.fretRange)
      const dots: FretboardDot[] = cells.map((cell) => ({
        string: cell.string,
        fret: cell.fret,
        label: cell.label,
        role:
          cell.kind === 'chord-tone'
            ? roleForLabel(cell.label)
            : cell.kind === 'avoid'
              ? 'avoid'
              : 'tension',
        outline: cell.kind !== 'chord-tone',
      }))
      return (
        <Figure caption={block.caption}>
          <Fretboard instrument={FENDER} fretRange={block.fretRange} dots={dots} />
        </Figure>
      )
    }

    case 'chords':
      return (
        <ChordRow
          caption={block.caption}
          items={block.items}
          stringSet={block.stringSet}
          fretRange={block.fretRange}
          rootInBass={block.rootInBass}
        />
      )

    case 'formula':
      return <FormulaTable caption={block.caption} qualities={block.qualities} />

    case 'intervalshapes':
      return <IntervalShapes caption={block.caption} interval={block.interval} />

    case 'try':
      return (
        <aside className="lesson-try">
          <p>{formatted(block.body)}</p>
          <button type="button" onClick={() => onGo(block.screen)}>
            Open the {block.screen === 'improv' ? 'Improv' : block.screen === 'dictionary' ? 'Dictionary' : block.screen === 'decoder' ? 'Decoder' : 'Calibration'} screen →
          </button>
        </aside>
      )
  }
}

/**
 * Chord boxes pulled from the generator.
 *
 * Repeating the same chord name asks for successively different voicings of it,
 * which is how the "one chord, many shapes" figure builds itself rather than
 * being hand-drawn.
 */
function ChordRow({
  caption,
  items,
  stringSet,
  fretRange,
  rootInBass,
}: {
  caption?: string
  items: string[]
  stringSet?: StringNumber[]
  fretRange?: [number, number]
  rootInBass?: boolean
}) {
  const boxes = useMemo(() => {
    const seenPerChord = new Map<string, number>()
    return items.map((name) => {
      const chord = parseChord(name)
      // Repeating a name asks for the next voicing down the list, which is how
      // the "one chord, many shapes" figure builds itself.
      const nth = seenPerChord.get(name) ?? 0
      seenPerChord.set(name, nth + 1)
      const entries = chordDictionary(FENDER, chord, STANDARD_HAND, {
        fretRange: fretRange ?? [0, 10],
        moveableOnly: true,
        ...(stringSet ? { stringSets: [stringSet] } : {}),
        ...(rootInBass ? { requireRootInBass: true } : {}),
        limit: nth + 1,
      })
      const entry = entries[Math.min(nth, entries.length - 1)]
      return { name, entry }
    })
  }, [items, stringSet, fretRange, rootInBass])

  return (
    <Figure caption={caption}>
      <div className="lesson-chords">
        {boxes.map(({ name, entry }, index) =>
          entry ? (
            <figure key={`${name}-${index}`} className="lesson-chord">
              <ChordDiagram
                voicing={entry.voicing}
                fingering={entry.fingering}
                labels={
                  new Map<StringNumber, string>(
                    entry.roles.map((r) => [r.note.string, r.label]),
                  )
                }
                width={116}
              />
              <figcaption>{name}</figcaption>
            </figure>
          ) : null,
        )}
      </div>
    </Figure>
  )
}

/** The construction table, read out of the chord registry itself. */
function FormulaTable({ caption, qualities }: { caption?: string; qualities: string[] }) {
  const rows = useMemo(
    () =>
      qualities.map((name) => {
        const quality = qualityByName(name)
        return {
          name,
          suffix: quality.suffix === '' ? '(none)' : quality.suffix,
          degrees: quality.intervals.map(degreeLabel),
        }
      }),
    [qualities],
  )

  return (
    <Figure caption={caption}>
      <table className="lesson-table">
        <thead>
          <tr>
            <th>Written</th>
            <th>Built from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`}>
              <td>
                <code>{row.suffix}</code>
              </td>
              <td className="degrees-cell">
                {row.degrees.map((degree, i) => (
                  <span key={i} className={`deg deg-${degree.replace(/[b#]/g, '')}`}>
                    {degree}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  )
}

/** The physical moves that produce an interval, straight from `shapesFor`. */
function IntervalShapes({ caption, interval }: { caption?: string; interval: string }) {
  const rows = useMemo(() => {
    const target = INTERVALS[interval]
    if (!target) return []
    return shapesFor(FENDER, target, { maxStringSpan: 1, fretRange: [-3, 4] })
      .filter((shape) => shape.lowString <= 6)
      .map((shape) => ({
        from:
          shape.stringSpan === 0
            ? `string ${shape.lowString}`
            : `string ${shape.lowString} to ${shape.highString}`,
        move: describeShape(shape),
        odd: shape.crossesAnomaly,
      }))
  }, [interval])

  return (
    <Figure caption={caption}>
      <table className="lesson-table">
        <thead>
          <tr>
            <th>Starting on</th>
            <th>The move</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={row.odd ? 'odd-pair' : undefined}>
              <td>{row.from}</td>
              <td>
                {row.move}
                {row.odd ? <em> — crosses G to B</em> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  )
}

export default function Learn({
  onGo,
  lessonId,
  onSelect,
}: {
  onGo: (screen: ScreenId) => void
  lessonId: string | null
  onSelect: (id: string | null) => void
}) {
  const lesson: Lesson | undefined = LESSONS.find((l) => l.id === lessonId)
  const position = LESSONS.findIndex((l) => l.id === lessonId)

  if (!lesson) {
    return (
      <>
        <p className="lede">
          The vocabulary the rest of the app uses, starting from the neck rather than
          from first principles. Nine short pieces — read them in order the first time.
        </p>
        <ol className="lesson-index">
          {LESSONS.map((item, index) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSelect(item.id)}>
                <span className="lesson-number">{index + 1}</span>
                <span className="lesson-titles">
                  <strong>{item.title}</strong>
                  <em>{item.summary}</em>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </>
    )
  }

  return (
    <article className="lesson">
      <button type="button" className="lesson-back" onClick={() => onSelect(null)}>
        ‹ All topics
      </button>

      <header className="lesson-header">
        <p className="lesson-position">
          {position + 1} of {LESSONS.length}
        </p>
        <h2>{lesson.title}</h2>
      </header>

      {lesson.blocks.map((block, index) => (
        <BlockView key={index} block={block} onGo={onGo} />
      ))}

      <nav className="lesson-nav">
        <button
          type="button"
          disabled={position <= 0}
          onClick={() => onSelect(LESSONS[position - 1]?.id ?? null)}
        >
          ‹ {LESSONS[position - 1]?.title ?? ''}
        </button>
        <button
          type="button"
          disabled={position >= LESSONS.length - 1}
          onClick={() => onSelect(LESSONS[position + 1]?.id ?? null)}
        >
          {LESSONS[position + 1]?.title ?? ''} ›
        </button>
      </nav>
    </article>
  )
}
