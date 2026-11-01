/**
 * One player and one open song for the whole app.
 *
 * The Song screen is where a song gets opened, but it is not the only screen
 * that wants to know what is playing - the Improv HUD can follow the song's
 * chords - and switching tabs must not stop the record. So the player and the
 * open package live here, outside any component, and screens subscribe.
 *
 * Edits to the package go through `updatePackage`, which rebuilds the
 * timeline and schedules a save, so a tapped bar is on disk a second or two
 * after it was tapped whichever screen you are looking at by then.
 */

import { useSyncExternalStore } from 'react'
import type { SongPlayer } from '../audio/engine.js'
import { openSong, saveSongJson, type SongSource, type SongSummary } from '../audio/store.js'
import { stemLabel, type SongPackage } from '../song/model.js'
import { buildTimeline, type Timeline } from '../song/timeline.js'

export interface SongSessionState {
  source: SongSource | null
  pkg: SongPackage | null
  timeline: Timeline | null
  /** Edits not yet written back. */
  dirty: boolean
  saving: boolean
  loading: string | null
  error: string | null
}

let state: SongSessionState = {
  source: null,
  pkg: null,
  timeline: null,
  dirty: false,
  saving: false,
  loading: null,
  error: null,
}
let player: SongPlayer | null = null
let version = 0
let saveTimer: number | null = null
const listeners = new Set<() => void>()

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function set(patch: Partial<SongSessionState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/**
 * The engine carries the time-stretcher's WASM, so it is loaded the first time
 * a song is opened rather than with the app. Screens that follow a song only
 * ever need a player that already exists, which is `peekPlayer`.
 */
async function createPlayer(): Promise<SongPlayer> {
  if (!player) {
    const { SongPlayer } = await import('../audio/engine.js')
    player = new SongPlayer()
    // A handle for poking at the graph from the console while developing.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __songPlayer?: SongPlayer }).__songPlayer = player
    }
  }
  return player
}

/** The player if one exists; opening a song creates it. */
export const peekPlayer = (): SongPlayer | null => player

export const sessionState = (): SongSessionState => state

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useSongSession = (): SongSessionState =>
  useSyncExternalStore(subscribeSession, sessionState, sessionState)

export async function loadSong(summary: SongSummary): Promise<void> {
  await flushSave()
  set({ loading: `Loading ${summary.title}…`, error: null })
  try {
    const source = await openSong(summary)
    const inputs = await Promise.all(
      source.pkg.stems.map(async (s) => ({
        id: s.id,
        label: stemLabel(s),
        bytes: await source.read(s.file),
      })),
    )
    const p = await createPlayer()
    await p.load(inputs)
    set({
      source,
      pkg: source.pkg,
      timeline: buildTimeline(source.pkg, p.duration),
      dirty: false,
      loading: null,
    })
  } catch (error) {
    set({ loading: null, error: message(error) })
  }
}

export function closeSong(): void {
  player?.unload()
  set({ source: null, pkg: null, timeline: null, dirty: false })
}

/** Change the open package. The timeline follows, and a save is scheduled. */
export function updatePackage(update: (pkg: SongPackage) => SongPackage): void {
  if (!state.pkg) return
  const pkg = update(state.pkg)
  version += 1
  set({ pkg, timeline: buildTimeline(pkg, player?.duration), dirty: true })
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void savePackage(), 1500)
}

export async function savePackage(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  const { source, pkg } = state
  if (!source || !pkg || !state.dirty) return
  const saved = version
  set({ saving: true })
  try {
    await saveSongJson(source.summary, pkg)
    set({ saving: false, dirty: version !== saved, error: null })
  } catch (error) {
    set({ saving: false, error: `Not saved: ${message(error)}` })
  }
}

/** Save now if anything is pending - before opening another song, for instance. */
export async function flushSave(): Promise<void> {
  if (state.dirty) await savePackage()
}
