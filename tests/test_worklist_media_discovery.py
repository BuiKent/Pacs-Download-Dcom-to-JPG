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

    def test_names_the_ones_a_browser_cannot_decode(self):
        # The studio offers the MP4 conversion for these rather than showing a
        # black player and letting the reader conclude the file is corrupt.
        self.assertIn(".mp4", web_backend.BROWSER_PLAYABLE_VIDEO)
        self.assertNotIn(".wmv", web_backend.BROWSER_PLAYABLE_VIDEO)
        self.assertNotIn(".mpg", web_backend.BROWSER_PLAYABLE_VIDEO)
        self.assertTrue(web_backend.BROWSER_PLAYABLE_VIDEO <= web_backend.VIDEO_EXTENSIONS)


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

    def test_scan_study_reads_vietnamese_date_and_cleans_name(self):
        with TemporaryDirectory() as tmp:
            study_dir = Path(tmp) / "19.05.2026-trước mổ, DTI"
            study_dir.mkdir(parents=True)
            ctrl = web_backend.WebController()
            scanner = web_backend.WorklistScanner(ctrl)
            study = scanner._scan_study(study_dir, {})
            self.assertEqual(study["studyDate"], "19/05/2026")
            self.assertEqual(study["studyDateSort"], "20260519")
            self.assertEqual(study["studyName"], "trước mổ, DTI")



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
