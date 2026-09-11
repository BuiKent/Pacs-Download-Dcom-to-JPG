"""What the export offers must be what the study list counted.

Commit 8c11c4e taught the worklist to confirm a slice by reading its header,
because an interrupted download or an HTML error response saved as `.dcm` was
being counted as an image and made an incomplete study read as complete. The
export path kept its own, older rule — anything in `DICOM/` — so the two halves
disagreed about the same folder: the study list said "Thiếu 3/40 ảnh" while the
export dialog offered 40 slices and wrote them to the USB stick a patient
carries to another hospital.
"""

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import portable_export
import web_backend
from dicom_test_utils import write_test_dicom


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    job = _StubJob()


def _worklist_dicom_count(study_dir: Path) -> int:
    row = web_backend.WorklistScanner(_StubController())._scan_study(study_dir, {}, {})
    return int(row.get("mediaCounts", {}).get("dicom") or 0)


class ExportSliceParityTests(unittest.TestCase):
    def _study(self, root: Path, real: int) -> Path:
        study_dir = root / "2026-08-06 - CT - SO NAO"
        for index in range(real):
            write_test_dicom(study_dir / "DICOM" / f"slice{index}.dcm")
        return study_dir

    def test_a_truncated_download_is_not_offered_as_a_slice(self):
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), real=3)
            # What an interrupted download leaves behind.
            (study_dir / "DICOM" / "slice3.dcm").write_bytes(b"\x00" * 400)
            collected = portable_export._collect_dicom_files(study_dir)
            self.assertEqual(len(collected), 3)

    def test_an_html_error_page_saved_as_dcm_is_not_a_slice(self):
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), real=2)
            (study_dir / "DICOM" / "slice2.dcm").write_bytes(
                b"<!doctype html><html><body>502 Bad Gateway</body></html>" * 8
            )
            collected = portable_export._collect_dicom_files(study_dir)
            self.assertEqual(len(collected), 2)

    def test_the_export_dialog_and_the_study_list_report_the_same_number(self):
        """The two halves read one folder and must agree about it."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            study_dir = self._study(root, real=4)
            (study_dir / "DICOM" / "junk.dcm").write_bytes(b"\x00" * 500)
            self.assertEqual(
                len(portable_export._collect_dicom_files(study_dir)),
                _worklist_dicom_count(study_dir),
            )

    def test_real_slices_are_still_collected(self):
        """The check must not drop images the record actually holds."""
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), real=5)
            self.assertEqual(len(portable_export._collect_dicom_files(study_dir)), 5)

    def test_a_study_without_a_dicom_folder_is_checked_too(self):
        with TemporaryDirectory() as tmp:
            study_dir = Path(tmp) / "2026-08-06 - CT - BUNG"
            write_test_dicom(study_dir / "slice0.dcm")
            (study_dir / "broken.dcm").write_bytes(b"\x00" * 500)
            self.assertEqual(len(portable_export._collect_dicom_files(study_dir)), 1)


if __name__ == "__main__":
    unittest.main()
