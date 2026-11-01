"""An ffmpeg the separator can find, without installing one on the machine.

audio-separator runs `ffmpeg -version` when it starts and refuses to go on if
that fails, even though the work here never needs ffmpeg (the input is decoded
to WAV first and the stems are written with libsndfile). imageio-ffmpeg ships a
static binary under its own long name, so the first run copies it into the
environment as plain `ffmpeg.exe` and puts that folder on the PATH of this
process. Nothing outside the virtual environment is touched.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def ensure_ffmpeg() -> Path:
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    import imageio_ffmpeg

    source = Path(imageio_ffmpeg.get_ffmpeg_exe())
    bin_dir = Path(sys.prefix) / "ffbin"
    bin_dir.mkdir(exist_ok=True)
    target = bin_dir / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if not target.exists():
        shutil.copy2(source, target)
    os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    return target
