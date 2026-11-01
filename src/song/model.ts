/**
 * The song package: what the import tool writes and the Song screen reads.
 *
 * A package is a folder - `song.json`, the stems it names, the scanned tab
 * pages. This module is the pure part: the types, a validator that turns a
 * parsed JSON file into a package or says exactly what is wrong with it, and
 * the small arithmetic the screens share (beat spacing, snapping, clock
 * formatting). It knows nothing about audio or storage and imports nothing
 * from `ui/` or `audio/`, so it is tested like the rest of the engine.
 *
 * `bars` is the truth - downbeat times the player has confirmed. The import
 * tool's beat guesses go in `beatCandidates` and are only ever something to
 * snap to.
 */

export const SONG_FORMAT = 1

export interface StemSpec {
  id: string
  /** Path inside the package folder, e.g. `stems/bass.mp3`. */
  file: string
  /** The part being learned. The mixer marks it so it is the obvious one to pull out. */
  role?: 'lead' | 'backing'
  label?: string
}

export interface SongSection {
  name: string
  /** First and last bar numbers, 1-based, inclusive. */
  bars: [number, number]
  /** Key into `charts`. */
  chart?: string
}

export interface ScanBox {
  /** Bar numbers this ink stands for - more than one under a repeat. */
  bars: number[]
  x: number
  y: number
  w: number
  h: number
}

export interface ScanPage {
  image: string
  boxes: ScanBox[]
}

export interface SongPackage {
  format: typeof SONG_FORMAT
  title: string
  artist?: string
  album?: string
  year?: number
  source?: { file?: string; sampleRate?: number; kbps?: number; separator?: string }
  stems: StemSpec[]
  key?: string
  beatsPerBar: number
  tempoBpm?: number
  bars: number[]
  beatCandidates: number[]
  sections: SongSection[]
  charts: Record<string, string>
  scan?: { pages: ScanPage[] }
}

export class SongPackageError extends Error {}

function fail(message: string): never {
  throw new SongPackageError(message)
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

function numberList(x: unknown, what: string): number[] {
  if (x === undefined) return []
  if (!Array.isArray(x) || !x.every(isFiniteNumber)) fail(`${what} must be a list of numbers`)
  for (let i = 1; i < x.length; i++) {
    if (x[i]! <= x[i - 1]!) fail(`${what} must increase (entry ${i + 1} does not)`)
  }
  return x
}

function optionalString(x: unknown, what: string): string | undefined {
  if (x === undefined) return undefined
  if (typeof x !== 'string') fail(`${what} must be text`)
  return x
}

function optionalNumber(x: unknown, what: string): number | undefined {
  if (x === undefined) return undefined
  if (!isFiniteNumber(x)) fail(`${what} must be a number`)
  return x
}

function parseStems(x: unknown): StemSpec[] {
  if (!Array.isArray(x) || x.length === 0) fail('song.json needs at least one stem')
  const seen = new Set<string>()
  return x.map((s, i): StemSpec => {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.file !== 'string') {
      fail(`stem ${i + 1} needs an id and a file`)
    }
    if (seen.has(s.id)) fail(`stem id "${s.id}" appears twice`)
    seen.add(s.id)
    const stem: StemSpec = { id: s.id, file: s.file }
    if (s.role === 'lead' || s.role === 'backing') stem.role = s.role
    else if (s.role !== undefined) fail(`stem "${s.id}" has an unknown role`)
    const label = optionalString(s.label, `stem "${s.id}" label`)
    if (label !== undefined) stem.label = label
    return stem
  })
}

function parseSections(x: unknown): SongSection[] {
  if (x === undefined) return []
  if (!Array.isArray(x)) fail('sections must be a list')
  return x.map((s, i): SongSection => {
    if (!isRecord(s) || typeof s.name !== 'string') fail(`section ${i + 1} needs a name`)
    const bars = s.bars
    if (
      !Array.isArray(bars) ||
      bars.length !== 2 ||
      !bars.every((b) => Number.isInteger(b) && b >= 1) ||
      bars[0] > bars[1]
    ) {
      fail(`section "${s.name}" needs bars [first, last]`)
    }
    const section: SongSection = { name: s.name, bars: [bars[0], bars[1]] }
    const chart = optionalString(s.chart, `section "${s.name}" chart`)
    if (chart !== undefined) section.chart = chart
    return section
  })
}

function parseCharts(x: unknown): Record<string, string> {
  if (x === undefined) return {}
  if (!isRecord(x)) fail('charts must be an object of name to chart text')
  const out: Record<string, string> = {}
  for (const [name, text] of Object.entries(x)) {
    if (typeof text !== 'string') fail(`chart "${name}" must be text`)
    out[name] = text
  }
  return out
}

function parseScan(x: unknown): { pages: ScanPage[] } | undefined {
  if (x === undefined) return undefined
  if (!isRecord(x) || !Array.isArray(x.pages)) fail('scan needs a list of pages')
  const pages = x.pages.map((p, i): ScanPage => {
    if (!isRecord(p) || typeof p.image !== 'string') fail(`scan page ${i + 1} needs an image`)
    const rawBoxes = p.boxes === undefined ? [] : p.boxes
    if (!Array.isArray(rawBoxes)) fail(`scan page ${i + 1} boxes must be a list`)
    const boxes = rawBoxes.map((b, j): ScanBox => {
      if (!isRecord(b) || ![b.x, b.y, b.w, b.h].every(isFiniteNumber)) {
        fail(`scan page ${i + 1} box ${j + 1} needs x, y, w, h`)
      }
      const bars = b.bars !== undefined ? b.bars : b.bar !== undefined ? [b.bar] : []
      if (!Array.isArray(bars) || !bars.every((n) => Number.isInteger(n) && n >= 1)) {
        fail(`scan page ${i + 1} box ${j + 1} needs bar numbers`)
      }
      return { bars, x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number }
    })
    return { image: p.image, boxes }
  })
  return { pages }
}

function parseSource(x: unknown): SongPackage['source'] {
  if (x === undefined) return undefined
  if (!isRecord(x)) fail('source must be an object')
  const out: NonNullable<SongPackage['source']> = {}
  const file = optionalString(x.file, 'source.file')
  const separator = optionalString(x.separator, 'source.separator')
  const sampleRate = optionalNumber(x.sampleRate, 'source.sampleRate')
  const kbps = optionalNumber(x.kbps, 'source.kbps')
  if (file !== undefined) out.file = file
  if (separator !== undefined) out.separator = separator
  if (sampleRate !== undefined) out.sampleRate = sampleRate
  if (kbps !== undefined) out.kbps = kbps
  return out
}

/** Turn parsed `song.json` into a package, or throw a `SongPackageError` that says what is wrong. */
export function parseSongPackage(json: unknown): SongPackage {
  if (!isRecord(json)) fail('song.json must be an object')
  if (json.format !== SONG_FORMAT) {
    fail(`song format ${String(json.format)} is not one this app reads (it reads ${SONG_FORMAT})`)
  }
  if (typeof json.title !== 'string' || json.title.trim() === '') fail('song.json needs a title')

  const beatsPerBar = json.beatsPerBar === undefined ? 4 : json.beatsPerBar
  if (!Number.isInteger(beatsPerBar) || (beatsPerBar as number) < 1) {
    fail('beatsPerBar must be a whole number of beats')
  }

  const pkg: SongPackage = {
    format: SONG_FORMAT,
    title: json.title.trim(),
    stems: parseStems(json.stems),
    beatsPerBar: beatsPerBar as number,
    bars: numberList(json.bars, 'bars'),
    beatCandidates: numberList(json.beatCandidates, 'beatCandidates'),
    sections: parseSections(json.sections),
    charts: parseCharts(json.charts),
  }
  const artist = optionalString(json.artist, 'artist')
  const album = optionalString(json.album, 'album')
  const key = optionalString(json.key, 'key')
  const year = optionalNumber(json.year, 'year')
  const tempoBpm = optionalNumber(json.tempoBpm, 'tempoBpm')
  const source = parseSource(json.source)
  const scan = parseScan(json.scan)
  if (artist !== undefined) pkg.artist = artist
  if (album !== undefined) pkg.album = album
  if (key !== undefined) pkg.key = key
  if (year !== undefined) pkg.year = year
  if (tempoBpm !== undefined) {
    if (tempoBpm <= 0) fail('tempoBpm must be positive')
    pkg.tempoBpm = tempoBpm
  }
  if (source !== undefined) pkg.source = source
  if (scan !== undefined) pkg.scan = scan

  for (const section of pkg.sections) {
    if (section.chart !== undefined && !(section.chart in pkg.charts)) {
      fail(`section "${section.name}" refers to a chart "${section.chart}" that is not in charts`)
    }
  }
  return pkg
}

/** Every file the package refers to, relative to its folder, each once. */
export function packageFiles(pkg: SongPackage): string[] {
  const files = pkg.stems.map((s) => s.file)
  for (const page of pkg.scan?.pages ?? []) files.push(page.image)
  return [...new Set(files)]
}

/** A folder-safe name: artist and title, lower case, hyphens. */
export function songSlug(pkg: Pick<SongPackage, 'title' | 'artist'>): string {
  const slug = `${pkg.artist ?? ''} ${pkg.title}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'song'
}

export const stemLabel = (stem: StemSpec): string =>
  stem.label ?? stem.id.charAt(0).toUpperCase() + stem.id.slice(1)

/**
 * Seconds per beat: the stated tempo if there is one, otherwise the median
 * gap between beat candidates, which shrugs off a missed or doubled beat.
 * `null` when the package offers neither.
 */
export function beatInterval(pkg: Pick<SongPackage, 'tempoBpm' | 'beatCandidates'>): number | null {
  if (pkg.tempoBpm !== undefined && pkg.tempoBpm > 0) return 60 / pkg.tempoBpm
  const beats = pkg.beatCandidates
  if (beats.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i]! - beats[i - 1]!)
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
}

/** The nearest time in a sorted list, if it is within `tolerance` seconds; otherwise `t` unchanged. */
export function snapToBeat(t: number, times: readonly number[], tolerance = 0.12): number {
  if (times.length === 0) return t
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! < t) lo = mid + 1
    else hi = mid
  }
  const candidates = [times[lo]!, times[lo - 1] ?? Number.NaN]
  let best = t
  let bestDistance = tolerance
  for (const c of candidates) {
    const d = Math.abs(c - t)
    if (d <= bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/** `m:ss.t` - a practice clock, tenths because loops are set by ear. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const minutes = Math.floor(s / 60)
  const rest = s - minutes * 60
  const whole = Math.floor(rest)
  const tenths = Math.floor((rest - whole) * 10)
  return `${minutes}:${String(whole).padStart(2, '0')}.${tenths}`
}
