"""
What the worklist finds in a real operating-theatre folder.

A patient folder routinely holds the diagnostic scan, the intra-operative clips
and the screen captures taken beside them. These check that opening the folder
lists all three — the failures they cover all had the same shape: material
present on disk and absent from the timeline, with nothing saying so.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

import web_backend
from web_backend import ArchiveCatalog


class TestVideoContainers(unittest.TestCase):
    def test_recognises_what_a_theatre_recorder_writes(self):
        # Endoscopy towers and older capture stations write .wmv and .mpg, and
        # AVCHD recorders write .mts. Leaving them out did not merely fail to
        # play them: the file vanished from the worklist, so nobody could tell
        # the recording had been filed at all.
        for extension in (".wmv", ".mpg", ".mpeg", ".mts", ".m2ts", ".m4v", ".flv"):
            self.assertIn(extension, web_backend.VIDEO_EXTENSIONS, extension)
        for extension in (".mp4", ".webm", ".avi", ".mov", ".mkv"):
            self.assertIn(extension, web_backend.VIDEO_EXTENSIONS, extension)

    def test_the_record_says_which_files_the_browser_cannot_decode(self):
        # Asserting the contents of BROWSER_PLAYABLE_VIDEO passes whether or not
        # anything reads it — which is how the constant sat there unused. This
        # goes through the record the studio is actually built from.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "2605030698-NGUYEN VAN X-53t"
            theatre = root / "Video trong mổ"
            theatre.mkdir(parents=True)
            # Named so the sort order is mp4, mp4, wmv.
            for name in ("a_clip.mp4", "b_clip.mp4", "c_camera.wmv"):
                (theatre / name).write_bytes(bytes(64))

            video = next(s for s in ArchiveCatalog().open(root)["series"]
                         if s["mediaType"] == "video")
            # Per file, not per series: marking the whole folder unplayable
            # would put a conversion prompt over the two clips that play.
            self.assertEqual(video["filesPlayable"], [True, True, False])

    def test_nothing_but_video_is_ever_marked_unplayable(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "2605030698-NGUYEN VAN X-53t"
            photos = root / "19.05.2026-trước mổ"
            photos.mkdir(parents=True)
            for index in range(2):
                Image.new("RGB", (32, 24), (10, 20, 30)).save(photos / f"IM{index}.jpg")

            photo = next(s for s in ArchiveCatalog().open(root)["series"]
                         if s["mediaType"] == "photo")
            self.assertEqual(photo["filesPlayable"], [True, True])


class TestWorklistStudyRows(unittest.TestCase):
    """
    The rows the worklist table is actually built from.

    `_leading_folder_date` was added and unit-tested on its own, and it passed
    while the date column on screen stayed empty — because the worklist is built
    by `WorklistScanner._scan_study`, which was still using its own regex and
    never called the new parser. A helper nobody calls satisfies a test that
    calls it directly, so these go through the scanner instead.
    """

    def _rows(self, names):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "2605030698-NGUYEN VAN X-53t"
            root.mkdir()
            scanner = web_backend.WorklistScanner(web_backend.WebController())
            rows = {}
            for name in names:
                (root / name).mkdir()
                rows[name] = scanner._scan_study(root / name, {})
            return rows

    def test_the_date_column_is_filled_for_a_hand_named_study_folder(self):
        rows = self._rows([
            "19.05.2026-trước mổ, DTI",
            "09.07.2026-sau mổ 1 tháng",
            "30.05.2026-sau mổ 24h",
        ])
        self.assertEqual(rows["19.05.2026-trước mổ, DTI"]["studyDate"], "19/05/2026")
        self.assertEqual(rows["09.07.2026-sau mổ 1 tháng"]["studyDate"], "09/07/2026")
        self.assertEqual(rows["30.05.2026-sau mổ 24h"]["studyDate"], "30/05/2026")

    def test_the_rows_sort_by_the_date_they_show(self):
        # The column sorts on `studyDateSort`, not on the displayed dd/mm/yyyy.
        # An empty sort key puts a dated study at the bottom of the patient's
        # timeline, which is the wrong end for the most recent scan.
        rows = self._rows(["19.05.2026-trước mổ, DTI", "09.07.2026-sau mổ 1 tháng"])
        self.assertEqual(rows["19.05.2026-trước mổ, DTI"]["studyDateSort"], "20260519")
        self.assertEqual(rows["09.07.2026-sau mổ 1 tháng"]["studyDateSort"], "20260709")

    def test_the_date_is_stripped_off_the_name_it_prefixes(self):
        # Otherwise the row reads "19.05.2026-trước mổ, DTI" beside a date
        # column already saying 19/05/2026.
        rows = self._rows(["19.05.2026-trước mổ, DTI", "2026-05-19 - MR so nao"])
        self.assertEqual(rows["19.05.2026-trước mổ, DTI"]["studyName"], "trước mổ, DTI")
        self.assertEqual(rows["2026-05-19 - MR so nao"]["studyName"], "MR so nao")

    def test_a_folder_with_no_date_in_its_name_keeps_an_empty_column(self):
        # `CONTENT` is the IHE PDI disc folder; inventing a date for it would
        # put a study on a day nothing happened.
        rows = self._rows(["CONTENT", "Video trong mổ"])
        for name in ("CONTENT", "Video trong mổ"):
            self.assertEqual(rows[name]["studyDate"], "")
            self.assertEqual(rows[name]["studyName"], name)


class TestFolderDates(unittest.TestCase):
    def test_reads_the_date_a_clinician_types_into_a_folder_name(self):
        # `19.05.2026-trước mổ, DTI`. Only the DICOM spellings were recognised,
        # so every hand-named study arrived with an empty date column.
        self.assertEqual(web_backend._leading_folder_date("19.05.2026-trước mổ, DTI"), "2026-05-19")
        self.assertEqual(web_backend._leading_folder_date("09.07.2026-sau mổ 1 tháng"), "2026-07-09")
        self.assertEqual(web_backend._leading_folder_date("30-05-2026 sau mổ 24h"), "2026-05-30")

    def test_still_reads_the_dicom_spellings(self):
        self.assertEqual(web_backend._leading_folder_date("2026-05-19 - MR"), "2026-05-19")
        self.assertEqual(web_backend._leading_folder_date("20260519_MR"), "20260519")


class TestCompanionMedia(unittest.TestCase):
    """A folder holding clips *and* the captures taken from them."""

    def _archive(self, root: Path) -> dict:
        return ArchiveCatalog().open(root)

    def test_lists_screen_captures_filed_beside_the_clips(self):
        # `_companion_media_records` skipped photographs for every caller,
        # reasoning that the image scan had already listed them. True of the JPG
        # branch; the DICOM branch has no image scan at all, so a patient folder
        # with a scan plus a `Video trong mổ` folder listed the clips and
        # dropped every capture beside them.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "2605030698-NGUYEN VAN X-53t"
            theatre = root / "Video trong mổ"
            theatre.mkdir(parents=True)
            (theatre / "clip.mp4").write_bytes(b"\x00" * 64)
            for index in range(3):
                Image.new("RGB", (64, 48), (20, 40, 60)).save(theatre / f"capture_{index}.jpg")

            series = self._archive(root)["series"]
            kinds = sorted(s["mediaType"] for s in series)
            self.assertEqual(kinds, ["photo", "video"])
            photo = next(s for s in series if s["mediaType"] == "photo")
            self.assertEqual(photo["sliceCount"], 3)

    def test_does_not_list_a_folder_of_pictures_twice(self):
        # The JPG branch lists a folder's pictures before asking for companions,
        # so it must keep skipping them or every folder of intra-op photos would
        # appear twice on the timeline.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "2605030698-NGUYEN VAN X-53t"
            photos = root / "19.05.2026-trước mổ"
            photos.mkdir(parents=True)
            for index in range(4):
                Image.new("RGB", (64, 48), (10, 20, 30)).save(photos / f"IM{index}.jpg")

            series = self._archive(root)["series"]
            self.assertEqual([s["mediaType"] for s in series], ["photo"])
            self.assertEqual(series[0]["sliceCount"], 4)


if __name__ == "__main__":
    unittest.main()
