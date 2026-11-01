/**
 * Importing from the browser: pick a record from your albums and press one
 * button.
 *
 * The local helper lists the record library with the tab library paired up by
 * year, title and track number, so a track arrives with its tab already
 * found. The import itself runs on the helper, in the background, and its
 * progress lines show here as they happen. When it finishes, the song opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchJob,
  fetchJobs,
  fetchLibrary,
  helperAvailable,
  startImport,
  type ImportJob,
  type Library,
  type LibraryTrack,
} from '../audio/helper.js'

interface Props {
  onImported: (slug: string) => void
}

const BEATS = [2, 3, 4, 6]
const MODELS = [
  { id: 'htdemucs_ft', label: 'four stems, the cleanest split' },
  { id: 'htdemucs_6s', label: 'six stems, with guitar and piano apart' },
]

const remember = (key: string, fallback: string): string => {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const keep = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // a private window forgets; that is fine
  }
}

export default function SongImport({ onImported }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [library, setLibrary] = useState<Library | null>(null)
  const [albumName, setAlbumName] = useState<string>('')
  const [trackFile, setTrackFile] = useState<string | null>(null)
  const [leadLabel, setLeadLabel] = useState(() => remember('songimport.lead', 'Guitar'))
  const [beats, setBeats] = useState(4)
  const [keyText, setKeyText] = useState('')
  const [model, setModel] = useState(MODELS[0]!.id)
  const [fresh, setFresh] = useState(false)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const delivered = useRef<string | null>(null)

  const loadLibrary = useCallback(async () => {
    try {
      const lib = await fetchLibrary()
      setLibrary(lib)
      setAlbumName((name) => name || lib.albums[0]?.name || '')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // Is there a helper at all? Then its library, and any import still running.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await helperAvailable()
      if (cancelled) return
      setAvailable(ok)
      if (!ok) return
      await loadLibrary()
      try {
        const { jobs } = await fetchJobs()
        const last = jobs[jobs.length - 1]
        if (last && last.state === 'running') setJob(last)
      } catch {
        // no job history is nothing to report
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadLibrary])

  // Follow a running job, and open the song when it lands.
  useEffect(() => {
    if (!job || job.state !== 'running') return
    const timer = window.setInterval(() => {
      void fetchJob(job.id)
        .then((fresh) => setJob(fresh))
        .catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job])

  useEffect(() => {
    if (!job || job.state !== 'done' || !job.result || delivered.current === job.id) return
    delivered.current = job.id
    void loadLibrary()
    onImported(job.result.slug)
  }, [job, loadLibrary, onImported])

  if (available !== true) return null

  const albums = (library?.albums ?? [])
    .slice()
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
  const album = albums.find((a) => a.name === albumName) ?? albums[0]
  const track: LibraryTrack | undefined = album?.tracks.find((t) => t.file === trackFile)
  const running = job?.state === 'running'

  const start = async () => {
    if (!track) return
    setNotice(null)
    keep('songimport.lead', leadLabel)
    try {
      const started = await startImport({
        track: track.file,
        pdf: track.tab?.file ?? null,
        leadLabel: leadLabel.trim() || 'Guitar',
        beats,
        key: keyText.trim() || undefined,
        model,
        fresh,
      })
      setJob(started)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="editor-body import">
      {library && library.albums.length === 0 ? (
        <p className="empty-panel">
          The helper is running but found no albums. Check the music and tabs folders in
          tools\songimport\serve.json.
        </p>
      ) : null}

      {album ? (
        <>
          <div className="controls">
            <label>
              Album
              <select
                value={album.name}
                onChange={(e) => {
                  setAlbumName(e.target.value)
                  setTrackFile(null)
                }}
              >
                {albums.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.year ? `${a.year} · ` : ''}
                    {a.title}
                    {a.tabFolder ? '' : ' (no tabs found)'}
                  </option>
                ))}
              </select>
            </label>
            <span className="hint import-hint">
              {album.tabFolder ? `tabs from "${album.tabFolder}"` : 'no tab folder matched this album'}
            </span>
          </div>

          <ol className="import-tracks">
            {album.tracks.map((t) => (
              <li key={t.file} className={t.file === trackFile ? 'current' : ''}>
                <button type="button" onClick={() => setTrackFile(t.file)} disabled={running}>
                  <span className="import-number">{t.number ?? '·'}</span>
                  <span className="import-title">{t.title}</span>
                  <small>
                    {t.tab ? `tab: ${t.tab.title}` : 'no tab'}
                    {t.package ? ' · imported' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {track ? (
        <div className="import-form">
          <p>
            <strong>{track.title}</strong>
            {track.tab ? (
              <>
                {' '}
                with the tab <em>{track.tab.title}</em>
              </>
            ) : (
              <> without a tab; none matched, and the pages can be added by a re-import later</>
            )}
            .
          </p>
          <div className="controls">
            <label>
              The part is called
              <input
                className="key-input wide"
                value={leadLabel}
                onChange={(e) => setLeadLabel(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label>
              Beats per bar
              <select value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
                {BEATS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Key
              <input
                className="key-input"
                value={keyText}
                placeholder="later"
                onChange={(e) => setKeyText(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label>
              Split into
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {track.package ? (
              <label className="checkbox">
                <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
                start over, dropping the chart and bars typed before
              </label>
            ) : null}
            <button type="button" className="chip import-go" onClick={() => void start()} disabled={running}>
              {running ? 'Importing…' : track.package ? 'Import again' : 'Import'}
            </button>
          </div>
        </div>
      ) : album ? (
        <p className="hint">Pick a track. About seven minutes a song on the processor.</p>
      ) : null}

      {job ? (
        <div className="import-job">
          <p className={job.state === 'failed' ? 'notice' : 'hint'}>
            {job.state === 'running'
              ? `Importing ${job.title}… ${Math.round(job.seconds)} s so far`
              : job.state === 'done'
                ? `Done in ${Math.round(job.seconds / 60)} min: ${job.result?.title ?? job.title}`
                : `Failed: ${job.error ?? 'unknown error'}`}
          </p>
          <pre className="import-log">{job.log.join('\n') || 'starting…'}</pre>
        </div>
      ) : null}

      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
