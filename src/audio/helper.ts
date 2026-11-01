/**
 * Talking to the local helper, when there is one.
 *
 * `songimport serve` runs on the player's own machine: it serves this app,
 * lists the record and tab libraries paired up, runs imports in the background
 * and serves the packages. From here it is a handful of fetches on the same
 * origin. On the public site none of these routes exist and the probe says so,
 * and the Import panel simply does not appear.
 */

export interface LibraryTrack {
  number: number | null
  title: string
  file: string
  tab: { title: string; file: string } | null
  package: { slug: string; title: string } | null
}

export interface LibraryAlbum {
  name: string
  year: number | null
  title: string
  folder: string
  tabFolder: string | null
  tracks: LibraryTrack[]
}

export interface Library {
  music: string | null
  tabs: string | null
  albums: LibraryAlbum[]
  unmatchedTabFolders: string[]
}

export interface ImportRequest {
  track: string
  pdf?: string | null
  leadLabel?: string
  beats?: number
  key?: string
  model?: string
  fresh?: boolean
  skipSeparation?: boolean
}

export interface ImportJob {
  id: string
  track: string
  title: string
  state: 'running' | 'done' | 'failed'
  log: string[]
  result: { slug: string; title: string; stems: string[]; dropped: string[]; kept: string[] } | null
  error: string | null
  seconds: number
}

const API = '/api'

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `the helper answered ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // the status is all we have
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

/** Is a helper serving this page? A static host answers with HTML or a 404. */
export async function helperAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${API}/health`, { cache: 'no-store' })
    return response.ok && (response.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  }
}

export const fetchLibrary = (): Promise<Library> =>
  fetch(`${API}/library`, { cache: 'no-store' }).then((r) => asJson<Library>(r))

export const startImport = (request: ImportRequest): Promise<ImportJob> =>
  fetch(`${API}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }).then((r) => asJson<ImportJob>(r))

export const fetchJob = (id: string): Promise<ImportJob> =>
  fetch(`${API}/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((r) =>
    asJson<ImportJob>(r),
  )

export const fetchJobs = (): Promise<{ jobs: ImportJob[]; running: boolean }> =>
  fetch(`${API}/jobs`, { cache: 'no-store' }).then((r) =>
    asJson<{ jobs: ImportJob[]; running: boolean }>(r),
  )
