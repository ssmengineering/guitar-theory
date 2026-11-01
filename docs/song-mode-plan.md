# Song mode: build plan

Drafted 2026-10-31. This is the working plan for the feature; update it as
stages land rather than writing a second one.

Status, 2026-11-01: Stages 1 to 5 and the in-app import are built and on
main. Stage 6 (a rhythm section rebuilt with sampled instruments) and Stage 7
(reading the tab) are drafted below and not started.

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

Stage 1 verified: `tools/songimport/setup.ps1` built the environment from
nothing on this machine (uv's managed Python 3.12, the pinned packages, the
bundled ffmpeg), and `songimport` turned the Ochi Chornya MP3 and the Dark
Eyes PDF into a package in 7.3 minutes on the CPU: guitar, bass and drums
stems with the vocal stem dropped as silent, 294 beat guesses taken from the
rhythm section, four tab pages, `song.json`. A `--skip-separation` re-run
regenerated the pages in seconds. Nine unit tests cover the pure parts: the
slug (the same rule as the app), stem choice, kept fields, `song.json`.

Stage 4 verified: the detector (`tools/songimport/songimport/scan.py`) finds
every staff on both test tabs and the right bars on Shadow Waltz throughout;
on Dark Eyes it loses the bars where the writer drew bar lines as long as the
beat stems, which the editor covers. 148 boxes on Ochi Chornya's four pages
in four seconds. In the app, the page shows with its boxes, the lit box
follows a 61-bar map as the record plays, the container scrolls to keep it in
view, and Fix the boxes selected, split, merged and renumbered a box, with the
result autosaved to `song.json`. Fourteen Python tests cover the detector on
drawn staves; eight app tests cover the box arithmetic.

Stage 5, first cluster, done the same day: `parseChord` reads the altered and
extended dominants (`7#5`, `9#5`, `7b5`, `11`, `7alt`, `9sus4`, `madd9`) and
the handwritten spellings (`A9 5+`, `E7+`, `C7(b9)`, `Am7-5`, `C2`, `G69`);
in-key colour chords read as diatonic with the colour named; a minor key's
V7 is its dominant; an altered V stays the dominant with its altered tones
traced; IV7 in a major key is the blues colour; a chromatic chord a half step
between its neighbours in the bass is a passing chord; a chord that is nothing
in the key gets its enharmonic other name (Abm7b5 is Bm6); and a secondary
dominant or tritone sub is told whether the chart went where it points. The
whole Shadow Waltz chart and the Dark Eyes intro now read correctly;
`tests/charts.test.ts` holds those charts as the engine's test cases.

Second cluster, same day: a slash chord is read as its inversion or as a bass
note outside the chord; three or more chords whose bass notes step one way
are named as the bass line they are; `findCadences` knows the turnaround
(plain and ragtime), the backdoor, the minor plagal and the half cadence; and
a section can carry its own key, so a bridge that modulates is analysed in
its key on the HUD, in the Improv follow, and in the timeline. Left for later:
chord-melody readings, which need the melody note and not just the symbol.

Importing from the app, same day (the first Stage 6 item, pulled forward
because the terminal step was the thing in the way): `songimport serve` is a
local helper that serves the built app, lists the record and tab libraries
paired by year, title and track number (`library.py`, one-to-one, tested
against the real folder names), runs imports in the background with their
progress, and serves the packages on the same routes the dev server uses.
The Song screen gains an Import panel; `Start Guitar Theory.cmd` starts the
helper and opens the browser, so daily use needs no terminal and no `npm run
dev`. The Vite dev server proxies `/api` to the helper so both can run
together. Verified end to end: Minute Waltz imported from the panel in under
five minutes, its tab paired automatically, and opened on its own when done;
being a solo-guitar track, it came through with one stem, the bass, drums and
vocal stems dropped as silent, which is the Stage 6 case for a generated
rhythm section. Under the helper the service worker is not registered (its
script fetch fails on this server, and offline caching means nothing on a
local machine), so the public site keeps the worker and the helper does not.

The first double-click of the start script failed on the user's side with "No
Python at ...AppData\Roaming\uv\python...": the interpreter uv had downloaded
there during setup existed only for the shell that ran the setup, not for a
process started from Explorer. The whole toolchain now lives under
`tools/songimport` (`.python` holds the interpreter, `.venv` points at it,
`.models` the separator weights), `setup.ps1` installs there and repairs a
venv whose Python has gone, and the start script runs the setup itself when
the tool is missing or broken instead of showing the launcher's message.

Not yet exercised: the native folder picker itself (the import code path was
driven with an OPFS directory handle instead), Safari and the iPad, listening
tests of stretch quality at 50 percent, tapping accuracy by ear, the `-Gpu`
setup, `htdemucs_6s` through the tool, a re-import over a package with typed
charts (the kept-fields logic is tested, not run), and drawing a box by hand
with a real pointer. Every stage of the plan is now built; what remains is
the rest of Stage 5 and the Stage 6 options.

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
  is no symbolic data to extract, so in v1 the chart is typed per chorus and
  the scan is displayed, not transcribed. Stage 7 sets out to read it: one
  writer with a consistent hand makes that a small recognition problem rather
  than general music OCR.
- **The records are sparse.** Bass, brushed drums, sometimes piano, sometimes
  nothing but the guitar. On Ochi Chornya (1955) Demucs split bass and drums
  from the guitar with the backing sitting about 30 dB under the guitar in the
  solo intro, and the thumb bass stayed in the guitar stem. Solo-guitar tracks
  have nothing to extract; in v1 the tool for those is the slowed original with
  loops, and Stage 6 gives them a rhythm section built from the chart.
- **The source files are poor.** The test rip was 56 kbps at 22 kHz. Re-rip from
  CD where possible; everything downstream improves. The records themselves
  are vinyl transfers, so even a clean rip has crackle and a narrow band; that
  is why Stage 6 rebuilds the rhythm section rather than only cleaning it.
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
   guitar. Stage 6 adds a sampled rhythm section as extra stems beside the
   real ones, never instead of them; the record's stems stay in the mixer.
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
- Later: a CUDA build of PyTorch (the RTX 3060 turns minutes into seconds), a
  stronger beat tracker such as Beat This!, and finding the tab by itself: the
  music and tab libraries are parallel folders with matching track numbers
  (`1955_ChetAtkinsInThreeDimensions/03OchiChornya...MP3` beside
  `02 (1955) Chet Atkins In 3 Dimensions LPM-1197/03 Dark Eyes.pdf`), so a
  whole album could be imported in one command.

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

### Stage 6: A rhythm section that sounds real

Drafted 2026-11-01. Done when a package carries MIDI tracks for bass, drums
and, where the record has one, piano; the app renders them with sampled
instruments into stems that sit in the mixer beside the record's own stems;
tempo and loops work on them unchanged; and a solo-guitar track such as Minute
Waltz gets a bass and brushes built from its chart.

Why: the records are vinyl transfers, scratchy and narrow, and the backing
track inherits that. The chart, the bar map and the separated stems are enough
to rebuild the rhythm section cleanly, and the record's own bass line can be
learned from its stem rather than invented. The result sounds like a clean
rhythm section playing the record's arrangement, not like the record.

Decisions, made now:

- **The MIDI is the asset; audio is a rendering.** Note lists live in
  `song.json`; the app renders them when the song opens, so changing an
  instrument or a drum feel is a re-render in seconds, not a re-import.
- **Real and rendered stems coexist.** Real bass against MIDI bass on two
  faders; mute the scratchy drums and keep the generated brushes.
- **General MIDI sounds are out.** Only sampled instruments good enough to
  practise with. Candidates below were chosen for sound and licence.
- **Samples never enter the repo.** The helper downloads the open sets once
  into `tools/samples/` (git-ignored) and serves them; the public site fetches
  the same public-domain sets from where they are hosted. Anything bought for
  personal use stays in `tools/samples/` and nowhere else.
- **Rendering is in the browser, not in Python.** An `OfflineAudioContext`
  render through a small sampler keeps the import tool free of native synth
  binaries and lets the user swap instruments without re-importing.

**6a. Instruments and the sampler.** A listening test comes before any
generator, because the sound decides whether the stage is worth finishing.

- Upright bass: D. Smolken's double bass sets, CC0: the 1958 Rubner bass
  (arco, pizz) and Meatbass (pizz with four velocity layers and round robins).
  Both are already mapped as SFZ and as web manifests in danigb's `samples`
  collection, served as ogg and mp3.
- Piano: Splendid Grand Piano (public domain, Steinway, four velocity layers)
  first; Salamander Grand (CC-BY 3.0, Yamaha C5, sixteen layers, up to 1.9 GB)
  if the sound is worth the size.
- Drums: no openly licensed brush kit was found. First attempt: a brushed
  snare built from shaped noise (the swish and the tap) over CC0 kit pieces
  from the Versilian Community Sample Library (snares, bass drums, hi-hat,
  suspended cymbals). If that does not convince, a small commercial brush pack
  bought for personal use and kept locally.
- Rhythm guitar: not now.
- `src/audio/sampler.ts`: a sampler for the SFZ subset these sets use (key and
  velocity ranges, pitch keycentre, round robin, release), reading the
  `.websfz.json` manifests; `renderTrack(notes, instrument) -> AudioBuffer`;
  `engine.load` accepts rendered buffers as stems alongside decoded files.
- Done when a hand-written note list plays through the bass and the piano in
  the app and the user says it sounds right.

**6b. Learn the bass line from the record.** In the import tool: pitch-track
the bass stem (it is close to monophonic; librosa's `pyin` is already in the
environment), turn frames into note events, quantise onsets to the beat grid,
and snap each pitch to the chord tones of the bar it falls in (roots, fifths,
approach tones), with octave errors fixed by range and ghost notes dropped by
length and energy. The track is stored as `midi` notes with `source: "record"`
and nothing is lost: the user can hear the real bass stem against it. Spotify's
Basic Pitch (Apache 2.0, ONNX on Windows) is the polyphonic upgrade for piano
if it installs under Python 3.12; its README lists 3.7 to 3.11, so try it in a
scratch environment first.

**6c. Generate what cannot be learned.** Pure `src/song/` code with tests:

- Drums: a feel per section chosen from a short list (brushes swing, train
  beat, two-beat country, waltz, none), locked to the bar map, an optional fill
  into a new section. Brushes are a continuous swish on a 1950s rip and are not
  worth transcribing.
- Bass from the chart, for solo tracks and as the fallback: root and fifth in
  two-feel, an approach note into each chord change, a walking option; Stage 7
  later feeds it the thumb line Chet actually played.
- Piano comping from the chart: shell and closed voicings in a mid register
  with a rhythm pattern per feel. Transcribing the record's piano through the
  separation bleed is a later experiment.

**6d. Mixer and package.** `format: 2` adds
`midi: [{ id, instrument, role, source, notes: [[beat, length, pitch, velocity]] }]`
with times in beats so the notes follow the bar map when it is edited. The
mixer shows rendered stems with their instrument and a "render again" when an
instrument or feel changes. A later option is live sampler playback against
the stretch node's clock, which would slow down with no artefacts at all.

Order: 6a, then 6b and 6d together so the transcribed bass is heard through
the sampler, then 6c. Estimate: 4 to 6 sessions. The open question is 6a: if
no brush sound convinces, drums stay as the record's stem and the stage still
pays off on bass and piano.

### Stage 7: Reading the tab

Drafted 2026-11-01. Done when a tab page's numbers are read into notes per
string and beat, bar by bar; mistakes are corrected on the page in the app and
the corrections train the reader; and the engine uses the notes: the thumb
bass line drives the generated bass, each melody note is explained against its
chord, and bars without chord names get a chord inferred from what is played.

Why it is tractable: one writer with a consistent hand; the staves are already
found as rows of dashes and the bar lines as strokes; the beat stems are drawn;
the vocabulary is the digits 0 to about 17 plus a few dozen chord names. This
is a small recognition problem trained on the user's own corrections, not
general handwritten music OCR.

- **Geometry, in `scan.py`.** Within a system, remove the staff strokes and
  take the connected components. Tall thin marks below the staff are beat
  stems; digit-height marks on the lines are fret numbers, merged into
  two-digit numbers when adjacent at one height; marks above the staff are
  chord names; the rest (ties, slides, repeat dots) is ignored at first. The
  string is the nearest line; the beat is the nearest stem within tolerance,
  otherwise the note is off the beat between two stems.
- **Classification.** A small convolutional net over digit crops, trained on
  labelled crops saved from the user's corrections in
  `tools/songimport/.training/` (git-ignored); PyTorch is already in the
  environment and a model this size retrains in seconds. Two ways to start
  before there are labels: a generic handwritten-digit model corrected by hand
  on the first pages, or a vision model reading cropped systems into
  structured notes through the Claude API (`claude-opus-5-5`, the Python
  SDK). The second is opt-in because the pages leave the machine; a page is a
  few cents. Chord names above the staff are read the same way, against the
  chart's vocabulary.
- **In the package.** `tab: { bars: [{ bar, notes: [{ string, fret, beat,
  sub }] }] }`, format 2, with `sub` 0 on the beat and 1 between beats.
- **In the app.** `SongScan` gains Read this page and an overlay of the read
  numbers on the scan; a tap corrects one and the crop goes to the training
  folder; a bar can be marked as read correctly.
- **In the engine, `src/song/tabnotes.ts`.** Pitches from string and fret
  through the tuning; the thumb line is the lowest notes on the beats, the
  melody the highest; `inferChord(barNotes, key, previous)` scores candidate
  chords by the tones present, the bass note on the downbeat and the key;
  `explainMelody` reuses the analysis to call each melody note a chord tone,
  colour, approach or passing note. This is the "understand what is happening"
  part, and it is pure engine work with tests built from real pages.

Honest limits: the tab has no durations, so rhythm is beats and off-beats;
slurs, bends and harmonics are not read; later choruses carry no chord names,
which is exactly what the inference is for. The recognizer's accuracy is the
open question: measure it on two pages before building the rest.

Estimate: 5 to 8 sessions.

### Later options

Importing a whole album in one command. Audio-only chord detection for songs
without a tab. A CUDA build of PyTorch. The iPad.

## Order of work

1. **Stage 2 first**, against a package assembled by hand from today's Ochi
   Chornya stems and a typed chart. Hearing it work is the motivation, and it
   is the smallest build that proves the whole experience.
2. **Stage 3** on the same song.
3. **Stage 1** so the rest of the library is cheap to add.
4. **Stage 4**, then Stage 6 as wanted.
5. **Stage 5** threaded through all of it, one cluster at a time.
6. **Stage 6** from 6a: the instruments decide whether the rest is worth it.
7. **Stage 7** after 6a, because its first payoff is the thumb line feeding
   the generated bass; its engine half can run alongside Stage 6.

| Stage | Sessions |
|---|---|
| 1 Import tool | 2 to 3 |
| 2 Playback engine | 3 to 4 |
| 3 Chart, bars, HUD | 3 to 4 |
| 4 Scan view | 2 to 3 |
| 5 Engine work | ongoing |
| 6 Sampled rhythm section | 4 to 6 |
| 7 Reading the tab | 5 to 8 |

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
