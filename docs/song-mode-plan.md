# Song mode: build plan

Drafted 2026-10-31. This is the working plan for the feature; update it as
stages land rather than writing a second one.

Status, 2026-10-31: Stages 2 and 3 are built and verified in Chrome against
the hand-assembled Ochi Chornya package (`songs/ochi-chornya/`, git-ignored).

Stage 2 verified: load from the dev folder and from OPFS, count-in then play,
tempo at 70 percent advances the song clock at 0.72 of wall time, muting a
stem zeroes its meter, a 30 s to 33 s loop wraps, and the bass stem's spectral
peaks are identical at 70 and 100 percent, so pitch is held.

Stage 3 verified: typing a key, a chart and a section in the editor; building
a 60-bar map from the beat guesses at the band's entry; the HUD reading
"chorus · bar 4 · beat 4 · D7 · 1(7) · I7 in D minor · secondary dominant"
as the record plays; a tap on B, and Undo; autosave of `song.json` to the dev
folder within two seconds; the record continuing across a tab switch; and
the Improv screen following the song with its own Prev, Next and Pause.

One change from the plan: the player and the open package live in
`src/ui/songSession.ts`, a store outside any screen, because following from
the Improv screen needs the record to outlive the Song screen. The pure
modules are `src/song/barmap.ts` and `src/song/timeline.ts`, tested in
`tests/timeline.test.ts`.

Not yet exercised: the native folder picker itself (the import code path was
driven with an OPFS directory handle instead), Safari and the iPad, listening
tests of stretch quality at 50 percent, and tapping accuracy by ear. The scan
view (Stage 4) and the import tool (Stage 1) are not started.

## What it is

Import a record and its tab, and get four things back: a backing track made from
the record itself with each instrument on its own fader, a tempo control that
keeps the pitch, a chord chart that follows the music bar by bar with the
engine's analysis of each chord, and the scanned tab page with the current bar
highlighted. It is a practice tool for one player's own library, mostly Chet
Atkins instrumentals from the 1950s.

## What the plan rests on

These were established before writing this, and the design follows from them.

- **The tabs are handwritten PDF scans.** Six-line tab, beat stems only, no
  durations, chord names written above the first chorus and nowhere else. There
  is no symbolic data to extract, so the chart is typed per chorus and the scan
  is displayed, not transcribed.
- **The records are sparse.** Bass, brushed drums, sometimes piano, sometimes
  nothing but the guitar. On Ochi Chornya (1955) Demucs split bass and drums
  from the guitar with the backing sitting about 30 dB under the guitar in the
  solo intro, and the thumb bass stayed in the guitar stem. Solo-guitar tracks
  have nothing to extract; for those the tool is the slowed original with loops.
- **The source files are poor.** The test rip was 56 kbps at 22 kHz. Re-rip from
  CD where possible; everything downstream improves.
- **The app is a static, public, offline PWA with no backend.** Nothing
  copyrighted can go in the repo or the deployed site. Song audio and scans
  live on the user's device only.
- **The engine already does the theory.** `parseChart`, `analyze` and
  `findCadences` in `src/notes/progression.ts` produce key, Nashville numbers,
  Roman numerals, a role and an explanation per chord. The Improv HUD already
  takes a chart and a tempo. The Shadow Waltz chart exposed gaps, listed under
  Stage 5.

## Decisions

Made now so they do not get re-argued later.

1. **Real stems, no synthesis in v1.** The backing is the record minus the
   guitar. A generated rhythm section for solo tracks is a Stage 6 option.
2. **Import is a local Python command, run once per song.** It writes a
   self-contained song package folder. The browser never runs a model.
3. **Packages are loaded from disk into the browser** with a folder picker or
   drag-and-drop, and cached in the Origin Private File System. `songs/` and
   `experiments/` stay git-ignored.
4. **The chart is typed in the engine's chart syntax**, one section at a time,
   in the song's meter. The form (intro, choruses, ending) is a list of
   sections that reference charts.
5. **The bar map is a list of downbeat times**, built from a beat-tracker guess
   that the user confirms, taps, or nudges. Everything on screen syncs to it.
6. **One time-stretch node carries every stem as a channel**, so stems cannot
   drift apart when the rate changes.
7. **Three new layers.** `src/song/` is pure TypeScript and depends on `notes/`
   and `guitar/` only. `src/audio/` is Web Audio and imports no theory.
   `src/ui/Song*.tsx` sits on both. `song/` gets tests like the rest.

## The song package

```
songs/ochi-chornya/
  song.json
  stems/guitar.mp3  bass.mp3  drums.mp3  piano.mp3  other.mp3
  scan/p1.png  p2.png
```

`song.json`, abbreviated:

```json
{
  "format": 1,
  "title": "Ochi Chornya", "artist": "Chet Atkins", "year": 1955,
  "source": { "file": "03OchiChornya.MP3", "sampleRate": 22050, "kbps": 56 },
  "stems": [
    { "id": "guitar", "file": "stems/guitar.mp3", "role": "lead" },
    { "id": "bass",   "file": "stems/bass.mp3" },
    { "id": "drums",  "file": "stems/drums.mp3" }
  ],
  "key": "Dm", "beatsPerBar": 4,
  "bars": [0.00, 2.31, 4.58],
  "beatCandidates": [0.00, 0.57, 1.15],
  "sections": [
    { "name": "intro",  "bars": [1, 8],  "chart": "intro" },
    { "name": "chorus", "bars": [9, 40], "chart": "chorus" },
    { "name": "chorus", "bars": [41, 72], "chart": "chorus" }
  ],
  "charts": { "chorus": "| Dm | A7 | Dm | D7 | Gm | Dm | A7 | Dm |" },
  "scan": {
    "pages": [
      { "image": "scan/p1.png",
        "boxes": [ { "bar": 1, "x": 70, "y": 190, "w": 92, "h": 90 } ] }
    ]
  }
}
```

`bars` is the truth; `beatCandidates` is the import tool's guess, kept so the
editor can snap to it. A scan box can carry more than one bar number, because
repeats visit the same ink twice.

## How the pieces connect

```
MP3 + PDF ──► tools/songimport (Python, once per song) ──► songs/<slug>/
                                                              │
                                 folder picker / drag-drop ◄──┘
                                           │
   browser   src/audio/   decode stems ─► one stretch node ─► per-stem gains ─► out
                          transport: position in song seconds, rate, loop points
             src/song/    package model, bar map, timeline: time ─► bar ─► chord
                          chord ─► engine (analyze, fretboardMap, voicings)
             src/ui/      Song screen: transport, mixer, chord HUD, scan view,
                          chart editor, bar editor; Improv HUD can follow the song
```

## Stages

A session below means one working sitting of a couple of hours with Claude.

### Stage 1: Import tool (Python)

Done when `python -m songimport "track.mp3" --pdf "tab.pdf" --out songs/`
writes a complete package, and a `setup.ps1` builds the environment from
nothing on this machine.

- Environment: uv-managed Python 3.12, `audio-separator[cpu]`, `audioread`,
  `imageio-ffmpeg` (its binary copied onto PATH as `ffmpeg.exe`), `soundfile`,
  `numpy`, `librosa`, `pymupdf`, `opencv-python-headless`. Pinned. This recipe
  is proven; the details are in the memory note from the test.
- Decode the MP3 to WAV with soundfile before separating.
- Separate with `htdemucs_ft` by default; `htdemucs_6s` when the track has
  piano or you want a guitar stem. Write MP3 stems with soundfile.
- Render PDF pages at about 110 dpi with pymupdf.
- First-guess beats with librosa `beat_track`; store as candidates only.
- Read tags for title, artist, year; write `song.json`.
- Later: a CUDA build of PyTorch (the RTX 3060 turns minutes into seconds), and
  a stronger beat tracker such as Beat This!.

Estimate: 2 to 3 sessions.

### Stage 2: Playback engine (browser)

Done when the Ochi Chornya package loads, plays, each stem mutes and fades,
tempo runs from 50 to 110 percent with no pitch change, a loop between two
bars holds, there is a count-in, and the stems stay locked throughout.

- `src/audio/engine.ts`: decode stems with `decodeAudioData`; a
  `signalsmith-stretch` node fed all stems as channels; `ChannelSplitter` to
  one `GainNode` per stem to a `ChannelMerger`; a transport that reports
  position in song seconds whatever the rate; seek; loop points.
- `src/audio/store.ts`: import a package folder with `showDirectoryPicker`,
  fall back to drag-and-drop of the folder, cache in OPFS, list and delete.
- A bare Song screen: load, transport, mixer, rate slider.
- Chrome on the Windows PC is the target. Safari lacks the directory picker and
  has Web Audio quirks; iPad comes later.

Estimate: 3 to 4 sessions.

### Stage 3: Chart, bar map, and the theory HUD

Done when you can type the chart for each section, set the form, tap or
confirm the bars while listening, nudge one, save, and during playback see the
current chord with its number, numeral, role and explanation, plus the
fretboard map of its tones; and the Improv HUD can follow the song instead of
its own transport.

- `src/song/model.ts`: the package types and a validator for `format: 1`.
- `src/song/barmap.ts`: taps to times, snap to beat candidates, nudge, fill
  gaps by interpolation, detect the meter from tap spacing.
- `src/song/timeline.ts`: sections plus charts plus bars to chord-at-time,
  with repeats and endings handled by the section list.
- `src/ui/SongChart.tsx`, `SongBars.tsx`, `SongHud.tsx`; the HUD reuses
  `Fretboard` and `analyze`.
- Save back to `song.json` in OPFS and export the folder for backup.
- Tests: timeline arithmetic, tap smoothing, 3/4 charts, a chart with endings.

Estimate: 3 to 4 sessions.

### Stage 4: Scan view

Done when the tab pages show in the app with the current bar highlighted as
the track plays, boxes found automatically and fixable by click.

- In the import tool: find systems by horizontal projection, bar lines as
  vertical segments spanning the six staff lines (OpenCV); emit candidate
  boxes per page.
- In the app: add, remove, merge boxes; set the bar number that starts each
  system; assign extra bar numbers to boxes under repeats.

Estimate: 2 to 3 sessions.

### Stage 5: Engine work the charts demand

This is the point of the feature, and it can run alongside Stages 2 to 4
because it is pure engine work with tests. The first list comes from Shadow
Waltz:

- `parseChord` rejects `9#5` and `11`; add the altered and extended dominant
  family (`7#5`, `7b9`, `9#5`, `11`, `13`, `7alt`, `sus` variants).
- `G6`, `D6/9` and `Dadd9` are reported as chromatic. A colour tone on a
  diatonic triad should keep the chord diatonic: test the base triad, then
  describe the colour.
- `A9` is reported as "V of I" rather than the plain V9.
- `Abm7b5` is `Bm6` in another spelling, and `A9 - Abm7b5 - G6 - D` is a bass
  line walking A, G#, G down to the tonic. Needs enharmonic and inversion
  recognition, slash chords, and a chromatic bass-line detector across bars.
- Cadence detection in 3/4, and passing diminished chords.
- Every item gets a test built from a real chart, so the Chet library becomes
  the engine's test suite.

Estimate: ongoing, about one session per cluster.

### Stage 6: Later options

A generated rhythm section for solo-guitar tracks, built from the chart with
`hands/bassline.ts` and a brush loop through a small sampler. Vision-assisted
transcription of a scan into alphaTex rendered with alphaTab, for the songs you
are deepest in. Audio-only chord detection for songs without a tab. The iPad.

## Order of work

1. **Stage 2 first**, against a package assembled by hand from today's Ochi
   Chornya stems and a typed chart. Hearing it work is the motivation, and it
   is the smallest build that proves the whole experience.
2. **Stage 3** on the same song.
3. **Stage 1** so the rest of the library is cheap to add.
4. **Stage 4**, then Stage 6 as wanted.
5. **Stage 5** threaded through all of it, one cluster at a time.

| Stage | Sessions |
|---|---|
| 1 Import tool | 2 to 3 |
| 2 Playback engine | 3 to 4 |
| 3 Chart, bars, HUD | 3 to 4 |
| 4 Scan view | 2 to 3 |
| 5 Engine work | ongoing |

## Risks and open questions

- **Stretch quality at half speed** on brushes and upright bass. Evaluate in
  the first Stage 2 session; it is the one thing a library choice cannot fix
  later.
- **Busier tracks separate worse.** Piano and a rhythm guitar will smear into
  the guitar stem; two guitars cannot be told apart. The mixer lets you keep
  or drop the `other` stem per song.
- **Storage.** A package is roughly 20 to 40 MB as MP3 stems; a hundred songs
  is a few gigabytes, which is fine in Chrome's OPFS on the desktop.
- **Windows Python fragility.** Pin everything and keep `setup.ps1` working;
  the import tool is the part most likely to rot.
- **Personal use.** Separated stems and scans never leave the machine; the
  repo and the site hold no audio.
