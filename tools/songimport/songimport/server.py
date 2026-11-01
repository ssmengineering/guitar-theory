"""The local helper: the app, the packages and the import tool behind one port.

Separating a record is a model that wants the whole processor for minutes,
which a web page cannot be trusted with. So the page drives this instead: a
small server on the player's own machine that serves the built app, lists the
record and tab libraries paired up, runs imports in the background and reports
their progress, and serves the finished packages. Nothing leaves the machine;
the server listens on localhost only.

The package routes keep the same shape the Vite dev plugin gives them, so the
app's storage code works unchanged against either.
"""

from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
import traceback
import uuid
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .library import library, parse_track_file
from .pipeline import ImportOptions, run_import

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".txt": "text/plain; charset=utf-8",
}


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"


@dataclass
class Job:
    id: str
    track: str
    title: str
    state: str = "running"
    log: list[str] = field(default_factory=list)
    result: dict | None = None
    error: str | None = None
    started: float = field(default_factory=time.time)
    finished: float | None = None

    def as_json(self) -> dict:
        return {
            "id": self.id,
            "track": self.track,
            "title": self.title,
            "state": self.state,
            "log": list(self.log),
            "result": self.result,
            "error": self.error,
            "seconds": round((self.finished or time.time()) - self.started, 1),
        }


class Helper:
    def __init__(self, music: Path | None, tabs: Path | None, songs: Path, app: Path):
        self.music = music
        self.tabs = tabs
        self.songs = songs
        self.app = app
        self.jobs: dict[str, Job] = {}
        self.order: list[str] = []
        self.lock = threading.Lock()

    # Packages ---------------------------------------------------------------

    def package_index(self) -> list[dict]:
        out: list[dict] = []
        if not self.songs.is_dir():
            return out
        for folder in sorted(self.songs.iterdir()):
            file = folder / "song.json"
            if not file.is_file():
                continue
            try:
                song = json.loads(file.read_text(encoding="utf-8"))
                out.append({"slug": folder.name, "title": song.get("title", folder.name), "artist": song.get("artist")})
            except json.JSONDecodeError:
                out.append({"slug": folder.name, "title": f"{folder.name} (song.json does not parse)"})
        return out

    def packages_by_source(self) -> dict[str, dict]:
        """Which record each package came from, by the record's file name."""
        out: dict[str, dict] = {}
        if not self.songs.is_dir():
            return out
        for folder in self.songs.iterdir():
            file = folder / "song.json"
            if not file.is_file():
                continue
            try:
                song = json.loads(file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            source = (song.get("source") or {}).get("file")
            if source:
                out[source] = {"slug": folder.name, "title": song.get("title", folder.name)}
        return out

    def library_json(self) -> dict:
        if self.music is None or self.tabs is None:
            return {"music": None, "tabs": None, "albums": [], "unmatchedTabFolders": []}
        return library(self.music, self.tabs, self.packages_by_source())

    # Jobs -------------------------------------------------------------------

    def running(self) -> Job | None:
        return next((j for j in self.jobs.values() if j.state == "running"), None)

    def start_import(self, request: dict) -> Job:
        track = Path(str(request.get("track", "")))
        if not track.is_file():
            raise ValueError(f"no such record: {track}")
        pdf_text = request.get("pdf")
        pdf = Path(str(pdf_text)) if pdf_text else None
        if pdf is not None and not pdf.is_file():
            raise ValueError(f"no such tab: {pdf}")
        with self.lock:
            if self.running() is not None:
                raise RuntimeError("an import is already running; wait for it to finish")
            job = Job(id=uuid.uuid4().hex[:8], track=str(track), title=parse_track_file(track.name)[1])
            self.jobs[job.id] = job
            self.order.append(job.id)
            for old in self.order[:-20]:
                self.jobs.pop(old, None)
            self.order = self.order[-20:]

        options = ImportOptions(
            track=track,
            out_dir=self.songs,
            pdf=pdf,
            model=str(request.get("model") or "htdemucs_ft"),
            lead=request.get("lead") or None,
            lead_label=str(request.get("leadLabel") or "Guitar"),
            beats_per_bar=int(request.get("beats") or 4),
            key=(str(request["key"]).strip() or None) if request.get("key") else None,
            fresh=bool(request.get("fresh")),
            skip_separation=bool(request.get("skipSeparation")),
        )

        def work() -> None:
            try:
                result = run_import(options, log=job.log.append)
                job.result = {
                    "slug": result.package.name,
                    "title": result.song_json.get("title"),
                    "stems": [s.id for s in result.stems],
                    "dropped": [name for name, _ in result.dropped],
                    "kept": result.kept,
                }
                job.state = "done"
            except Exception as error:  # noqa: BLE001 - the job reports whatever went wrong
                job.error = f"{type(error).__name__}: {error}"
                job.log.append(traceback.format_exc().strip().splitlines()[-1])
                job.state = "failed"
            finally:
                job.finished = time.time()

        threading.Thread(target=work, name=f"import-{job.id}", daemon=True).start()
        return job


def make_handler(helper: Helper):
    class Handler(BaseHTTPRequestHandler):
        server_version = "songimport"
        # Keep-alive, as browsers expect; every response carries its length.
        protocol_version = "HTTP/1.1"

        # Plumbing -----------------------------------------------------------

        def log_message(self, fmt: str, *args) -> None:  # noqa: D401 - quiet except for the API
            if self.path.startswith("/api/") and not self.path.startswith("/api/jobs/"):
                print(f"  {self.command} {self.path}")

        def send_json(self, payload: object, status: int = 200) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path, cache: str) -> None:
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type(path))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(data)

        def read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(length) if length > 0 else b""

        def inside(self, root: Path, relative: str) -> Path | None:
            """A path under `root`, or None if it escapes or does not exist."""
            target = (root / relative).resolve()
            try:
                target.relative_to(root.resolve())
            except ValueError:
                return None
            return target

        # Routes -------------------------------------------------------------

        def do_GET(self) -> None:  # noqa: N802 - http.server's name
            url = urlparse(self.path)
            path = unquote(url.path)
            if path == "/api/library":
                self.send_json(helper.library_json())
            elif path == "/api/jobs":
                jobs = [helper.jobs[i].as_json() for i in helper.order if i in helper.jobs]
                self.send_json({"jobs": jobs[-5:], "running": helper.running() is not None})
            elif path.startswith("/api/jobs/"):
                job = helper.jobs.get(path.rsplit("/", 1)[1])
                if job is None:
                    self.send_json({"error": "no such job"}, 404)
                else:
                    self.send_json(job.as_json())
            elif path == "/api/health":
                self.send_json({"ok": True, "songs": str(helper.songs), "app": str(helper.app)})
            elif path == "/dev-songs/index.json":
                self.send_json(helper.package_index())
            elif path.startswith("/dev-songs/"):
                target = self.inside(helper.songs, path[len("/dev-songs/") :])
                if target is None or not target.is_file():
                    self.send_json({"error": "not found"}, 404)
                else:
                    self.send_file(target, "no-cache")
            else:
                self.serve_app(path)

        def serve_app(self, path: str) -> None:
            relative = path.lstrip("/") or "index.html"
            if relative == "registerSW.js":
                # The service worker exists to make the public site work
                # offline. Served from this machine the app already is, and the
                # worker's own fetch of sw.js fails on this server, so the
                # registration script is served empty.
                body = b"// no service worker when served by the local helper\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)
                return
            target = self.inside(helper.app, relative)
            if target is None or not target.is_file():
                target = helper.app / "index.html"
            if not target.is_file():
                self.send_json(
                    {"error": "the app is not built; run npm run build in the project folder"}, 503
                )
                return
            cache = "no-cache" if target.suffix in (".html", ".webmanifest") or target.name.endswith("sw.js") else "public, max-age=31536000, immutable"
            if "assets" not in target.parts:
                cache = "no-cache"
            self.send_file(target, cache)

        def do_POST(self) -> None:  # noqa: N802
            path = unquote(urlparse(self.path).path)
            if path != "/api/import":
                self.send_json({"error": "not found"}, 404)
                return
            try:
                request = json.loads(self.read_body() or b"{}")
                job = helper.start_import(request)
                print(f"  importing {job.title}")
                self.send_json(job.as_json(), 202)
            except (ValueError, RuntimeError, json.JSONDecodeError) as error:
                self.send_json({"error": str(error)}, 409 if isinstance(error, RuntimeError) else 400)

        def do_PUT(self) -> None:  # noqa: N802
            path = unquote(urlparse(self.path).path)
            if not path.startswith("/dev-songs/") or not path.endswith("/song.json"):
                self.send_json({"error": "only song.json can be written"}, 404)
                return
            target = self.inside(helper.songs, path[len("/dev-songs/") :])
            if target is None or not target.parent.is_dir():
                self.send_json({"error": "no such package"}, 404)
                return
            body = self.read_body()
            try:
                json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self.send_json({"error": "that is not JSON"}, 400)
                return
            target.write_bytes(body)
            self.send_response(204)
            self.end_headers()

    return Handler


def serve(
    music: Path | None,
    tabs: Path | None,
    songs: Path,
    app: Path,
    port: int = 8765,
    open_browser: bool = True,
) -> None:
    helper = Helper(music, tabs, songs, app)

    class HelperServer(ThreadingHTTPServer):
        # On Windows, address reuse lets a second helper bind the same port
        # beside the first and silently take none of the traffic. Fail instead.
        allow_reuse_address = os.name != "nt"

    try:
        server = HelperServer(("127.0.0.1", port), make_handler(helper))
    except OSError as error:
        print(f"songimport: port {port} is taken, probably by a helper already running: {error}")
        raise SystemExit(1) from error
    url = f"http://localhost:{port}/"
    print(f"Guitar Theory helper at {url}")
    print(f"  app      {app}{'' if (app / 'index.html').is_file() else '  (not built yet: run npm run build)'}")
    print(f"  songs    {songs}")
    print(f"  records  {music or '(not set)'}")
    print(f"  tabs     {tabs or '(not set)'}")
    print("Leave this window open while you play. Ctrl+C stops it.")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
