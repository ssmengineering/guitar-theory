"""Pairing the record library with the tab library, from names alone.

The records live in folders like `1955_ChetAtkinsInThreeDimensions` holding
`03OchiChornya(LesYeuxNoirs).MP3`; the tabs in folders like
`02 (1955) Chet Atkins In 3 Dimensions LPM-1197` holding `03 Dark Eyes.pdf`.
Years and track numbers line up; titles mostly do, spelled differently. So an
album is paired with the tab folder of the same year whose title reads most
like its own, and a track with the tab of the same number. Everything here is
pure string work over directory listings, so it is tested without a drive.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg"}
TAB_EXTENSIONS = {".pdf"}

NUMBER_WORDS = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
}
NOISE_TOKENS = {"lpm", "lsp", "inch", "reissue", "re", "issue", "w", "with", "the", "a", "of"}


@dataclass
class Track:
    number: int | None
    title: str
    path: Path


@dataclass
class Tab:
    number: int | None
    title: str
    path: Path


@dataclass
class Album:
    name: str
    year: int | None
    title: str
    path: Path
    tracks: list[Track] = field(default_factory=list)


@dataclass
class TabFolder:
    name: str
    year: int | None
    title: str
    path: Path
    tabs: list[Tab] = field(default_factory=list)


# Names -------------------------------------------------------------------


def pretty_title(text: str) -> str:
    """`OchiChornya(LesYeuxNoirs)` reads as `Ochi Chornya (Les Yeux Noirs)`."""
    s = text.replace("_", " ").replace("-w-", " with ")
    s = re.sub(r"(?<=[a-z0-9'])(?=[A-Z])", " ", s)
    # "ASession" is "A Session": a capital followed by a capitalised word.
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", s)
    s = re.sub(r"(?<=\S)\(", " (", s)
    s = re.sub(r"\)(?=\S)", ") ", s)
    s = re.sub(r"\s*-\s*", " - ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_album_folder(name: str) -> tuple[int | None, str]:
    m = re.match(r"^(\d{4})[_\s-]+(.+)$", name)
    if not m:
        return None, pretty_title(name)
    return int(m.group(1)), pretty_title(m.group(2))


def parse_track_file(name: str) -> tuple[int | None, str]:
    stem = Path(name).stem
    m = re.match(r"^(\d{1,3})[\s._-]*(.+)$", stem)
    if not m:
        return None, pretty_title(stem)
    return int(m.group(1)), pretty_title(m.group(2))


def parse_tab_folder(name: str) -> tuple[int | None, str]:
    m = re.match(r"^\s*\d*\s*\((\d{4})\)\s*(.+)$", name)
    if not m:
        return None, pretty_title(name)
    title = re.sub(r"\s+(LPM|LSP)[\s-]*[\dA-Z-]*$", "", m.group(2), flags=re.IGNORECASE)
    return int(m.group(1)), pretty_title(title)


def parse_tab_file(name: str) -> tuple[int | None, str]:
    return parse_track_file(name)


def tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", title.lower().replace("'", ""))
    out: set[str] = set()
    for word in words:
        word = NUMBER_WORDS.get(word, word)
        if word in NOISE_TOKENS or (word.isdigit() and len(word) >= 3):
            continue
        out.add(word)
    return out


def similarity(a: str, b: str) -> float:
    """How alike two titles read: shared words, or the same letters run together."""
    ta, tb = tokens(a), tokens(b)
    jaccard = len(ta & tb) / len(ta | tb) if ta | tb else 0.0
    if sorted(ta) == sorted(tb) and ta:
        return 1.0
    # The letters in their written order: "Finger-Style" and "Fingerstyle" are
    # one word apart only on paper.
    flat_a = re.sub(r"[^a-z0-9]", "", a.lower())
    flat_b = re.sub(r"[^a-z0-9]", "", b.lower())
    if flat_a and flat_b and (flat_a in flat_b or flat_b in flat_a):
        return max(jaccard, 0.8)
    # "In Hollywood" against "Chet Atkins In Hollywood - City Skyline": the
    # shorter title is all there, which is the same title cut down.
    smaller, larger = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if len(smaller) >= 2 and smaller <= larger:
        return max(jaccard, 0.7)
    return jaccard


# Listing -------------------------------------------------------------------


def scan_music(root: Path) -> list[Album]:
    albums: list[Album] = []
    if not root.is_dir():
        return albums
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        year, title = parse_album_folder(folder.name)
        tracks: list[Track] = []
        for file in sorted(folder.iterdir()):
            if file.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            number, track_title = parse_track_file(file.name)
            tracks.append(Track(number=number, title=track_title, path=file))
        if tracks:
            albums.append(Album(name=folder.name, year=year, title=title, path=folder, tracks=tracks))
    return albums


def scan_tabs(root: Path) -> list[TabFolder]:
    folders: list[TabFolder] = []
    if not root.is_dir():
        return folders
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        year, title = parse_tab_folder(folder.name)
        tabs: list[Tab] = []
        for file in sorted(folder.iterdir()):
            if file.suffix.lower() not in TAB_EXTENSIONS:
                continue
            number, tab_title = parse_tab_file(file.name)
            tabs.append(Tab(number=number, title=tab_title, path=file))
        if tabs:
            folders.append(TabFolder(name=folder.name, year=year, title=title, path=folder, tabs=tabs))
    return folders


# Pairing -------------------------------------------------------------------

MIN_FOLDER_MATCH = 0.4
MIN_CROSS_YEAR_MATCH = 0.6
MIN_TITLE_MATCH = 0.5


def folder_score(album: Album, folder: TabFolder) -> float:
    """How well a tab folder fits an album: title likeness, with a higher bar when the years disagree."""
    score = similarity(album.title, folder.title)
    floor = MIN_FOLDER_MATCH if folder.year == album.year else MIN_CROSS_YEAR_MATCH
    return score if score >= floor else 0.0


def pair_album(album: Album, folders: list[TabFolder]) -> TabFolder | None:
    """The tab folder for one album on its own, the best fit that clears the bar."""
    scored = [(folder_score(album, f), f) for f in folders]
    scored = [s for s in scored if s[0] > 0]
    return max(scored, key=lambda s: s[0])[1] if scored else None


def pair_albums(albums: list[Album], folders: list[TabFolder]) -> dict[str, TabFolder | None]:
    """Every album's tab folder, each folder given to the album that fits it best."""
    candidates = sorted(
        ((folder_score(a, f), a, f) for a in albums for f in folders),
        key=lambda c: c[0],
        reverse=True,
    )
    chosen: dict[str, TabFolder | None] = {a.name: None for a in albums}
    taken: set[str] = set()
    for score, album, folder in candidates:
        if score <= 0:
            break
        if chosen[album.name] is not None or folder.name in taken:
            continue
        chosen[album.name] = folder
        taken.add(folder.name)
    return chosen


def pair_track(track: Track, folder: TabFolder | None) -> Tab | None:
    """The tab for a track: the same number, else a title that reads the same."""
    if folder is None:
        return None
    if track.number is not None:
        by_number = [t for t in folder.tabs if t.number == track.number]
        if len(by_number) == 1:
            return by_number[0]
    scored = [(similarity(track.title, t.title), t) for t in folder.tabs]
    scored = [s for s in scored if s[0] >= MIN_TITLE_MATCH]
    return max(scored, key=lambda s: s[0])[1] if scored else None


def library(music_root: Path, tabs_root: Path, packages: dict[str, dict]) -> dict:
    """Everything the Import panel shows, JSON-shaped.

    `packages` maps a record's file name to the package made from it, so a
    track can say it is already in.
    """
    albums = scan_music(music_root)
    folders = scan_tabs(tabs_root)
    paired = pair_albums(albums, folders)
    out_albums = []
    for album in albums:
        folder = paired[album.name]
        tracks = []
        for track in album.tracks:
            tab = pair_track(track, folder)
            made = packages.get(track.path.name)
            tracks.append(
                {
                    "number": track.number,
                    "title": track.title,
                    "file": str(track.path),
                    "tab": {"title": tab.title, "file": str(tab.path)} if tab else None,
                    "package": made,
                }
            )
        out_albums.append(
            {
                "name": album.name,
                "year": album.year,
                "title": album.title,
                "folder": str(album.path),
                "tabFolder": folder.name if folder else None,
                "tracks": tracks,
            }
        )
    used = {f.name for f in paired.values() if f is not None}
    return {
        "music": str(music_root),
        "tabs": str(tabs_root),
        "albums": out_albums,
        "unmatchedTabFolders": [f.name for f in folders if f.name not in used],
    }
