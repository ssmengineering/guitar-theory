/**
 * The chart and the form.
 *
 * A chart is typed the way a chart is written: bars between pipes, chords
 * inside a bar sharing it evenly. The form is a list of sections, each a run
 * of bars that plays one chart - a chorus played twice is one section twice
 * as long as its chart, and the chart cycles. Handwritten tabs put the chord
 * names over the first chorus only, so this is exactly what there is to copy.
 */

import { useState } from 'react'
import { parseChart } from '../notes/progression.js'
import type { SongPackage, SongSection } from '../song/model.js'
import { parseKeyText, type Timeline } from '../song/timeline.js'

interface Props {
  pkg: SongPackage
  timeline: Timeline
  onChange: (update: (pkg: SongPackage) => SongPackage) => void
}

const BEATS_PER_BAR = [2, 3, 4, 6]

/** How a chart reads on its own, before it meets the bar map. */
function chartStatus(pkg: SongPackage, text: string): { ok: boolean; note: string } {
  if (text.trim() === '') return { ok: false, note: 'empty' }
  try {
    const key = parseKeyText(pkg.key ?? 'C')
    const bars = parseChart(key, text, pkg.beatsPerBar).bars.length
    return { ok: true, note: `${bars} bar${bars === 1 ? '' : 's'}` }
  } catch (error) {
    return { ok: false, note: (error as Error).message }
  }
}

export default function SongChart({ pkg, timeline, onChange }: Props) {
  const [newChartName, setNewChartName] = useState('')
  const chartNames = Object.keys(pkg.charts)

  const setKey = (text: string) =>
    onChange((p) => {
      const next = { ...p }
      if (text.trim() === '') delete next.key
      else next.key = text.trim()
      return next
    })

  const setChart = (name: string, text: string) =>
    onChange((p) => ({ ...p, charts: { ...p.charts, [name]: text } }))

  const addChart = () => {
    const name = newChartName.trim() || (chartNames.length === 0 ? 'chorus' : `chart ${chartNames.length + 1}`)
    if (name in pkg.charts) return
    onChange((p) => ({ ...p, charts: { ...p.charts, [name]: '' } }))
    setNewChartName('')
  }

  const removeChart = (name: string) =>
    onChange((p) => {
      const charts = { ...p.charts }
      delete charts[name]
      return {
        ...p,
        charts,
        sections: p.sections.map((s) => (s.chart === name ? { name: s.name, bars: s.bars } : s)),
      }
    })

  const setSection = (index: number, patch: Partial<SongSection>) =>
    onChange((p) => ({
      ...p,
      sections: p.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }))

  const setSectionBars = (index: number, which: 0 | 1, value: number) => {
    if (!Number.isInteger(value) || value < 1) return
    onChange((p) => ({
      ...p,
      sections: p.sections.map((s, i) => {
        if (i !== index) return s
        const bars: [number, number] = which === 0 ? [value, Math.max(value, s.bars[1])] : [Math.min(value, s.bars[0]), value]
        return { ...s, bars }
      }),
    }))
  }

  const addSection = () =>
    onChange((p) => {
      const last = p.sections[p.sections.length - 1]
      const first = last ? last.bars[1] + 1 : 1
      const chart = last?.chart ?? chartNames[0]
      const length = chart ? chartStatusBars(p, chart) : 8
      return {
        ...p,
        sections: [
          ...p.sections,
          { name: last ? `${last.name}` : 'chorus', bars: [first, first + length - 1], ...(chart ? { chart } : {}) },
        ],
      }
    })

  const removeSection = (index: number) =>
    onChange((p) => ({ ...p, sections: p.sections.filter((_, i) => i !== index) }))

  const coverage =
    timeline.barsNeeded > 0
      ? `Sections reach bar ${timeline.barsNeeded}; the bar map has ${timeline.barsMapped} bar${timeline.barsMapped === 1 ? '' : 's'}.`
      : 'No sections yet.'

  return (
    <div className="editor-body">
      <div className="controls">
        <label>
          Key
          <input
            className="key-input"
            value={pkg.key ?? ''}
            placeholder="C"
            onChange={(e) => setKey(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Beats per bar
          <select
            value={pkg.beatsPerBar}
            onChange={(e) => onChange((p) => ({ ...p, beatsPerBar: Number(e.target.value) }))}
          >
            {BEATS_PER_BAR.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3>Charts</h3>
      <p className="hint">
        Bars between pipes; two chords in one bar share it. <code>| Dm | A7 | Dm D7 | Gm |</code>
      </p>
      {chartNames.length === 0 ? <p className="empty-panel">No charts yet.</p> : null}
      {chartNames.map((name) => {
        const status = chartStatus(pkg, pkg.charts[name] ?? '')
        return (
          <div key={name} className="chart-row">
            <div className="chart-row-head">
              <strong>{name}</strong>
              <span className={status.ok ? 'chart-status' : 'chart-status bad'}>{status.note}</span>
              <button type="button" className="song-remove" onClick={() => removeChart(name)} title="Remove this chart">
                ×
              </button>
            </div>
            <textarea
              className="chart-text"
              value={pkg.charts[name] ?? ''}
              onChange={(e) => setChart(name, e.target.value)}
              rows={2}
              spellCheck={false}
            />
          </div>
        )
      })}
      <div className="controls">
        <label>
          New chart
          <input
            className="key-input wide"
            value={newChartName}
            placeholder={chartNames.length === 0 ? 'chorus' : 'bridge'}
            onChange={(e) => setNewChartName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addChart()
            }}
          />
        </label>
        <button type="button" onClick={addChart}>
          Add a chart
        </button>
      </div>

      <h3>Form</h3>
      {pkg.sections.length === 0 ? (
        <p className="empty-panel">No sections yet. A section is a run of bars that plays one chart.</p>
      ) : (
        <table className="form-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>First bar</th>
              <th>Last bar</th>
              <th>Chart</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pkg.sections.map((s, i) => (
              <tr key={i}>
                <td>
                  <input value={s.name} onChange={(e) => setSection(i, { name: e.target.value })} />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={s.bars[0]}
                    onChange={(e) => setSectionBars(i, 0, Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={s.bars[1]}
                    onChange={(e) => setSectionBars(i, 1, Number(e.target.value))}
                  />
                </td>
                <td>
                  <select
                    value={s.chart ?? ''}
                    onChange={(e) =>
                      onChange((p) => ({
                        ...p,
                        sections: p.sections.map((x, j) => {
                          if (j !== i) return x
                          const { chart: _drop, ...rest } = x
                          return e.target.value === '' ? rest : { ...rest, chart: e.target.value }
                        }),
                      }))
                    }
                  >
                    <option value="">none</option>
                    {chartNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="song-remove" onClick={() => removeSection(i)} title="Remove this section">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="controls">
        <button type="button" onClick={addSection}>
          Add a section
        </button>
        <span className="hint">{coverage}</span>
      </div>

      {timeline.problems.length > 0 ? (
        <ul className="problems">
          {timeline.problems.map((p, i) => (
            <li key={i}>
              <strong>{p.where}</strong> {p.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function chartStatusBars(pkg: SongPackage, name: string): number {
  try {
    const key = parseKeyText(pkg.key ?? 'C')
    return Math.max(1, parseChart(key, pkg.charts[name] ?? '', pkg.beatsPerBar).bars.length)
  } catch {
    return 8
  }
}
