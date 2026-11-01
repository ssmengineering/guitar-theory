/**
 * Where songs live in the browser: the Origin Private File System.
 *
 * The site is public and static, so nothing copyrighted can ship with it. A
 * song package is imported from a folder on the player's own disk and copied
 * into OPFS under `songs/<slug>/`; from then on it loads offline like the rest
 * of the app, and it never leaves the machine.
 *
 * In development there is a second source: the repo's git-ignored `songs/`
 * folder, served by a dev-only route (see `vite.config.ts`), so a package can
 * be opened without the folder picker.
 */

import {
  SongPackageError,
  packageFiles,
  parseSongPackage,
  songSlug,
  type SongPackage,
} from '../song/model.js'

export interface SongSummary {
  slug: string
  title: string
  artist?: string
  origin: 'opfs' | 'dev'
}

/** An opened package: its metadata and a way to read the files it names. */
export interface SongSource {
  summary: SongSummary
  pkg: SongPackage
  read(path: string): Promise<ArrayBuffer>
}

export const opfsAvailable = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'

export const directoryPickerAvailable = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

/** Chrome's folder picker; not in the DOM typings yet. */
export function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const w = window as unknown as {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  return w.showDirectoryPicker({ mode: 'read' })
}

/* OPFS plumbing --------------------------------------------------------- */

type DirectoryEntries = { entries(): AsyncIterable<[string, FileSystemHandle]> }

async function songsRoot(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('songs', { create })
}

async function fileHandleAt(
  dir: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter((p) => p.length > 0 && p !== '.')
  if (parts.length === 0 || parts.includes('..')) throw new SongPackageError(`bad path ${path}`)
  let here = dir
  for (const part of parts.slice(0, -1)) here = await here.getDirectoryHandle(part, { create })
  return here.getFileHandle(parts[parts.length - 1]!, { create })
}

async function readJson(dir: FileSystemDirectoryHandle): Promise<SongPackage> {
  const file = await (await dir.getFileHandle('song.json')).getFile()
  return parseSongPackage(JSON.parse(await file.text()))
}

async function writePackage(
  slug: string,
  json: Blob,
  files: { path: string; blob: Blob }[],
): Promise<void> {
  const songs = await songsRoot(true)
  try {
    await songs.removeEntry(slug, { recursive: true })
  } catch {
    // nothing there yet
  }
  const dir = await songs.getDirectoryHandle(slug, { create: true })
  const write = async (path: string, blob: Blob) => {
    const handle = await fileHandleAt(dir, path, true)
    const stream = await handle.createWritable()
    await stream.write(blob)
    await stream.close()
  }
  await write('song.json', json)
  for (const { path, blob } of files) await write(path, blob)
}

/* Importing ------------------------------------------------------------- */

/** From the folder picker. Copies `song.json` and every file it names. */
export async function importFromDirectory(dir: FileSystemDirectoryHandle): Promise<SongSummary> {
  const jsonFile = await (await dir.getFileHandle('song.json')).getFile()
  const pkg = parseSongPackage(JSON.parse(await jsonFile.text()))
  const files = await Promise.all(
    packageFiles(pkg).map(async (path) => {
      try {
        return { path, blob: await (await fileHandleAt(dir, path)).getFile() }
      } catch {
        throw new SongPackageError(`the package names ${path} but the folder has no such file`)
      }
    }),
  )
  const slug = songSlug(pkg)
  await writePackage(slug, jsonFile, files)
  return { slug, title: pkg.title, artist: pkg.artist, origin: 'opfs' }
}

/**
 * From `<input type="file" webkitdirectory>`, for browsers without the picker.
 * Each file carries its path relative to the chosen folder's parent.
 */
export async function importFromFileList(list: FileList | File[]): Promise<SongSummary> {
  const files = Array.from(list)
  const stripTop = (p: string) => p.split('/').slice(1).join('/')
  const byPath = new Map(files.map((f) => [stripTop(f.webkitRelativePath) || f.name, f]))
  const json = byPath.get('song.json')
  if (!json) throw new SongPackageError('that folder has no song.json')
  const pkg = parseSongPackage(JSON.parse(await json.text()))
  const needed = packageFiles(pkg).map((path) => {
    const blob = byPath.get(path)
    if (!blob) throw new SongPackageError(`the package names ${path} but the folder has no such file`)
    return { path, blob }
  })
  const slug = songSlug(pkg)
  await writePackage(slug, json, needed)
  return { slug, title: pkg.title, artist: pkg.artist, origin: 'opfs' }
}

/* Listing and opening --------------------------------------------------- */

export async function listStoredSongs(): Promise<SongSummary[]> {
  if (!opfsAvailable()) return []
  let songs: FileSystemDirectoryHandle
  try {
    songs = await songsRoot(false)
  } catch {
    return []
  }
  const out: SongSummary[] = []
  for await (const [name, handle] of (songs as unknown as DirectoryEntries).entries()) {
    if (handle.kind !== 'directory') continue
    try {
      const pkg = await readJson(handle as FileSystemDirectoryHandle)
      out.push({ slug: name, title: pkg.title, artist: pkg.artist, origin: 'opfs' })
    } catch {
      // a half-written or foreign folder; leave it out rather than fail the list
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

export async function openStoredSong(slug: string): Promise<SongSource> {
  const dir = await (await songsRoot(false)).getDirectoryHandle(slug)
  const pkg = await readJson(dir)
  return {
    summary: { slug, title: pkg.title, artist: pkg.artist, origin: 'opfs' },
    pkg,
    read: async (path) => (await (await fileHandleAt(dir, path)).getFile()).arrayBuffer(),
  }
}

export async function deleteStoredSong(slug: string): Promise<void> {
  const songs = await songsRoot(false)
  await songs.removeEntry(slug, { recursive: true })
}

/* The dev folder -------------------------------------------------------- */

const DEV_SONGS_URL = '/dev-songs'

export async function listDevSongs(): Promise<SongSummary[]> {
  if (!import.meta.env.DEV) return []
  try {
    const response = await fetch(`${DEV_SONGS_URL}/index.json`)
    if (!response.ok) return []
    const list = (await response.json()) as { slug: string; title: string; artist?: string }[]
    return list.map((s) => ({ ...s, origin: 'dev' as const }))
  } catch {
    return []
  }
}

export async function openDevSong(slug: string): Promise<SongSource> {
  const base = `${DEV_SONGS_URL}/${encodeURIComponent(slug)}`
  const response = await fetch(`${base}/song.json`)
  if (!response.ok) throw new SongPackageError(`no dev song "${slug}"`)
  const pkg = parseSongPackage(await response.json())
  return {
    summary: { slug, title: pkg.title, artist: pkg.artist, origin: 'dev' },
    pkg,
    read: async (path) => {
      const r = await fetch(`${base}/${path.split('/').map(encodeURIComponent).join('/')}`)
      if (!r.ok) throw new SongPackageError(`${path}: ${r.status}`)
      return r.arrayBuffer()
    },
  }
}

export const openSong = (summary: SongSummary): Promise<SongSource> =>
  summary.origin === 'dev' ? openDevSong(summary.slug) : openStoredSong(summary.slug)
