"""How the worklist decides a file on disk is a DICOM slice.

The count this produces is what the reader checks to see whether a study came
down complete, so both directions of getting it wrong are clinical problems:
counting JPGs as slices makes an incomplete study look finished, and missing
real slices reports a study that has images as "Folder trống".

Both have happened. The rule was once "the word dicom appears anywhere in the
path", which turned every JPG of a patient whose folder was named "… - DICOM CT"
into a slice. Narrowing it to the file's immediate parent fixed that and broke
the other side: exports from disc are laid out as
`DICOM/<SeriesInstanceUID>/IM00001` with no file extension, and those studies
started reporting empty. The rule these pin is "any folder between the study and
the file is a DICOM folder", which is the only one that satisfies both.
"""

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import web_backend


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    """`_scan_study` reads the running job to mark a study "Đang tải"; nothing else."""

    job = _StubJob()


def _scan(study_dir: Path) -> dict:
    return web_backend.WorklistScanner(_StubController())._scan_study(study_dir, {}, None)


class DicomSliceCountingTests(unittest.TestCase):
    def test_counts_extensionless_slices_nested_under_series_folders(self):
        # What a PACS disc export actually writes. Matching only the file's
        # immediate parent reported this study as "Folder trống".
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - CT - CT Bung"
            series = study / "DICOM" / "1.2.840.113619.2.55.3.604688.9"
            series.mkdir(parents=True)
            for index in range(5):
                (series / f"IM{index:05d}").write_bytes(b"\x00" * 300)

            scanned = _scan(study)

        self.assertEqual(scanned["mediaCounts"]["dicom"], 5)
        self.assertEqual(scanned["sliceCount"], 5)
        self.assertNotEqual(scanned["status"], "miss")

    def test_the_extension_sidecar_is_not_a_slice(self):
        # `dcom-source.json` is written beside the images the extension saved.
        # It carries the viewer link, not pixels, and must not inflate the count
        # the reader uses to judge whether the study is complete.
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - MR - MRI Nao"
            dicom = study / "DICOM"
            dicom.mkdir(parents=True)
            for index in range(5):
                (dicom / f"IM{index:05d}.dcm").write_bytes(b"\x00" * 300)
            (dicom / "dcom-source.json").write_text("{}", encoding="utf-8")

            scanned = _scan(study)

        self.assertEqual(scanned["mediaCounts"]["dicom"], 5)

    def test_a_study_named_after_a_modality_keeps_its_jpgs_as_photos(self):
        # The regression that started all this: "DICOM" inside the study's own
        # folder name must not reclassify what is stored under it.
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - DICOM CT - Chup phoi"
            jpg = study / "JPG"
            jpg.mkdir(parents=True)
            for index in range(5):
                (jpg / f"slice_{index}.jpg").write_bytes(b"\x00" * 300)

            scanned = _scan(study)

        self.assertEqual(scanned["mediaCounts"]["dicom"], 0)
        self.assertEqual(scanned["mediaCounts"]["photo"], 5)


if __name__ == "__main__":
    unittest.main()
