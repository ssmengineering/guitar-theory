# songimport

A record and its tab in, a song package out. The package is what the app's
Song screen plays: `song.json`, one MP3 stem per instrument separated from the
record, and the tab's pages as PNGs.

## Setup, once

```powershell
powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1
```

That builds `tools\songimport\.venv` with its own Python 3.12 and everything
pinned in `pyproject.toml`, then runs `songimport --check`. Add `-Gpu` to
install the CUDA build of PyTorch (about 3 GB) and separate on the graphics
card in seconds rather than minutes.

The separator insists on an `ffmpeg` binary even though none is needed here;
the first run copies the one bundled with `imageio-ffmpeg` into the
environment. Nothing outside `.venv` is installed.

## Importing

```powershell
tools\songimport\.venv\Scripts\songimport.exe "G:\My Drive\ChetAtkins\1955_ChetAtkinsInThreeDimensions\03OchiChornya(LesYeuxNoirs).MP3" --pdf "G:\My Drive\Macbook Pro\Chet Atkins Tabs\02 (1955) Chet Atkins In 3 Dimensions LPM-1197\03 Dark Eyes.pdf"
```

Options worth knowing:

| Option | What it does |
|---|---|
| `--model htdemucs_6s` | also separates guitar and piano; `htdemucs_ft` (the default) is the better four-stem split |
| `--lead other` | which separated stem is the part you are learning; defaults to the model's guitar, or `other` for four-stem models; `none` for no lead |
| `--lead-label Chet` | what the mixer calls the part |
| `--beats 3` | beats per bar, for the bar tools and the count-in |
| `--key Dm` | the key, so the chart analysis is right from the start |
| `--fresh` | discard an existing package's key, chart, sections and bars |
| `--skip-separation` | keep the stems; redo the beats, pages and `song.json` |
| `--out DIR` | where packages go (default: the repo's git-ignored `songs/`) |

Re-running on a song that already has a package keeps what you typed in the
app (key, beats per bar, charts, sections, bars, scan boxes) and regenerates
the rest, so a better rip or a different model never costs the tapping.

Stems quieter than -50 dBFS over the whole track are dropped: the vocal stem
of an instrumental, the piano stem of a trio. Beat guesses come from the
drums and bass stems when they exist, because a busy lead guitar fools the
beat tracker more than a rhythm section does.

Separator models are cached in `tools\songimport\.models` on first use.

## What it writes

```
songs/chet-atkins-ochi-chornya-les-yeux-noirs/
  song.json
  stems/guitar.mp3  bass.mp3  drums.mp3
  scan/p1.png  p2.png
```

The folder name follows the same rule as the app, artist and title made
URL-safe. With the dev server running the package appears in the Song
screen's list; anywhere else, use **Import a song folder**.

## Tests

```powershell
tools\songimport\.venv\Scripts\python.exe -m unittest discover -s tools\songimport\tests
```
