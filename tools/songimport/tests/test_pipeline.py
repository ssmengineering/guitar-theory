"""The parts of the pipeline that need no audio.

    .venv\\Scripts\\python.exe -m unittest discover -s tools\\songimport\\tests
"""

import unittest
from pathlib import Path

from songimport.pipeline import (
    StemPlan,
    build_song_json,
    kept_fields,
    plan_stems,
    slugify,
    title_from_filename,
)


class Slugs(unittest.TestCase):
    def test_matches_the_app(self):
        self.assertEqual(
            slugify("Chet Atkins", "Ochi Chornya (Les Yeux Noirs)"),
            "chet-atkins-ochi-chornya-les-yeux-noirs",
        )
        self.assertEqual(slugify(None, "Tenderly"), "tenderly")
        self.assertEqual(slugify("", "***"), "song")
        self.assertEqual(slugify("Édith", "Café"), "edith-cafe")

    def test_title_from_filename(self):
        self.assertEqual(title_from_filename(Path("03OchiChornya(LesYeuxNoirs).MP3")), "Ochi Chornya (Les Yeux Noirs)")
        self.assertEqual(title_from_filename(Path("07 Little Rock Getaway.mp3")), "Little Rock Getaway")
        self.assertEqual(title_from_filename(Path("tenderly.flac")), "tenderly")


class Stems(unittest.TestCase):
    def test_four_stem_model_makes_other_the_guitar(self):
        levels = {"vocals": -64.7, "drums": -39.3, "bass": -23.5, "other": -19.5}
        plans, dropped = plan_stems(levels, "htdemucs_ft", None, "Chet")
        self.assertEqual([p.id for p in plans], ["guitar", "bass", "drums"])
        self.assertEqual(plans[0].role, "lead")
        self.assertEqual(plans[0].label, "Chet")
        self.assertEqual(plans[0].source, "other")
        self.assertIsNone(plans[1].role)
        self.assertEqual(dropped, [("vocals", -64.7)])

    def test_six_stem_model_keeps_its_guitar_and_drops_empty_piano(self):
        levels = {"vocals": -64.7, "drums": -42.1, "bass": -23.4, "other": -55.0, "guitar": -19.5, "piano": -68.0}
        plans, dropped = plan_stems(levels, "htdemucs_6s", None, "Guitar")
        self.assertEqual([p.id for p in plans], ["guitar", "bass", "drums"])
        self.assertEqual({name for name, _ in dropped}, {"vocals", "other", "piano"})

    def test_lead_can_be_chosen_or_switched_off(self):
        levels = {"drums": -30.0, "bass": -30.0, "other": -30.0, "piano": -30.0, "guitar": -30.0, "vocals": -30.0}
        plans, _ = plan_stems(levels, "htdemucs_6s", "piano", "Piano")
        self.assertEqual(plans[0].id, "piano")
        self.assertEqual(plans[0].role, "lead")
        plans, _ = plan_stems(levels, "htdemucs_6s", "none", "Guitar")
        self.assertTrue(all(p.role is None for p in plans))
        self.assertEqual([p.id for p in plans], ["guitar", "piano", "bass", "drums", "other", "vocals"])

    def test_the_leftover_stays_other_when_a_guitar_stem_exists(self):
        levels = {"guitar": -20.0, "other": -20.0}
        plans, _ = plan_stems(levels, "htdemucs_6s", "other", "Lead")
        self.assertEqual([(p.id, p.role) for p in plans], [("other", "lead"), ("guitar", None)])
        plans, _ = plan_stems({"guitar": -70.0, "other": -20.0}, "htdemucs_6s", "other", "Lead")
        self.assertEqual([p.id for p in plans], ["guitar"])


class Keeping(unittest.TestCase):
    def test_keeps_the_players_work_and_nothing_else(self):
        existing = {
            "format": 1,
            "title": "old title",
            "key": "Dm",
            "beatsPerBar": 3,
            "bars": [1.0, 2.0],
            "sections": [{"name": "A", "bars": [1, 8], "chart": "a"}],
            "charts": {"a": "| Dm |"},
            "tempoBpm": 99,
            "beatCandidates": [0.1],
            "scan": {"pages": [{"image": "scan/p1.png", "boxes": [{"bars": [1], "x": 1, "y": 2, "w": 3, "h": 4}]}, {"image": "scan/p2.png", "boxes": []}]},
        }
        kept = kept_fields(existing)
        self.assertEqual(set(kept), {"key", "beatsPerBar", "bars", "sections", "charts", "scanBoxes"})
        self.assertEqual(list(kept["scanBoxes"]), ["scan/p1.png"])
        self.assertEqual(kept_fields(None), {})
        self.assertEqual(kept_fields({"format": 1, "title": "x"}), {})


class Building(unittest.TestCase):
    def stems(self):
        return [
            StemPlan("other", "guitar", "Chet", "lead", -19.5),
            StemPlan("bass", "bass", "Bass", None, -23.5),
        ]

    def test_fresh_package(self):
        song = build_song_json(
            title="Ochi Chornya", artist="Chet Atkins", album=None, year=1955,
            source={"file": "x.mp3", "separator": "htdemucs_ft"}, stems=self.stems(),
            beats_per_bar=4, key=None, tempo_bpm=107.7, beat_candidates=[0.0, 0.5],
            scan_pages=["p1.png"], kept={},
        )
        self.assertEqual(song["format"], 1)
        self.assertNotIn("key", song)
        self.assertNotIn("album", song)
        self.assertEqual(song["stems"][0], {"id": "guitar", "file": "stems/guitar.mp3", "role": "lead", "label": "Chet"})
        self.assertEqual(song["stems"][1], {"id": "bass", "file": "stems/bass.mp3"})
        self.assertEqual(song["beatsPerBar"], 4)
        self.assertEqual(song["bars"], [])
        self.assertEqual(song["scan"], {"pages": [{"image": "scan/p1.png", "boxes": []}]})

    def test_kept_fields_win(self):
        kept = {
            "key": "Dm", "beatsPerBar": 3, "bars": [30.0], "sections": [{"name": "A", "bars": [1, 2]}],
            "charts": {"a": "| Dm |"}, "scanBoxes": {"scan/p1.png": [{"bars": [1], "x": 0, "y": 0, "w": 1, "h": 1}]},
        }
        song = build_song_json(
            title="t", artist=None, album=None, year=None, source={}, stems=self.stems(),
            beats_per_bar=4, key="C", tempo_bpm=None, beat_candidates=[], scan_pages=["p1.png", "p2.png"], kept=kept,
        )
        self.assertEqual(song["key"], "Dm")
        self.assertEqual(song["beatsPerBar"], 3)
        self.assertEqual(song["bars"], [30.0])
        self.assertNotIn("tempoBpm", song)
        self.assertEqual(len(song["scan"]["pages"][0]["boxes"]), 1)
        self.assertEqual(song["scan"]["pages"][1]["boxes"], [])


if __name__ == "__main__":
    unittest.main()
