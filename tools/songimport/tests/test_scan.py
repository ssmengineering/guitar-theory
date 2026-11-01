"""The bar detector, on staves drawn with numpy rather than a pen."""

import unittest

import numpy as np

from songimport.scan import (
    boxes_for_page,
    find_bar_lines,
    find_systems,
    ink_mask,
    merge_close,
    runs,
)


def blank(height=800, width=900):
    return np.full((height, width), 235, dtype=np.uint8)


def draw_staff(page, top, left=60, right=840, gap=12, thickness=2):
    """Six ruled lines. Returns the rows of the lines."""
    rows = [top + i * gap for i in range(6)]
    for row in rows:
        page[row : row + thickness, left:right] = 20
    return rows


def draw_bar_line(page, x, top, bottom, thickness=2):
    page[top : bottom + 1, x : x + thickness] = 20


def draw_stem(page, x, bottom, length=40):
    page[bottom + 2 : bottom + 2 + length, x : x + 2] = 20


class Helpers(unittest.TestCase):
    def test_runs_and_merge(self):
        self.assertEqual(runs(np.array([1, 2, 3, 7, 8, 20]), gap=1), [(1, 3), (7, 8), (20, 20)])
        self.assertEqual(runs(np.array([]), gap=1), [])
        self.assertEqual(merge_close([100, 104, 300, 500, 503, 506], within=6), [102, 300, 503])
        self.assertEqual(merge_close([], within=6), [])


class Detection(unittest.TestCase):
    def setUp(self):
        self.page = blank()
        self.rows_a = draw_staff(self.page, top=150)
        self.rows_b = draw_staff(self.page, top=400)
        # System A: four bars, the last one closed by the staff's end.
        for x in (60, 260, 460, 660):
            draw_bar_line(self.page, x, self.rows_a[0], self.rows_a[-1] + 1)
        # A beat stem drawn right through the staff and 50 px below it: not a bar line.
        draw_bar_line(self.page, 360, self.rows_a[0], self.rows_a[-1] + 50)
        # System B: three bars, with a double bar line and some stems and digits.
        for x in (60, 320, 324, 580, 838):
            draw_bar_line(self.page, x, self.rows_b[0], self.rows_b[-1] + 1)
        for x in (120, 180, 240):
            draw_stem(self.page, x, self.rows_b[-1])
        # A "1" written inside the staff, two gaps tall: not a bar line.
        self.page[self.rows_b[1] : self.rows_b[3], 700:702] = 20
        # A title box: two long lines, not a staff.
        self.page[30:32, 300:600] = 20
        self.page[70:72, 300:600] = 20
        self.ink = ink_mask(self.page)

    def test_finds_the_two_staves_and_not_the_title_box(self):
        systems = find_systems(self.ink)
        self.assertEqual(len(systems), 2)
        for found, drawn in zip(systems[0].lines, self.rows_a):
            self.assertLessEqual(abs(found - drawn), 2)
        self.assertLessEqual(abs(systems[0].left - 60), 2)
        self.assertLessEqual(abs(systems[0].right - 839), 2)

    def test_bar_lines_ignore_stems_and_digits_and_merge_double_bars(self):
        systems = find_systems(self.ink)
        lines_a = find_bar_lines(self.ink, systems[0])
        self.assertEqual(len(lines_a), 5)  # four drawn, plus the staff's right end
        self.assertLessEqual(abs(lines_a[0] - 60), 2)
        self.assertLessEqual(abs(lines_a[-1] - 839), 2)
        lines_b = find_bar_lines(self.ink, systems[1])
        self.assertEqual(len(lines_b), 4)  # the double bar counts once
        self.assertLessEqual(abs(lines_b[1] - 322), 3)

    def test_boxes_cover_the_bars_without_crossing_into_the_next_staff(self):
        systems = find_systems(self.ink)
        boxes = boxes_for_page(self.ink, systems)
        self.assertEqual(len(boxes), 7)
        first = boxes[0]
        self.assertLess(first.y, self.rows_a[0])
        self.assertGreater(first.y + first.h, self.rows_a[-1])
        last_of_a = boxes[3]
        self.assertLess(last_of_a.y + last_of_a.h, self.rows_b[0])
        self.assertLessEqual(abs(boxes[4].x - 60), 2)

    def test_blank_page_has_no_boxes(self):
        ink = ink_mask(blank())
        self.assertEqual(find_systems(ink), [])
        self.assertEqual(boxes_for_page(ink, []), [])


if __name__ == "__main__":
    unittest.main()
