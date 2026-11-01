/**
 * The page: the handwritten tab, with the bar the record is in lit up.
 *
 * The import tool draws a box round every bar it can find. Here those boxes
 * follow the bar map, so the page scrolls itself as the record plays and a
 * click on any bar jumps the record there. The detector is not perfect and
 * handwriting is not regular, so there is an editing mode: renumber from a
 * box, split one, merge two, remove a sliver, draw one by hand, or mark a box
 * as a second bar under a repeat. Every change saves with the package.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react'
import type { SongSource } from '../audio/store.js'
import type { ScanBox, ScanPage, SongPackage } from '../song/model.js'
import {
  addBox,
  boxesForBar,
  lastMarkedBar,
  mergeWithNext,
  removeBox,
  renumberFrom,
  splitBox,
  toggleBarNumber,
  type BoxRef,
} from '../song/scan.js'
import { barPositionAt } from '../song/timeline.js'

interface Props {
  source: SongSource
  pkg: SongPackage
  position: number
  duration: number
  playing: boolean
  onSeek: (time: number) => void
  onChange: (update: (pkg: SongPackage) => SongPackage) => void
}

interface Draft {
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
}

const key = (ref: BoxRef) => `${ref.page}:${ref.index}`
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(3)}%`

export default function SongScan({
  source,
  pkg,
  position,
  duration,
  playing,
  onSeek,
  onChange,
}: Props) {
  const pages: ScanPage[] = pkg.scan?.pages ?? []
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({})
  const [editing, setEditing] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [selected, setSelected] = useState<BoxRef | null>(null)
  const [renumberTo, setRenumberTo] = useState(1)
  const [alsoBar, setAlsoBar] = useState(1)
  const [parts, setParts] = useState(2)
  const [draft, setDraft] = useState<Draft | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const pageElements = useRef<(HTMLDivElement | null)[]>([])

  const imageList = pages.map((p) => p.image).join('|')

  // The page images, read from the package and held as object URLs.
  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    void (async () => {
      const next: Record<string, string> = {}
      for (const page of pages) {
        try {
          const bytes = await source.read(page.image)
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
          created.push(url)
          next[page.image] = url
        } catch {
          // a missing page shows as a gap, not a crash
        }
      }
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, imageList])

  const bar = barPositionAt(pkg.bars, pkg.beatsPerBar, position, duration)?.bar ?? null
  const lit = bar === null ? [] : boxesForBar(pages, bar)
  const litKeys = new Set(lit.map(key))
  const litKey = [...litKeys].join(',')

  // Keep the lit bar in view while the record plays.
  useEffect(() => {
    const container = scroller.current
    const first = lit[0]
    if (!playing || !container || !first) return
    const element = container.querySelector<HTMLElement>(`[data-box="${key(first)}"]`)
    if (!element) return
    const c = container.getBoundingClientRect()
    const e = element.getBoundingClientRect()
    const inView = e.top >= c.top + 16 && e.bottom <= c.bottom - 16
    if (!inView) {
      container.scrollTo({
        top: container.scrollTop + (e.top - c.top) - c.height * 0.3,
        behavior: 'smooth',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litKey, playing])

  // Escape leaves whatever you were doing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelected(null)
      setDrawing(false)
      setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = (change: (pages: ScanPage[]) => ScanPage[]) =>
    onChange((p) => ({ ...p, scan: { pages: change(p.scan?.pages ?? []) } }))

  const selectedBox: ScanBox | null =
    selected ? (pages[selected.page]?.boxes[selected.index] ?? null) : null

  const clickBox = (ref: BoxRef, box: ScanBox) => {
    if (editing) {
      setSelected(ref)
      setRenumberTo(box.bars[0] ?? lastMarkedBar(pages) + 1)
      setAlsoBar(Math.max(1, (box.bars[box.bars.length - 1] ?? 0) + 1))
      return
    }
    const n = box.bars[0]
    const time = n === undefined ? undefined : pkg.bars[n - 1]
    if (time !== undefined) onSeek(time)
  }

  const onImageLoad = (image: string) => (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    setSizes((s) => ({ ...s, [image]: { w: img.naturalWidth, h: img.naturalHeight } }))
  }

  const toImage = (event: ReactPointerEvent, pageIndex: number) => {
    const element = pageElements.current[pageIndex]
    const size = sizes[pages[pageIndex]!.image]
    if (!element || !size) return null
    const r = element.getBoundingClientRect()
    return {
      x: ((event.clientX - r.left) / r.width) * size.w,
      y: ((event.clientY - r.top) / r.height) * size.h,
    }
  }

  const startDraw = (pageIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return
    const at = toImage(event, pageIndex)
    if (!at) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft({ page: pageIndex, x0: at.x, y0: at.y, x1: at.x, y1: at.y })
  }

  const moveDraw = (pageIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || draft.page !== pageIndex) return
    const at = toImage(event, pageIndex)
    if (at) setDraft({ ...draft, x1: at.x, y1: at.y })
  }

  const endDraw = (pageIndex: number) => () => {
    if (!draft || draft.page !== pageIndex) return
    const x = Math.round(Math.min(draft.x0, draft.x1))
    const y = Math.round(Math.min(draft.y0, draft.y1))
    const w = Math.round(Math.abs(draft.x1 - draft.x0))
    const h = Math.round(Math.abs(draft.y1 - draft.y0))
    setDraft(null)
    if (w >= 8 && h >= 8) update((ps) => addBox(ps, pageIndex, { x, y, w, h }))
  }

  const withSelected = (change: (ps: ScanPage[], ref: BoxRef) => ScanPage[]) => {
    if (!selected) return
    update((ps) => change(ps, selected))
  }

  const draftRect = (pageIndex: number) => {
    const size = sizes[pages[pageIndex]!.image]
    if (!draft || draft.page !== pageIndex || !size) return null
    const x = Math.min(draft.x0, draft.x1)
    const y = Math.min(draft.y0, draft.y1)
    return {
      left: pct(x, size.w),
      top: pct(y, size.h),
      width: pct(Math.abs(draft.x1 - draft.x0), size.w),
      height: pct(Math.abs(draft.y1 - draft.y0), size.h),
    }
  }

  const marked = lastMarkedBar(pages)

  return (
    <div className="editor-body scan">
      <div className="scan-tools">
        <span className="scan-status">
          {marked > 0 ? `${marked} bars marked` : 'No bars marked yet'}
          {bar !== null ? ` · bar ${bar} now` : ''}
          {pkg.bars.length === 0 ? ' · tap the bars in and the page will follow' : ''}
        </span>
        <button
          type="button"
          className={editing ? 'on' : ''}
          onClick={() => {
            setEditing((e) => !e)
            setSelected(null)
            setDrawing(false)
          }}
        >
          {editing ? 'Done fixing' : 'Fix the boxes'}
        </button>
        {editing ? (
          <button type="button" className={drawing ? 'on' : ''} onClick={() => setDrawing((d) => !d)}>
            {drawing ? 'Drawing: drag on the page' : 'Draw a box'}
          </button>
        ) : null}
      </div>

      {editing && selectedBox && selected ? (
        <div className="scan-tools">
          <span className="scan-status">
            Box {selectedBox.bars.length > 0 ? `for bar ${selectedBox.bars.join(' and ')}` : 'with no bar yet'}:
          </span>
          <label className="scan-field">
            is bar
            <input
              type="number"
              min={1}
              value={renumberTo}
              onChange={(e) => setRenumberTo(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => withSelected((ps, ref) => renumberFrom(ps, ref, renumberTo))}
            title="This box becomes that bar and every box after it counts on from there"
          >
            Renumber from here
          </button>
          <label className="scan-field">
            also bar
            <input type="number" min={1} value={alsoBar} onChange={(e) => setAlsoBar(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={() => withSelected((ps, ref) => toggleBarNumber(ps, ref, alsoBar))}
            title="A repeat plays the same ink twice: give the box a second bar number"
          >
            {selectedBox.bars.includes(alsoBar) ? 'Drop that number' : 'Add that number'}
          </button>
          <label className="scan-field">
            into
            <input type="number" min={2} max={16} value={parts} onChange={(e) => setParts(Number(e.target.value))} />
          </label>
          <button type="button" onClick={() => withSelected((ps, ref) => splitBox(ps, ref, parts))}>
            Split
          </button>
          <button type="button" onClick={() => withSelected(mergeWithNext)}>
            Merge with next
          </button>
          <button
            type="button"
            className="song-remove"
            onClick={() => {
              withSelected(removeBox)
              setSelected(null)
            }}
            title="Remove this box"
          >
            ×
          </button>
        </div>
      ) : editing ? (
        <p className="hint">Click a box to select it, or draw one where the detector missed a bar.</p>
      ) : null}

      <div className="scan-scroll" ref={scroller}>
        {pages.map((page, pageIndex) => {
          const url = urls[page.image]
          const size = sizes[page.image]
          const rect = draftRect(pageIndex)
          return (
            <div
              key={page.image}
              className={drawing ? 'scan-page drawing' : 'scan-page'}
              ref={(el) => {
                pageElements.current[pageIndex] = el
              }}
              onPointerDown={startDraw(pageIndex)}
              onPointerMove={moveDraw(pageIndex)}
              onPointerUp={endDraw(pageIndex)}
            >
              {url ? (
                <img src={url} alt={`Tab page ${pageIndex + 1}`} onLoad={onImageLoad(page.image)} draggable={false} />
              ) : (
                <p className="empty-panel">Loading page {pageIndex + 1}…</p>
              )}
              {size
                ? page.boxes.map((box, index) => {
                    const ref = { page: pageIndex, index }
                    const k = key(ref)
                    const classes = ['scan-box']
                    if (litKeys.has(k)) classes.push('current')
                    if (selected && key(selected) === k) classes.push('selected')
                    return (
                      <button
                        type="button"
                        key={k}
                        data-box={k}
                        className={classes.join(' ')}
                        style={{
                          left: pct(box.x, size.w),
                          top: pct(box.y, size.h),
                          width: pct(box.w, size.w),
                          height: pct(box.h, size.h),
                        }}
                        onClick={() => clickBox(ref, box)}
                        title={box.bars.length > 0 ? `bar ${box.bars.join(', ')}` : 'no bar number'}
                        tabIndex={-1}
                      >
                        <span className="scan-label">{box.bars.join(',') || '?'}</span>
                      </button>
                    )
                  })
                : null}
              {rect ? <div className="scan-draft" style={rect} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
