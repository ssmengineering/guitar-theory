"""The command line.

    songimport "track.mp3" --pdf "tab.pdf"
    songimport "track.mp3" --model htdemucs_6s --beats 3 --key Dm
    songimport --check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .pipeline import DEFAULT_LEAD, ImportOptions, run_import

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "songs"


def check() -> int:
    """Say what this environment can do, so a broken setup is obvious before a ten-minute run."""
    from .ffmpeg import ensure_ffmpeg

    print(f"songimport {__version__}")
    print(f"python     {sys.version.split()[0]} at {sys.executable}")
    try:
        import torch

        device = "CUDA " + torch.version.cuda if torch.cuda.is_available() else "CPU only"
        print(f"torch      {torch.__version__} ({device})")
    except ImportError as error:
        print(f"torch      missing: {error}")
        return 1
    try:
        from importlib.metadata import version

        import audio_separator  # noqa: F401  (import fails loudly if a dependency is missing)

        print(f"separator  audio-separator {version('audio-separator')}")
    except ImportError as error:
        print(f"separator  missing: {error}")
        return 1
    print(f"ffmpeg     {ensure_ffmpeg()}")
    print(f"songs      {DEFAULT_OUT}")
    print(f"models     {ImportOptions(track=Path('.'), out_dir=Path('.')).models_dir}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="songimport",
        description="Turn a record and its tab into a song package for the Guitar Theory app.",
    )
    parser.add_argument("track", nargs="?", type=Path, help="the MP3, WAV or FLAC of the record")
    parser.add_argument("--pdf", type=Path, help="the handwritten tab, rendered to PNG pages")
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help=f"folder that holds packages (default: {DEFAULT_OUT})"
    )
    parser.add_argument(
        "--model",
        default="htdemucs_ft",
        choices=sorted(DEFAULT_LEAD),
        help="htdemucs_ft is the best four-stem split; htdemucs_6s also separates guitar and piano",
    )
    parser.add_argument(
        "--lead",
        help="which separated stem is the part you are learning (default: the model's guitar stem, "
        "or 'other' for the four-stem models); 'none' for no lead",
    )
    parser.add_argument("--lead-label", default="Guitar", help="what the mixer calls the part")
    parser.add_argument("--beats", type=int, default=4, help="beats per bar (default 4)")
    parser.add_argument("--key", help="the key, e.g. Dm or Bb")
    parser.add_argument("--title")
    parser.add_argument("--artist")
    parser.add_argument("--album")
    parser.add_argument("--year", type=int)
    parser.add_argument("--slug", help="package folder name (default: from artist and title)")
    parser.add_argument(
        "--fresh", action="store_true", help="discard an existing package's chart, bars and key"
    )
    parser.add_argument(
        "--skip-separation",
        action="store_true",
        help="keep the stems already in the package; redo the beats, the tab pages and song.json",
    )
    parser.add_argument("--keep-work", action="store_true", help="leave the .work folder behind")
    parser.add_argument("--models-dir", type=Path, help="where separator models are cached")
    parser.add_argument("--dpi", type=int, default=110, help="tab page rendering (default 110)")
    parser.add_argument("--check", action="store_true", help="report the environment and exit")
    parser.add_argument("--version", action="version", version=f"songimport {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.check:
        return check()
    if args.track is None:
        parser.error("a track is required (or --check)")
    if args.beats < 1:
        parser.error("--beats must be at least 1")

    options = ImportOptions(
        track=args.track,
        out_dir=args.out,
        pdf=args.pdf,
        model=args.model,
        lead=args.lead,
        lead_label=args.lead_label,
        beats_per_bar=args.beats,
        key=args.key,
        title=args.title,
        artist=args.artist,
        album=args.album,
        year=args.year,
        slug=args.slug,
        fresh=args.fresh,
        skip_separation=args.skip_separation,
        keep_work=args.keep_work,
        dpi=args.dpi,
    )
    if args.models_dir is not None:
        options.models_dir = args.models_dir

    try:
        result = run_import(options)
    except (FileNotFoundError, RuntimeError) as error:
        print(f"songimport: {error}", file=sys.stderr)
        return 1

    song = result.song_json
    print()
    print(f"Done in {result.seconds / 60:.1f} min: {result.package}")
    print(f"  {song['title']}" + (f" - {song['artist']}" if song.get("artist") else ""))
    for stem in result.stems:
        print(f"  stem {stem.id:8s} {stem.dbfs:7.1f} dBFS" + ("  <- the part" if stem.role == "lead" else ""))
    for name, dbfs in result.dropped:
        print(f"  dropped {name} ({dbfs} dBFS, silent)")
    print(f"  {len(song['beatCandidates'])} beat guesses, about {song.get('tempoBpm')} bpm")
    if song.get("scan"):
        print(f"  {len(song['scan']['pages'])} tab pages")
    if result.kept:
        print(f"  kept from before: {', '.join(result.kept)}")
    print("Open it on the Song screen: it is in the dev folder list, or import the folder.")
    return 0
