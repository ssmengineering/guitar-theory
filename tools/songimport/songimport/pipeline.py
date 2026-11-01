"""The import pipeline: one record and its tab in, one song package out.

The steps, in order: read the tags, decode to WAV, separate into stems, keep
the stems that have anything in them and write them as MP3, guess the beats
from the rhythm section, render the tab's pages, write `song.json`.

A package is a folder the app reads as it is, so every step writes straight
into it. Re-running on an existing package keeps what was typed in the app -
the key, the charts, the sections, the bars, the scan boxes - and regenerates
everything else, so a better rip or a better model never costs an afternoon
of tapping.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

SONG_FORMAT = 1

# A stem quieter than this over the whole track is the model finding nothing:
# the vocal stem of an instrumental, the piano stem of a trio.
SILENT_DBFS = -50.0

# The order stems are listed in the package: the part first, then the band.
STEM_ORDER = ["guitar", "piano", "bass", "drums", "other", "vocals"]

# Which separated stem holds the lead guitar, per model. The four-stem models
# have no guitar stem, so the guitar is whatever is left over.
DEFAULT_LEAD = {
    "htdemucs_ft": "other",
    "htdemucs": "other",
    "hdemucs_mmi": "other",
    "htdemucs_6s": "guitar",
}

# The fields the app edits. Kept across a re-import unless --fresh.
KEPT_FIELDS = ("key", "beatsPerBar", "bars", "sections", "charts")

Log = Callable[[str], None]


@dataclass
class ImportOptions:
    track: Path
    out_dir: Path
    pdf: Path | None = None
    model: str = "htdemucs_ft"
    # The separated stem that is the part being learned. None takes the
    # model's default; "none" marks no stem as the lead.
    lead: str | None = None
    lead_label: str = "Guitar"
    beats_per_bar: int = 4
    key: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: int | None = None
    slug: str | None = None
    fresh: bool = False
    skip_separation: bool = False
    keep_work: bool = False
    # Find the bars on the tab pages (pages that already have boxes keep them).
    detect_bars: bool = True
    # Also write scan/pN.boxes.png with the boxes drawn on, to check by eye.
    scan_preview: bool = False
    models_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parents[1] / ".models"
    )
    dpi: int = 110
    silence_dbfs: float = SILENT_DBFS


@dataclass
class StemPlan:
    """One separated stem that will go into the package."""

    source: str
    id: str
    label: str
    role: str | None
    dbfs: float


@dataclass
class ImportResult:
    package: Path
    song_json: dict
    stems: list[StemPlan]
    dropped: list[tuple[str, float]]
    kept: list[str]
    seconds: float


# Pure helpers ---------------------------------------------------------------


def slugify(artist: str | None, title: str) -> str:
    """The folder name. The same rule as `songSlug` in the app, so the two agree."""
    text = f"{artist or ''} {title}".lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "song"


def title_from_filename(path: Path) -> str:
    """`03OchiChornya(LesYeuxNoirs).MP3` is not a title, but it is better than nothing."""
    from .library import parse_track_file

    return parse_track_file(path.name)[1] or path.stem


def plan_stems(
    levels: dict[str, float],
    model: str,
    lead: str | None,
    lead_label: str,
    silence_dbfs: float = SILENT_DBFS,
) -> tuple[list[StemPlan], list[tuple[str, float]]]:
    """Decide which stems go in, which is the part, and what to call them."""
    chosen = DEFAULT_LEAD.get(model, "other") if lead is None else (None if lead == "none" else lead)
    kept_names = {name for name, dbfs in levels.items() if dbfs >= silence_dbfs}
    plans: list[StemPlan] = []
    dropped: list[tuple[str, float]] = []
    for name, dbfs in levels.items():
        if dbfs < silence_dbfs:
            dropped.append((name, round(dbfs, 1)))
            continue
        is_lead = name == chosen
        # A four-stem model's leftover is the guitar when it is the part, unless
        # a real guitar stem is there too (the six-stem model with --lead other).
        stem_id = "guitar" if is_lead and name == "other" and "guitar" not in kept_names else name
        plans.append(
            StemPlan(
                source=name,
                id=stem_id,
                label=lead_label if is_lead else name.capitalize(),
                role="lead" if is_lead else None,
                dbfs=round(dbfs, 1),
            )
        )
    order = {k: i for i, k in enumerate(STEM_ORDER)}
    plans.sort(key=lambda p: (0 if p.role == "lead" else 1, order.get(p.id, 99), p.id))
    seen: set[str] = set()
    for plan in plans:
        if plan.id in seen:
            plan.id = f"{plan.id}-{plan.source}"
        seen.add(plan.id)
    return plans, dropped


def kept_fields(existing: dict | None) -> dict:
    """What a re-import must not lose: the player's own work."""
    if not existing:
        return {}
    # An empty list or chart set is nothing to keep, and saying so would mislead.
    out = {k: existing[k] for k in KEPT_FIELDS if existing.get(k) not in (None, [], {})}
    boxes: dict[str, list] = {}
    for page in (existing.get("scan") or {}).get("pages", []):
        if isinstance(page, dict) and page.get("boxes"):
            boxes[str(page.get("image"))] = page["boxes"]
    if boxes:
        out["scanBoxes"] = boxes
    return out


def build_song_json(
    *,
    title: str,
    artist: str | None,
    album: str | None,
    year: int | None,
    source: dict,
    stems: list[StemPlan],
    beats_per_bar: int,
    key: str | None,
    tempo_bpm: float | None,
    beat_candidates: list[float],
    scan_pages: list[str],
    kept: dict,
    detected_boxes: dict[str, list[dict]] | None = None,
) -> dict:
    song: dict = {"format": SONG_FORMAT, "title": title}
    if artist:
        song["artist"] = artist
    if album:
        song["album"] = album
    if year:
        song["year"] = year
    song["source"] = source
    song["stems"] = [
        {
            "id": s.id,
            "file": f"stems/{s.id}.mp3",
            **({"role": s.role} if s.role else {}),
            **({"label": s.label} if s.role else {}),
        }
        for s in stems
    ]
    song["key"] = kept.get("key", key)
    if song["key"] is None:
        del song["key"]
    song["beatsPerBar"] = kept.get("beatsPerBar", beats_per_bar)
    if tempo_bpm:
        song["tempoBpm"] = tempo_bpm
    song["bars"] = kept.get("bars", [])
    song["beatCandidates"] = beat_candidates
    song["sections"] = kept.get("sections", [])
    song["charts"] = kept.get("charts", {})
    if scan_pages:
        kept_boxes = kept.get("scanBoxes", {})
        found = detected_boxes or {}
        song["scan"] = {
            "pages": [
                {
                    "image": f"scan/{name}",
                    # The player's own boxes win; the detector only fills empty pages.
                    "boxes": kept_boxes.get(f"scan/{name}") or found.get(name, []),
                }
                for name in scan_pages
            ]
        }
    return song


# Steps with files -----------------------------------------------------------


def read_tags(path: Path) -> dict:
    from mutagen import File as MutagenFile

    info: dict = {
        "title": None,
        "artist": None,
        "album": None,
        "year": None,
        "kbps": None,
        "sample_rate": None,
    }
    audio = MutagenFile(str(path), easy=True)
    if audio is not None:
        tags = audio.tags or {}

        def first(key: str) -> str | None:
            value = tags.get(key)
            return str(value[0]).strip() if value else None

        info["title"] = first("title")
        info["artist"] = first("artist")
        info["album"] = first("album")
        date = first("date") or first("year")
        if date:
            m = re.search(r"\d{4}", date)
            info["year"] = int(m.group()) if m else None
        stream = getattr(audio, "info", None)
        if stream is not None:
            if getattr(stream, "bitrate", None):
                info["kbps"] = round(stream.bitrate / 1000)
            if getattr(stream, "sample_rate", None):
                info["sample_rate"] = stream.sample_rate
    if not info["title"]:
        info["title"] = title_from_filename(path)
    return info


def decode_to_wav(src: Path, dst: Path) -> tuple[float, int]:
    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    sf.write(str(dst), data, sr)
    return len(data) / sr, sr


def separate(wav: Path, work_dir: Path, model: str, models_dir: Path) -> dict[str, Path]:
    from .ffmpeg import ensure_ffmpeg

    ensure_ffmpeg()
    from audio_separator.separator import Separator

    models_dir.mkdir(parents=True, exist_ok=True)
    separator = Separator(
        output_dir=str(work_dir),
        output_format="WAV",
        model_file_dir=str(models_dir),
        log_level=logging.WARNING,
    )
    separator.load_model(model_filename=f"{model}.yaml")
    separator.separate(str(wav))
    return find_stems(work_dir, model)


def find_stems(work_dir: Path, model: str) -> dict[str, Path]:
    stems: dict[str, Path] = {}
    for path in work_dir.glob(f"*_(*)_{model}.wav"):
        m = re.search(r"_\((\w+)\)_", path.name)
        if m:
            stems[m.group(1).lower()] = path
    return stems


def rms_dbfs(path: Path) -> float:
    data, _ = sf.read(str(path), dtype="float32", always_2d=True)
    rms = float(np.sqrt(np.mean(np.square(data)))) if len(data) else 0.0
    return float(20 * np.log10(rms)) if rms > 0 else -120.0


def write_stem_mp3(src: Path, dst: Path) -> None:
    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    peak = float(np.max(np.abs(data))) if len(data) else 0.0
    if peak > 0.99:
        # Separation can overshoot; keep the encoder out of clipping.
        data = data * (0.99 / peak)
    try:
        sf.write(str(dst), data, sr, format="MP3", compression_level=0.2)
    except TypeError:
        sf.write(str(dst), data, sr, format="MP3")


def beat_candidates(sources: list[Path]) -> tuple[float | None, list[float]]:
    """Beat guesses from whatever keeps time best - the rhythm section if there is one."""
    import librosa

    parts: list[np.ndarray] = []
    sr = 0
    for path in sources:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        parts.append(data.mean(axis=1))
    if not parts:
        return None, []
    y = np.zeros(max(len(p) for p in parts), dtype=np.float32)
    for part in parts:
        y[: len(part)] += part
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", trim=False)
    bpm = float(np.atleast_1d(tempo)[0])
    return (round(bpm, 1) if bpm > 0 else None), [round(float(t), 3) for t in beats]


def render_pdf(pdf: Path, scan_dir: Path, dpi: int) -> list[str]:
    import pymupdf

    scan_dir.mkdir(parents=True, exist_ok=True)
    for old in scan_dir.glob("p*.png"):
        old.unlink()
    names: list[str] = []
    with pymupdf.open(str(pdf)) as doc:
        for index, page in enumerate(doc, start=1):
            name = f"p{index}.png"
            # Photocopied handwriting has no colour worth keeping, and grey
            # pages are a third the size when they are copied into the browser.
            page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY).save(str(scan_dir / name))
            names.append(name)
    return names


# The whole thing -------------------------------------------------------------


def run_import(options: ImportOptions, log: Log = print) -> ImportResult:
    started = time.monotonic()
    step_started = started

    def step(message: str) -> None:
        nonlocal step_started
        now = time.monotonic()
        log(f"[{now - started:6.1f}s] {message}")
        step_started = now

    track = options.track.resolve()
    if not track.exists():
        raise FileNotFoundError(f"no such track: {track}")
    if options.pdf is not None and not options.pdf.exists():
        raise FileNotFoundError(f"no such pdf: {options.pdf}")

    tags = read_tags(track)
    title = options.title or tags["title"]
    artist = options.artist or tags["artist"]
    album = options.album or tags["album"]
    year = options.year or tags["year"]
    slug = options.slug or slugify(artist, title)
    package = options.out_dir / slug
    package.mkdir(parents=True, exist_ok=True)
    step(f"{title} - {artist or 'unknown artist'} ({year or 'no year'}) -> {package}")

    existing: dict | None = None
    song_json_path = package / "song.json"
    if song_json_path.exists() and not options.fresh:
        try:
            existing = json.loads(song_json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("  the existing song.json does not parse; starting over")
    kept = kept_fields(existing)
    if kept:
        step(f"keeping from the existing package: {', '.join(sorted(k for k in kept))}")

    work = package / ".work"
    work.mkdir(exist_ok=True)
    wav = work / "track.wav"
    duration, sr = decode_to_wav(track, wav)
    step(f"decoded {duration:.1f} s at {sr} Hz" + (f", {tags['kbps']} kbps" if tags["kbps"] else ""))

    stems_dir = package / "stems"
    stems_dir.mkdir(exist_ok=True)
    plans: list[StemPlan]
    dropped: list[tuple[str, float]]
    if options.skip_separation:
        if not existing or not existing.get("stems"):
            raise RuntimeError("--skip-separation needs an existing package with stems")
        plans = [
            StemPlan(
                source=s["id"],
                id=s["id"],
                label=s.get("label", s["id"].capitalize()),
                role=s.get("role"),
                dbfs=rms_dbfs(package / s["file"]),
            )
            for s in existing["stems"]
        ]
        dropped = []
        step(f"kept the {len(plans)} stems already in the package")
    else:
        step(f"separating with {options.model} (this is the slow part)")
        separated = separate(wav, work, options.model, options.models_dir)
        if not separated:
            raise RuntimeError("the separator produced no stems")
        levels = {name: rms_dbfs(path) for name, path in separated.items()}
        plans, dropped = plan_stems(
            levels, options.model, options.lead, options.lead_label, options.silence_dbfs
        )
        step(
            "stems: "
            + ", ".join(f"{p.id} {p.dbfs} dBFS{' (the part)' if p.role == 'lead' else ''}" for p in plans)
            + (
                "; dropped as silent: " + ", ".join(f"{n} {d} dBFS" for n, d in dropped)
                if dropped
                else ""
            )
        )
        for old in stems_dir.glob("*.mp3"):
            old.unlink()
        for plan in plans:
            write_stem_mp3(separated[plan.source], stems_dir / f"{plan.id}.mp3")
        step(f"wrote {len(plans)} stems as MP3")

    rhythm = [stems_dir / f"{p.id}.mp3" for p in plans if p.id in ("drums", "bass")]
    tempo, beats = beat_candidates(rhythm if rhythm else [wav])
    step(
        f"beat guesses: {len(beats)} at about {tempo} bpm"
        + (" from the rhythm section" if rhythm else " from the whole mix")
    )

    scan_pages: list[str] = []
    if options.pdf is not None:
        scan_pages = render_pdf(options.pdf.resolve(), package / "scan", options.dpi)
        step(f"rendered {len(scan_pages)} tab page{'s' if len(scan_pages) != 1 else ''}")
    elif existing and existing.get("scan"):
        scan_pages = [
            Path(p["image"]).name for p in existing["scan"].get("pages", []) if "image" in p
        ]

    detected: dict[str, list[dict]] = {}
    if scan_pages and options.detect_bars:
        from .scan import detect_pages, write_preview

        kept_boxes = kept.get("scanBoxes", {})
        todo = [package / "scan" / name for name in scan_pages if f"scan/{name}" not in kept_boxes]
        todo = [p for p in todo if p.exists()]
        if todo:
            found = detect_pages(todo)
            for name, boxes in found.items():
                detected[name] = [b.as_json() for b in boxes]
                if options.scan_preview:
                    write_preview(package / "scan" / name, boxes, package / "scan" / f"{Path(name).stem}.boxes.png")
            counts = ", ".join(f"{name} {len(boxes)}" for name, boxes in found.items())
            step(
                f"found {sum(len(b) for b in found.values())} bars on the pages ({counts})"
                + ("; previews in scan/*.boxes.png" if options.scan_preview else "")
            )
        if len(todo) < len(scan_pages):
            step(f"kept the boxes already marked on {len(scan_pages) - len(todo)} page(s)")

    source = {"file": track.name, "separator": options.model}
    if tags["sample_rate"]:
        source["sampleRate"] = tags["sample_rate"]
    if tags["kbps"]:
        source["kbps"] = tags["kbps"]

    song = build_song_json(
        title=title,
        artist=artist,
        album=album,
        year=year,
        source=source,
        stems=plans,
        beats_per_bar=options.beats_per_bar,
        key=options.key,
        tempo_bpm=tempo,
        beat_candidates=beats,
        scan_pages=scan_pages,
        kept=kept,
        detected_boxes=detected,
    )
    song_json_path.write_text(json.dumps(song, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    step("wrote song.json")

    if not options.keep_work:
        shutil.rmtree(work, ignore_errors=True)

    return ImportResult(
        package=package,
        song_json=song,
        stems=plans,
        dropped=dropped,
        kept=sorted(kept),
        seconds=time.monotonic() - started,
    )
