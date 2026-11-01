"""Finding the bars on a handwritten tab page.

The pages are photocopies of tab written by hand on ruled staves: six long
horizontal lines per system drawn with a ruler, bar lines drawn down through
them, beat stems hanging below, numbers and chord names everywhere else. The
long straight strokes are what a ruler leaves and a hand does not, so they are
what this looks for.

Systems come from the rows that hold a long horizontal run of ink, grouped
where six of them sit close together. Bar lines come from the columns inside a
system that hold a vertical run of ink nearly as tall as the staff, which the
stems below and the digits inside never are. A bar is the box between two bar
lines, padded upward to take in the chord names and downward to take in the
stems. Numbering runs left to right, system by system, page by page; repeats
and endings are the player's to mark in the app.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import ndimage


@dataclass
class System:
    """One staff: where its lines are and how far they run."""

    lines: list[int]
    left: int
    right: int

    @property
    def top(self) -> int:
        return self.lines[0]

    @property
    def bottom(self) -> int:
        return self.lines[-1]

    @property
    def height(self) -> int:
        return max(1, self.bottom - self.top)


@dataclass
class Box:
    x: int
    y: int
    w: int
    h: int
    bars: list[int] = field(default_factory=list)

    def as_json(self) -> dict:
        return {"bars": list(self.bars), "x": self.x, "y": self.y, "w": self.w, "h": self.h}


# Image loading --------------------------------------------------------------


def load_gray(path: Path) -> np.ndarray:
    """A page as an 8-bit grey array, rows by columns."""
    import pymupdf

    pix = pymupdf.Pixmap(str(path))
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.n != 1:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()


def otsu_threshold(gray: np.ndarray) -> int:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 128
    levels = np.arange(256, dtype=np.float64)
    weight_bg = np.cumsum(hist)
    weight_fg = total - weight_bg
    sum_bg = np.cumsum(hist * levels)
    mean_bg = np.divide(sum_bg, weight_bg, out=np.zeros(256), where=weight_bg > 0)
    mean_fg = np.divide(sum_bg[-1] - sum_bg, weight_fg, out=np.zeros(256), where=weight_fg > 0)
    between = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
    return int(np.argmax(between))


def ink_mask(gray: np.ndarray) -> np.ndarray:
    """True where there is ink. Photocopies are two-toned, so a global threshold does."""
    # Otsu's split puts the threshold level itself in the dark class.
    ink = gray <= otsu_threshold(gray)
    # The outer edge of a photocopy is shadow, punch holes and the platen's
    # frame, never tab. Clear it so it cannot pass for lines.
    height, width = ink.shape
    margin_y, margin_x = max(4, height // 50), max(4, width // 50)
    ink[:margin_y, :] = False
    ink[-margin_y:, :] = False
    ink[:, :margin_x] = False
    ink[:, -margin_x:] = False
    return ink


# Geometry helpers -----------------------------------------------------------


def runs(indices: np.ndarray, gap: int) -> list[tuple[int, int]]:
    """Group sorted indices into runs where neighbours are at most `gap` apart."""
    if len(indices) == 0:
        return []
    out: list[tuple[int, int]] = []
    start = prev = int(indices[0])
    for value in indices[1:]:
        value = int(value)
        if value - prev > gap:
            out.append((start, prev))
            start = value
        prev = value
    out.append((start, prev))
    return out


def centres(index_runs: list[tuple[int, int]]) -> list[int]:
    return [(a + b) // 2 for a, b in index_runs]


def merge_close(values: list[int], within: int) -> list[int]:
    """Collapse values closer than `within` into their mean: a double bar line is one line."""
    if not values:
        return []
    values = sorted(values)
    groups: list[list[int]] = [[values[0]]]
    for v in values[1:]:
        if v - groups[-1][-1] <= within:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [int(round(sum(g) / len(g))) for g in groups]


# Systems --------------------------------------------------------------------


STAFF_LINES = 6


def horizontal_strokes(ink: np.ndarray, kernel: int) -> np.ndarray:
    """Ink that belongs to a horizontal stroke at least `kernel` pixels long.

    A scanned page is never quite level, so a two-pixel line drifts across
    rows and a strict row-wise opening breaks it. Thickening the ink by a
    pixel above and below first lets a stroke survive a degree or so of tilt.
    """
    thick = ndimage.binary_dilation(ink, structure=np.ones((3, 1), dtype=bool))
    return ndimage.binary_opening(thick, structure=np.ones((1, kernel), dtype=bool))


def comb_scores(peaks: np.ndarray, gap: int) -> np.ndarray:
    """For every top row, how much ink six teeth `gap` apart would land on."""
    height = len(peaks)
    span = (STAFF_LINES - 1) * gap
    if span >= height:
        return np.zeros(height)
    valid = height - span
    total = np.zeros(valid)
    for i in range(STAFF_LINES):
        total += peaks[i * gap : i * gap + valid]
    return np.concatenate([total, np.zeros(span)])


def find_systems(ink: np.ndarray, min_lines: int = 5) -> list[System]:
    """Staves, found as six rows of horizontal ink at one even spacing.

    Only the top line of a hand-ruled tab staff tends to be continuous; the
    others are dashes drawn between the numbers. So rows are scored on short
    horizontal strokes, and a staff is wherever a comb of six teeth lands on
    six strong rows. The tooth spacing is whichever plausible spacing gives the
    page its best comb anywhere.
    """
    height, width = ink.shape
    strokes = horizontal_strokes(ink, kernel=max(6, width // 150))
    profile = strokes.sum(axis=1).astype(np.float64)
    # A line a pixel off its expected row still counts.
    peaks = ndimage.maximum_filter1d(profile, size=3)

    min_row_ink = 0.04 * width

    def staff_shaped(top: int, gap: int) -> bool:
        """Six real lines, not three strong rows propping up three empty ones.

        A comb that straddles a staff and the blank space beside it can
        outscore the staff itself on the sum, so the second-weakest tooth has
        to be a line too.
        """
        if top + (STAFF_LINES - 1) * gap >= height:
            return False
        teeth = sorted(float(peaks[top + i * gap]) for i in range(STAFF_LINES))
        return teeth[1] >= max(min_row_ink, 0.25 * teeth[STAFF_LINES // 2])

    # Tab staves at this scale sit roughly 3 to 6 mm apart, and two staves on
    # one hand-ruled page need not agree, so every row is scored at every
    # plausible spacing and keeps its best. Six teeth on six lines beats any
    # near miss by a wide margin.
    lo = max(6, width // 90)
    hi = max(lo + 2, width // 32)
    gaps = list(range(lo, hi + 1))
    table = np.stack([comb_scores(peaks, gap) for gap in gaps])
    best_gap_index = table.argmax(axis=0)
    scores = table.max(axis=0)
    if scores.max() <= 0:
        return []
    gap_at = [gaps[i] for i in best_gap_index]

    # Staff-shaped peaks in descending order, each a whole staff clear of a stronger one.
    floor = 0.35 * scores.max()
    candidates: list[int] = []
    for r in np.argsort(scores)[::-1]:
        r = int(r)
        if scores[r] < floor:
            break
        if not staff_shaped(r, gap_at[r]):
            continue
        reach = (STAFF_LINES - 1) * max(gap_at[r], *(gap_at[c] for c in candidates), lo) + 4
        if all(abs(r - c) > reach for c in candidates):
            candidates.append(r)

    # One hand rules one page: a "staff" spaced very differently from the
    # strongest few is a title box or a block of text.
    if candidates:
        usual = float(np.median([gap_at[c] for c in candidates[:3]]))
        candidates = [c for c in candidates if abs(gap_at[c] - usual) <= 0.25 * usual]
    candidates.sort()

    systems: list[System] = []
    for top in candidates:
        best_gap = gap_at[top]
        lines: list[int] = []
        for i in range(STAFF_LINES):
            row = min(height - 1, top + i * best_gap)
            start = max(0, row - 1)
            lines.append(start + int(np.argmax(profile[start : row + 2])))
        if sum(1 for row in lines if profile[row] >= min_row_ink) < min_lines:
            continue
        # The staff runs as far as its dashes do: the longest stretch of columns
        # with ink near any line (a few rows of slack, since a scanned page is
        # never quite level), allowing the gaps where numbers are written.
        near_lines = np.zeros(width, dtype=bool)
        for row in lines:
            near_lines |= strokes[max(0, row - 4) : row + 5, :].any(axis=0)
        inked = np.where(near_lines)[0]
        stretches = runs(inked, gap=max(10, width // 10))
        if not stretches:
            continue
        left, right = max(stretches, key=lambda s: s[1] - s[0])
        if right - left < width // 5:
            continue
        systems.append(System(lines=lines, left=int(left), right=int(right)))
    return systems


# Bar lines ------------------------------------------------------------------


def find_bar_lines(ink: np.ndarray, system: System) -> list[int]:
    """Columns inside the system where a vertical stroke spans most of the staff."""
    margin = 2
    top = max(0, system.top - margin)
    bottom = min(ink.shape[0], system.bottom + margin + 1)
    band = ink[top:bottom, system.left : system.right + 1]
    band_height = band.shape[0]
    # A hand-drawn bar line slants a pixel or two over the height of the
    # staff; thickened sideways by a pixel it stays one column-wise stroke.
    thick = ndimage.binary_dilation(band, structure=np.ones((1, 3), dtype=bool))
    kernel = max(8, int(band_height * 0.6))
    vertical = ndimage.binary_opening(thick, structure=np.ones((kernel, 1), dtype=bool))
    # A bar line crosses the whole staff. A beat stem that starts on the
    # third line, or a tall digit, is long but never reaches both edges.
    quarter = max(2, band_height // 4)
    reaches_top = vertical[:quarter, :].any(axis=0)
    reaches_bottom = vertical[-quarter:, :].any(axis=0)
    column_ink = vertical.sum(axis=0)
    columns = np.where((column_ink >= 0.5 * band_height) & reaches_top & reaches_bottom)[0]
    found = [c + system.left for c in centres(runs(columns, gap=3))]

    # Some hands draw every beat stem through the whole staff. A bar line stops
    # at or just past the bottom line; a stem carries on half a staff below it.
    stem_tail = int(system.height * 0.3)
    tail_top = min(ink.shape[0], system.bottom + 3)
    if tail_top < ink.shape[0]:
        kept: list[int] = []
        for x in found:
            column = ink[tail_top:, max(0, x - 1) : x + 2].any(axis=1)
            run = 0
            for inked in column:
                if not inked:
                    break
                run += 1
            if run < stem_tail:
                kept.append(x)
        found = kept
    merged = merge_close(found, within=max(6, ink.shape[1] // 90))

    # A double bar line or a repeat sign is two strokes a finger's width apart;
    # once the typical bar is known, anything under a fifth of it is one line.
    if len(merged) > 2:
        typical = float(np.median(np.diff(merged)))
        merged = merge_close(merged, within=int(0.2 * typical))

    # A staff that starts or ends without a drawn line still starts and ends.
    if merged:
        typical = float(np.median(np.diff(merged))) if len(merged) > 1 else system.right - system.left
        if merged[0] - system.left > 0.35 * typical:
            merged.insert(0, system.left)
        if system.right - merged[-1] > 0.35 * typical:
            merged.append(system.right)
    else:
        merged = [system.left, system.right]
    return merged


# Boxes ----------------------------------------------------------------------


def boxes_for_page(ink: np.ndarray, systems: list[System]) -> list[Box]:
    height = ink.shape[0]
    boxes: list[Box] = []
    for index, system in enumerate(systems):
        lines = find_bar_lines(ink, system)
        if len(lines) < 2:
            continue
        widths = np.diff(lines)
        typical = float(np.median(widths))
        staff = system.height
        above = system.top - int(0.9 * staff)
        below = system.bottom + int(1.2 * staff)
        # Never reach into the neighbouring staves.
        if index > 0:
            above = max(above, (systems[index - 1].bottom + system.top) // 2 + 1)
        if index < len(systems) - 1:
            below = min(below, (system.bottom + systems[index + 1].top) // 2 - 1)
        above = max(0, above)
        below = min(height - 1, below)
        for left, right in zip(lines, lines[1:]):
            if right - left < max(6, 0.2 * typical):
                continue
            boxes.append(Box(x=int(left), y=int(above), w=int(right - left), h=int(below - above)))
    return boxes


def detect_page(path: Path) -> list[Box]:
    gray = load_gray(path)
    ink = ink_mask(gray)
    return boxes_for_page(ink, find_systems(ink))


def detect_pages(paths: list[Path], first_bar: int = 1) -> dict[str, list[Box]]:
    """Boxes for each page, numbered straight through from `first_bar`."""
    out: dict[str, list[Box]] = {}
    bar = first_bar
    for path in paths:
        boxes = detect_page(path)
        for box in boxes:
            box.bars = [bar]
            bar += 1
        out[path.name] = boxes
    return out


# A picture to check against -------------------------------------------------


def write_preview(image: Path, boxes: list[Box], out: Path) -> None:
    """The page with its boxes and bar numbers drawn on, for a human to judge."""
    import pymupdf

    pix = pymupdf.Pixmap(str(image))
    doc = pymupdf.open()
    page = doc.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, pixmap=pix)
    red = (0.85, 0.1, 0.1)
    for box in boxes:
        rect = pymupdf.Rect(box.x, box.y, box.x + box.w, box.y + box.h)
        page.draw_rect(rect, color=red, width=1.2)
        label = ",".join(str(b) for b in box.bars) or "?"
        page.insert_text((box.x + 3, box.y + 12), label, fontsize=9, color=red)
    page.get_pixmap(dpi=72).save(str(out))
    doc.close()
