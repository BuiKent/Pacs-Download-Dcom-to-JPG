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
import dicom_io


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    """`_scan_study` reads the running job to mark a study "Đang tải"; nothing else."""

    job = _StubJob()


def _scan(study_dir: Path) -> dict:
    return web_backend.WorklistScanner(_StubController())._scan_study(study_dir, {}, None)


def _write_dicom(path: Path) -> None:
    """A real, minimal DICOM image — header and all.

    The worklist confirms a slice by reading its header, so a fixture of null
    bytes proves nothing about a folder of real images.
    """
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

    dataset = Dataset()
    dataset.SOPClassUID = CTImageStorage
    dataset.SOPInstanceUID = generate_uid()
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Rows = 8
    dataset.Columns = 8
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = CTImageStorage
    file_meta.MediaStorageSOPInstanceUID = dataset.SOPInstanceUID
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    dataset.file_meta = file_meta
    path.parent.mkdir(parents=True, exist_ok=True)
    dataset.save_as(str(path), enforce_file_format=True)


class DicomSliceCountingTests(unittest.TestCase):
    def test_a_corrupt_file_with_dcm_suffix_is_not_a_slice(self):
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - CT - CT Bung"
            dicom = study / "DICOM"
            _write_dicom(dicom / "valid.dcm")
            (dicom / "corrupt.dcm").write_bytes(b"not a dicom dataset")

            scanned = _scan(study)
            discovered = dicom_io.discover_dicom_files(dicom)

        self.assertEqual(scanned["mediaCounts"]["dicom"], 1)
        self.assertEqual([path.name for path in discovered], ["valid.dcm"])

    def test_counts_extensionless_slices_nested_under_series_folders(self):
        # What a PACS disc export actually writes. Matching only the file's
        # immediate parent reported this study as "Folder trống".
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - CT - CT Bung"
            series = study / "DICOM" / "1.2.840.113619.2.55.3.604688.9"
            series.mkdir(parents=True)
            for index in range(5):
                _write_dicom(series / f"IM{index:05d}")

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
                _write_dicom(dicom / f"IM{index:05d}.dcm")
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


class SliceCountFreshnessTests(unittest.TestCase):
    """A study that just gained slices must report them on the next scan.

    A cache keyed on the study folder's own `mtime` looks right and is not: on
    Windows a directory's mtime tracks its immediate children, and slices land
    in `<study>/DICOM/`, one level below. The download that fills a study in the
    background would leave the worklist showing the count from before it ran.
    """

    def test_slices_added_under_dicom_are_seen_by_the_next_scan(self):
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - CT - CT Bung"
            dicom = study / "DICOM"
            dicom.mkdir(parents=True)
            for index in range(3):
                _write_dicom(dicom / f"IM{index:05d}.dcm")

            before_mtime = study.stat().st_mtime
            first = _scan(study)
            self.assertEqual(first["sliceCount"], 3)

            # What a background download does: writes into the DICOM subfolder
            # without touching the study folder itself.
            for index in range(3, 9):
                _write_dicom(dicom / f"IM{index:05d}.dcm")

            # The premise of the bug, asserted so this test keeps its meaning
            # even if the filesystem's behaviour ever changes.
            self.assertEqual(
                study.stat().st_mtime,
                before_mtime,
                "writing into a subfolder must not change the study folder mtime; "
                "if it does, this test no longer guards anything",
            )

            self.assertEqual(_scan(study)["sliceCount"], 9)

    def test_a_reused_scanner_also_reports_the_new_count(self):
        # The worklist builds a fresh scanner per call today, which hid the
        # stale-cache bug. Reusing one must not bring it back.
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - MR - MRI Nao"
            dicom = study / "DICOM"
            dicom.mkdir(parents=True)
            _write_dicom(dicom / "IM00000.dcm")

            scanner = web_backend.WorklistScanner(_StubController())
            self.assertEqual(scanner._scan_study(study, {}, None)["sliceCount"], 1)

            _write_dicom(dicom / "IM00001.dcm")
            self.assertEqual(scanner._scan_study(study, {}, None)["sliceCount"], 2)


if __name__ == "__main__":
    unittest.main()
