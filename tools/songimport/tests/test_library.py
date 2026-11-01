"""Pairing records with tabs from the names the two libraries actually use."""

import unittest
from pathlib import Path

from songimport.library import (
    Album,
    Tab,
    TabFolder,
    Track,
    pair_album,
    pair_albums,
    pair_track,
    parse_album_folder,
    parse_tab_file,
    parse_tab_folder,
    parse_track_file,
    pretty_title,
    similarity,
)


class Names(unittest.TestCase):
    def test_pretty_titles(self):
        self.assertEqual(pretty_title("OchiChornya(LesYeuxNoirs)"), "Ochi Chornya (Les Yeux Noirs)")
        self.assertEqual(pretty_title("TipToeThroughTheTulipsWithMe"), "Tip Toe Through The Tulips With Me")
        self.assertEqual(pretty_title("Ain'tMisbehavin"), "Ain't Misbehavin")
        self.assertEqual(pretty_title("Tara'sTheme"), "Tara's Theme")
        self.assertEqual(pretty_title("Reminiscing-w-HankSnow"), "Reminiscing with Hank Snow")
        self.assertEqual(pretty_title("36AllTimeGreatestHits"), "36 All Time Greatest Hits")
        self.assertEqual(pretty_title("ASessionWithChetAtkins"), "A Session With Chet Atkins")
        self.assertEqual(pretty_title("It'sAGuitarWorld"), "It's A Guitar World")
        self.assertEqual(pretty_title("HiFiInFocus"), "Hi Fi In Focus")

    def test_album_and_track_names(self):
        self.assertEqual(parse_album_folder("1955_ChetAtkinsInThreeDimensions"), (1955, "Chet Atkins In Three Dimensions"))
        self.assertEqual(parse_album_folder("1956_Finger-StyleGuitar"), (1956, "Finger - Style Guitar"))
        self.assertEqual(parse_album_folder("Misc"), (None, "Misc"))
        self.assertEqual(parse_track_file("03OchiChornya(LesYeuxNoirs).MP3"), (3, "Ochi Chornya (Les Yeux Noirs)"))
        self.assertEqual(parse_track_file("12MinuteWaltz.MP3"), (12, "Minute Waltz"))
        self.assertEqual(parse_track_file("bonus.mp3"), (None, "bonus"))

    def test_tab_names(self):
        self.assertEqual(parse_tab_folder("02 (1955) Chet Atkins In 3 Dimensions LPM-1197"), (1955, "Chet Atkins In 3 Dimensions"))
        self.assertEqual(parse_tab_folder("07 (1959) In Hollywood LPM LSP-1993"), (1959, "In Hollywood"))
        self.assertEqual(parse_tab_folder("03 (1955) Stringin' Along With Chet Atkins(12 ) LPM-1236")[0], 1955)
        self.assertEqual(parse_tab_file("03 Dark Eyes.pdf"), (3, "Dark Eyes"))
        self.assertEqual(parse_tab_file("11 Lullabye Of The Leaves.pdf"), (11, "Lullabye Of The Leaves"))


class Similarity(unittest.TestCase):
    def test_reads_through_the_spelling(self):
        self.assertGreaterEqual(similarity("Chet Atkins In Three Dimensions", "Chet Atkins In 3 Dimensions"), 0.9)
        self.assertGreaterEqual(similarity("Hi Fi In Focus", "Hi-Fi In Focus"), 0.9)
        self.assertGreaterEqual(similarity("Finger - Style Guitar", "Fingerstyle Guitar"), 0.8)
        self.assertGreaterEqual(similarity("Chet Atkins In Hollywood - City Skyline", "In Hollywood"), 0.7)
        self.assertLess(similarity("Chet Atkins In Three Dimensions", "Stringin' Along With Chet Atkins"), 0.5)
        self.assertLess(similarity("The Amazing Chet Atkins", "Chet Atkins In 3 Dimensions"), 0.4)


class Pairing(unittest.TestCase):
    def setUp(self):
        self.three_d = Album("1955_ChetAtkinsInThreeDimensions", 1955, "Chet Atkins In Three Dimensions", Path("m/3d"), [
            Track(3, "Ochi Chornya (Les Yeux Noirs)", Path("m/3d/03OchiChornya(LesYeuxNoirs).MP3")),
            Track(12, "Minute Waltz", Path("m/3d/12MinuteWaltz.MP3")),
        ])
        self.stringin = Album("1955_StringingAlongWithChetAtkins", 1955, "Stringing Along With Chet Atkins", Path("m/sa"))
        self.hymns = Album("1962_ChetAtkinsPlaysBackHomeHymns", 1962, "Chet Atkins Plays Back Home Hymns", Path("m/h"))
        self.folders = [
            TabFolder("02 (1955) Chet Atkins In 3 Dimensions LPM-1197", 1955, "Chet Atkins In 3 Dimensions", Path("t/3d"), [
                Tab(3, "Dark Eyes", Path("t/3d/03 Dark Eyes.pdf")),
            ]),
            TabFolder("03 (1955) Stringin' Along With Chet Atkins(12 ) LPM-1236", 1955, "Stringin' Along With Chet Atkins (12 )", Path("t/sa")),
            TabFolder("17 (1961) Chet Atklins Plays Back Home Hymns LPM LSP-2601", 1961, "Chet Atklins Plays Back Home Hymns", Path("t/h")),
        ]

    def test_two_albums_from_one_year_go_to_the_right_folders(self):
        self.assertEqual(pair_album(self.three_d, self.folders).path, Path("t/3d"))
        self.assertEqual(pair_album(self.stringin, self.folders).path, Path("t/sa"))

    def test_a_wrong_year_and_a_typo_still_pair(self):
        self.assertEqual(pair_album(self.hymns, self.folders).path, Path("t/h"))

    def test_nothing_alike_means_no_tab_folder(self):
        lonely = Album("1990_NeckAndNeck-w-MarkKnopfler", 1990, "Neck And Neck with Mark Knopfler", Path("m/nn"))
        self.assertIsNone(pair_album(lonely, self.folders))
        # Two shared words out of six is not a match, even in the same year.
        amazing = Album("1955_TheAmazingChetAtkins", 1955, "The Amazing Chet Atkins", Path("m/am"))
        self.assertIsNone(pair_album(amazing, self.folders))

    def test_each_folder_goes_to_the_album_that_fits_it_best(self):
        amazing = Album("1955_TheAmazingChetAtkins", 1955, "Chet Atkins In Three Dimensions Amazing", Path("m/am"))
        chosen = pair_albums([amazing, self.three_d, self.stringin], self.folders)
        self.assertEqual(chosen[self.three_d.name].path, Path("t/3d"))
        self.assertEqual(chosen[self.stringin.name].path, Path("t/sa"))
        self.assertIsNone(chosen[amazing.name])

    def test_tracks_pair_by_number_and_say_when_there_is_no_tab(self):
        folder = self.folders[0]
        ochi, waltz = self.three_d.tracks
        self.assertEqual(pair_track(ochi, folder).title, "Dark Eyes")
        self.assertIsNone(pair_track(waltz, folder))
        self.assertIsNone(pair_track(ochi, None))


if __name__ == "__main__":
    unittest.main()
